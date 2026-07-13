/**
 * MCP tools catalog service.
 *
 * Aggregates the tool listings of all managed MCP servers into a single
 * `/api/mcp-tools` response. Used by the "MCP y Tools" settings tab so users
 * can see what each server exposes without having to inspect raw JSON-RPC.
 *
 * Source strategy:
 *   - `cloudcli-browser`: static catalog imported from `server/browser-mcp.tools.ts`.
 *     Local Node process; no extra deps needed.
 *   - `cloudcli-rag`: static catalog imported from
 *     `server/modules/rag-mcp/rag-mcp.tools.ts`. Local Node process.
 *   - `cloudcli-minimax`: external `uvx minimax-coding-plan-mcp -y` package.
 *     Spawning it just to enumerate tools is fragile (env, version drift, no
 *     graceful shutdown). We declare the catalog as `external-or-static-fallback`
 *     marked and run a short `which uvx` probe for `available`. The full
 *     catalog is documented in the package's README; placeholder entries below
 *     reference the names so the UI shows something meaningful until the
 *     catalog is replaced by a runtime probe in a future iteration.
 */

import { spawn } from 'node:child_process';

import { BROWSER_MCP_TOOLS, type ToolDefinition } from '../browser-use/index.js';
import { RAG_MCP_TOOLS } from '../rag-mcp/index.js';

export type McpToolSource = 'static' | 'external-or-static-fallback';

export type McpServerCatalog = {
  id: 'browser' | 'minimax' | 'rag';
  name: string;
  label: string;
  available: boolean;
  source: McpToolSource;
  tools: ToolDefinition[];
  error?: string;
};

export type McpToolsCatalog = {
  servers: McpServerCatalog[];
};

// Minimal placeholder catalog for `cloudcli-minimax`. The real upstream
// catalog is documented in the `minimax-coding-plan-mcp` package; we list the
// stable tool names so the UI can show *something* even when uvx is not
// available locally. Each entry's description is intentionally concise — the
// payload is informational, not authoritative. A future version will replace
// this with a runtime JSON-RPC `tools/list` probe behind a feature flag.
const MINIMAX_MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'mmx_search_web',
    description: 'Search the public web using the MiniMax search backend.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mmx_read_url',
    description: 'Fetch and summarize the textual content of a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        maxChars: { type: 'number' },
      },
      required: ['url'],
    },
  },
];

async function isUvxAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('which', ['uvx'], { stdio: 'ignore' });
      proc.on('error', () => resolve(false));
      proc.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

export const mcpToolsService = {
  async listTools(): Promise<McpToolsCatalog> {
    const uvxOk = await isUvxAvailable();

    const servers: McpServerCatalog[] = [
      {
        id: 'browser',
        name: 'cloudcli-browser',
        label: 'Browser MCP',
        available: true,
        source: 'static',
        tools: BROWSER_MCP_TOOLS,
      },
      {
        id: 'minimax',
        name: 'cloudcli-minimax',
        label: 'Minimax MCP',
        available: uvxOk,
        source: 'external-or-static-fallback',
        tools: MINIMAX_MCP_TOOLS,
        ...(uvxOk
          ? {}
          : { error: 'uvx not found on PATH. Install uv (https://docs.astral.sh/uv/) to enable cloudcli-minimax.' }),
      },
      {
        id: 'rag',
        name: 'cloudcli-rag',
        label: 'RAG MCP',
        available: true,
        source: 'static',
        tools: RAG_MCP_TOOLS,
      },
    ];

    return { servers };
  },
};
