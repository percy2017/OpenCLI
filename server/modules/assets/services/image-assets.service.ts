import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';

/**
 * Mime types accepted for chat attachment uploads (images + office files).
 * SVG is allowed for storage/preview even though some providers (Claude API)
 * skip it at send time. Office files (PDF, DOCX, XLSX, PPTX, TXT, MD, CSV)
 * are stored as-is and only their path is sent to the LLM — the LLM is
 * expected to use its native file-reading tools (or the RAG MCP) to consume
 * the contents.
 */
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/** @deprecated Kept for back-compat with any external callers. */
const ALLOWED_IMAGE_MIME_TYPES = ALLOWED_ATTACHMENT_MIME_TYPES;

// Used only by this service and the assets routes via the barrel file.
type StoredImageAsset = {
  /** Original upload filename, for display. */
  name: string;
  /** Absolute posix-normalized path inside the global assets folder. */
  path: string;
  size: number;
  mimeType: string;
};

// Shape of one multer-stored file; kept local because only this module reads it.
type UploadedImageFile = {
  originalname: string;
  filename: string;
  size: number;
  mimetype: string;
};

/** Returns whether one uploaded mime type may be stored as a chat attachment. */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType);
}

/** Returns whether one uploaded mime type may be stored as a chat attachment. */
export function isAllowedAttachmentMimeType(mimeType: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType);
}

/** Creates the global `~/.opencli/assets` folder if needed and returns it. */
export async function ensureImageAssetsDir(): Promise<string> {
  const assetsDir = getGlobalImageAssetsDir();
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

/**
 * Maps multer-stored upload files to the attachment records returned to the
 * chat composer. The absolute path is what providers receive and what session
 * history carries back to the UI.
 */
export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const assetsDir = getGlobalImageAssetsDir();
  return files.map((file) => ({
    name: file.originalname,
    path: toPosixPath(path.join(assetsDir, file.filename)),
    size: file.size,
    mimeType: file.mimetype,
  }));
}

/**
 * Resolves one asset filename to its absolute path inside the global assets
 * folder, or null when the name is empty, contains path separators/traversal,
 * or would escape the folder. This is the only lookup the serving route uses,
 * so nothing outside `~/.opencli/assets` can ever be read through it.
 */
export function resolveImageAssetFile(filename: string): string | null {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return null;
  }

  const assetsDir = path.resolve(getGlobalImageAssetsDir());
  const resolved = path.resolve(assetsDir, trimmed);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    return null;
  }

  return resolved;
}
