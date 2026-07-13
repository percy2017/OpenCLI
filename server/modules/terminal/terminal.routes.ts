/**
 * HTTP routes for the Terminal module.
 *
 * Exposes a single toggle that the WebSocket router consults on every
 * `/shell` upgrade. See `terminal.service.ts` for the persistence layer and
 * the kill-switch semantics.
 */

import express from 'express';

import { terminalService } from '@/modules/terminal/terminal.service.js';

const router = express.Router();

router.get('/state', (_req, res) => {
  try {
    const state = terminalService.getState();
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load terminal state.',
    });
  }
});

router.put('/state', (req, res) => {
  try {
    const body = (req.body || {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'Body must include a boolean `enabled` field.',
      });
      return;
    }
    const state = terminalService.setEnabled(body.enabled);
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update terminal state.',
    });
  }
});

export default router;