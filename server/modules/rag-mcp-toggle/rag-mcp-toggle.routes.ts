import express from 'express';

import { ragMcpToggleService } from '@/modules/rag-mcp-toggle/rag-mcp-toggle.service.js';

const router = express.Router();

router.get('/state', async (_req, res) => {
  try {
    const status = await ragMcpToggleService.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load RAG MCP state.',
    });
  }
});

router.put('/state', async (req, res) => {
  try {
    const body = (req.body || {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'Body must include a boolean `enabled` field.',
      });
      return;
    }
    const result = await ragMcpToggleService.setEnabled(body.enabled);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update RAG MCP state.',
    });
  }
});

export default router;
