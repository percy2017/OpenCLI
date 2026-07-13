import { Router } from 'express';

import { mcpToolsService } from './mcp-tools.service.js';

const router = Router();

/**
 * GET /api/mcp-tools
 *
 * Returns the aggregated tool catalogs of every managed MCP server for the
 * "MCP y Tools" settings tab. Authentication is enforced by the global route
 * mount in `server/index.js` (`app.use('/api/mcp-tools', authenticateToken, ...)`).
 */
router.get('/', async (_req, res) => {
  try {
    const data = await mcpToolsService.listTools();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mcp-tools] listTools failed:', message);
    res.status(500).json({ success: false, error: 'Failed to list MCP tools.' });
  }
});

export default router;
