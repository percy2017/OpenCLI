import fsSync, { promises as fs } from 'node:fs';

import express from 'express';
import mime from 'mime-types';
import multer from 'multer';

import {
  buildStoredImageRecords,
  ensureImageAssetsDir,
  isAllowedImageMimeType,
  resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

const router = express.Router();

const MAX_ATTACHMENT_SIZE_MB = Number.parseInt(process.env.MAX_FILE_ATTACHMENT_SIZE_MB ?? '10', 10);
const MAX_ATTACHMENTS = Number.parseInt(process.env.MAX_FILE_ATTACHMENTS ?? '5', 10);

// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => cb(null, assetsDir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: images, PDF, DOCX, XLSX, PPTX, TXT, MD, CSV.'));
    }
  },
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE_MB * 1024 * 1024,
    files: MAX_ATTACHMENTS,
  },
});

/**
 * Stores chat attachments (images and office files) in the global
 * `~/.cloudcli/assets` folder and returns their absolute paths for use in
 * provider prompts and chat history. The LLM receives only the path; it is
 * expected to use its native file-reading tools (or the RAG MCP) to consume
 * the contents.
 */
router.post('/images', (req, res) => {
  // Accept either field name — older clients send 'images', newer ones 'files'.
  const handler = upload.fields([
    { name: 'images', maxCount: MAX_ATTACHMENTS },
    { name: 'files', maxCount: MAX_ATTACHMENTS },
  ]);
  handler(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const filesField = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const files = [...(filesField.images ?? []), ...(filesField.files ?? [])];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    res.json({ files: buildStoredImageRecords(files) });
  });
});

/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
  const resolved = resolveImageAssetFile(req.params.filename);
  if (!resolved) {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }

  try {
    await fs.access(resolved);
  } catch {
    return res.status(404).json({ error: 'Asset not found' });
  }

  const contentType = mime.lookup(resolved) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  // Stored-XSS hardening: never let the browser sniff a different type, and
  // force SVGs (which can carry scripts when rendered as a document) to
  // download instead of rendering inline. The chat UI is unaffected — it
  // fetches assets as blobs and shows them through <img>, where SVG scripts
  // never execute.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (contentType === 'image/svg+xml') {
    res.setHeader('Content-Disposition', 'attachment');
  }
  const fileStream = fsSync.createReadStream(resolved);
  fileStream.pipe(res);
  fileStream.on('error', (error) => {
    console.error('Error streaming image asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

export default router;
