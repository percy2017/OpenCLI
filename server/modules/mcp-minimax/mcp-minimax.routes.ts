import express from 'express';

import { mcpMinimaxService } from '@/modules/mcp-minimax/mcp-minimax.service.js';

const router = express.Router();

router.get('/state', async (_req, res) => {
  try {
    const status = await mcpMinimaxService.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load MiniMax MCP state.',
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

    const result = await mcpMinimaxService.setEnabled(body.enabled);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update MiniMax MCP state.',
    });
  }
});

export default router;