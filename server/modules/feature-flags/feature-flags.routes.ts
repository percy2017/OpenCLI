import express from 'express';

import { ragVectorFeatureFlag } from '@/modules/feature-flags/feature-flags.service.js';

const router = express.Router();

router.get('/rag-vector', (_req, res) => {
  try {
    const state = ragVectorFeatureFlag.getState();
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load RAG Vector state.',
    });
  }
});

router.put('/rag-vector', (req, res) => {
  try {
    const body = (req.body || {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'Body must include a boolean `enabled` field.',
      });
      return;
    }

    const next = ragVectorFeatureFlag.setEnabled(body.enabled);
    res.json({ success: true, data: next });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update RAG Vector state.',
    });
  }
});

export default router;
