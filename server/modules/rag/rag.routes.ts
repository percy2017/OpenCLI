import express from 'express';

import { ragService } from '@/modules/rag/rag.service.js';

const router = express.Router();

router.get('/config', async (_req, res) => {
  try {
    const config = await ragService.getConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load RAG config.',
    });
  }
});

router.post('/reap-stuck', (_req, res) => {
  try {
    const reaped = ragService.reapStuckIndexingDocuments();
    res.json({ success: true, data: { reaped } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Reap failed.',
    });
  }
});

router.get('/documents', async (_req, res) => {
  try {
    const docs = await ragService.listDocuments();
    res.json({ success: true, data: docs });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list documents.',
    });
  }
});

router.get('/documents/:id', async (req, res) => {
  try {
    const doc = await ragService.getDocument(req.params.id);
    if (!doc) {
      res.status(404).json({ success: false, error: 'Document not found.' });
      return;
    }
    res.json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read document.',
    });
  }
});

router.get('/documents/:id/chunks', async (req, res) => {
  try {
    const data = await ragService.getChunksForPreview(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, error: 'Document not found.' });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load chunks.',
    });
  }
});

router.post('/documents', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const filenameHeader = req.header('x-filename');
  if (!filenameHeader || typeof filenameHeader !== 'string') {
    res.status(400).json({ success: false, error: 'Missing X-Filename header.' });
    return;
  }

  const filename = filenameHeader.split(/[\\/]/).pop() ?? filenameHeader;
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
  if (bytes.length === 0) {
    res.status(400).json({ success: false, error: 'Empty payload.' });
    return;
  }

  try {
    const doc = await ragService.uploadAndIndex(filename, bytes);
    res.json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed.',
    });
  }
});

router.post('/documents/:id/reindex', async (req, res) => {
  try {
    const doc = await ragService.reindex(req.params.id);
    res.json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Reindex failed.',
    });
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    await ragService.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed.',
    });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const file = await ragService.readRawFile(req.params.id);
    if (!file) {
      res.status(404).json({ success: false, error: 'Document not found.' });
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    res.send(file.bytes);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Download failed.',
    });
  }
});

router.post('/query', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const body = (req.body || {}) as { query?: unknown; topK?: unknown };
    if (typeof body.query !== 'string' || body.query.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Body must include a non-empty `query` string.' });
      return;
    }
    const topK = typeof body.topK === 'number' ? body.topK : undefined;
    const result = await ragService.query({ query: body.query, topK });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed.',
    });
  }
});

export default router;
