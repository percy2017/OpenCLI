// First-run routes — exposes the auto-install state of bundled one-shot
// bootstraps (currently the Python RAG MCP) so the UI can surface them and
// trigger a re-run without the user touching the DB.
//
// Auth: applied per-mount in server/index.js via `authenticateToken` — same
// pattern as feature-flags, rag, browser-use, providers, etc.
//
// Envelope shape matches `feature-flags.routes.ts` / `browser-use.routes.ts`:
// `{ success: true, data }` on success, `{ success: false, error }` on
// failure. The `error` field is always a short string suitable for UI
// display; the detailed `message` / `stderr` / `ragDir` payloads ride inside
// `data` as part of the `InstallerSummary` union.

import express from 'express';

import {
  getRagMcpInstallSummary,
  retryRagMcpInstall,
  type InstallerSummary,
} from './rag-mcp-installer.js';

const router = express.Router();

router.get('/rag-status', async (_req, res) => {
  try {
    const data: InstallerSummary = getRagMcpInstallSummary();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load RAG install status.',
    });
  }
});

router.post('/rag-status/retry', async (_req, res) => {
  try {
    const data: InstallerSummary = await retryRagMcpInstall();
    // `data.status === 'installed'` is the success path; everything else
    // (pending / failed) is still a 200 — the route succeeded, the install
    // did not. Frontend renders the appropriate card state from `data`.
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retry RAG install.',
    });
  }
});

export default router;
