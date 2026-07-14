/**
 * cloudli-rag — stdio MCP server exposing the local knowledge base.
 *
 * Speaks JSON-RPC 2.0 over stdin/stdout (one JSON object per line, no framing).
 * Protocol surface (subset that Claude/Codex actually call):
 *   - initialize          -> returns server info + capabilities
 *   - tools/list          -> returns 3 tools: search_knowledge_base, list_documents, get_document_chunks
 *   - tools/call          -> dispatches by tool name and writes back content
 *
 * The file is intentionally dependency-free so we don't add another npm package.
 * The real backing logic lives in `./rag-tools.js` which in turn delegates to
 * `@/modules/rag/rag.service.js`.
 *
 * Args accepted (env vars win, fallbacks below):
 *   - ctx.requestedLlmModel  -> forwarded to rag.service.query via env var
 *   - all rag-service env vars (MINIMAX_API_KEY, MINIMAX_BASE_URL, ...) are read
 *     directly by the service.
 */

import process from 'node:process';

import { RAG_MCP_TOOLS } from './rag-mcp.tools.js';
import { ragTools } from './rag-tools.js';

const SERVER_INFO = {
  name: 'cloudcli-rag',
  version: '1.0.1',
};

// Declaring `resources: {}` advertises resource capability to MCP clients so
// they don't fail the connection with `unknown MCP server` when they issue a
// `resources/list` preflight before surfacing tools. We expose zero resources
// (this server is tool-only) — handlers below return an empty list.
const CAPABILITIES = {
  tools: {},
  resources: {},
};

const TOOLS = RAG_MCP_TOOLS;

type JsonRpcRequest = {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function respond(id: string | number | null, resultOrError: { result?: unknown; error?: { code: number; message: string; data?: unknown } }): string {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: id ?? null,
    ...(resultOrError.error ? { error: resultOrError.error } : {}),
    ...(resultOrError.result !== undefined ? { result: resultOrError.result } : {}),
  };
  return JSON.stringify(response);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === 'search_knowledge_base') {
    const query = asString(args.query);
    if (!query || !query.trim()) {
      throw new Error('`query` must be a non-empty string.');
    }
    const topK = asNumber(args.topK);
    const result = await ragTools.search({ query, topK });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'list_documents') {
    const docs = await ragTools.list();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(docs, null, 2),
        },
      ],
    };
  }

  if (name === 'get_document_chunks') {
    const documentId = asString(args.documentId);
    if (!documentId) {
      throw new Error('`documentId` must be a non-empty string.');
    }
    const limit = asNumber(args.limit);
    const result = await ragTools.getChunks({ documentId, limit });
    if (!result) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Document not found.' }, null, 2),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(line: string): Promise<string | null> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return null;
  }

  if (!request || request.jsonrpc !== '2.0') return null;
  const id = request.id ?? null;
  const method = request.method;

  // Notifications (no id) — ignore; we don't subscribe to anything.
  if (id === null || id === undefined) {
    return null;
  }

  try {
    if (method === 'initialize') {
      // Negotiate the protocol version with the client. The MCP spec (and
      // rmcp specifically) requires the server to echo back the highest
      // version both sides support. If we hard-code `2025-03-26` here while
      // the client requests `2025-06-18`, rmcp fails the handshake with
      // `UnsupportedProtocolVersion` and never registers our tools — the
      // model then sees "unsupported call" for every tool name.
      const requested = (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const negotiated =
        typeof requested === 'string' && requested.length > 0 ? requested : '2025-06-18';
      return respond(id, {
        result: {
          protocolVersion: negotiated,
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        },
      });
    }

    if (method === 'notifications/initialized') {
      // Spec says: client must send this before invoking tools. We no-op.
      return null;
    }

    if (method === 'ping') {
      return respond(id, { result: {} });
    }

    if (method === 'tools/list') {
      return respond(id, { result: { tools: TOOLS } });
    }

    // Tool-call and resource handlers MUST NOT exist before declaring
    // resources: {} in CAPABILITIES (above) — otherwise MCP clients that
    // preflight resources/list reject the server as unknown.

    if (method === 'resources/list') {
      return respond(id, { result: { resources: [] } });
    }

    if (method === 'resources/templates/list') {
      return respond(id, { result: { resourceTemplates: [] } });
    }

    if (method === 'resources/read') {
      return respond(id, {
        error: { code: -32602, message: 'This server does not expose resources. Use the search_knowledge_base, list_documents, or get_document_chunks tools instead.' },
      });
    }

    if (method === 'tools/call') {
      const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = asString(params.name);
      if (!toolName) {
        throw new Error('`name` parameter is required.');
      }
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(toolName, toolArgs);
      return respond(id, { result });
    }

    return respond(id, {
      error: { code: -32601, message: `Method not found: ${method ?? '<empty>'}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return respond(id, {
      error: { code: -32000, message },
    });
  }
}

function installSignalHandlers() {
  const shutdown = () => {
    // Best-effort flush; stdio closes on process exit anyway.
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  installSignalHandlers();

  let buffer = '';
  // Track in-flight handler promises so a premature stdin close doesn't kill
  // them mid-await. Hosts like Codex close stdin right after the last request
  // line of the *initial* handshake (initialize + notifications/initialized +
  // tools/list), then reconnect later when the model actually invokes a tool.
  // We MUST stay alive across that gap — killing the process on stdin end
  // makes the model get "unsupported call" because the MCP client's runtime
  // has no live process to forward the call to.
  let inFlight = 0;

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        inFlight += 1;
        handle(line)
          .then((response) => {
            if (response) {
              process.stdout.write(response + '\n');
            }
          })
          .catch((error) => {
            // Never crash the server on a single bad request.
            const message = error instanceof Error ? error.message : 'Unknown error';
            process.stderr.write(`[cloudcli-rag] handler error: ${message}\n`);
          })
          .finally(() => {
            inFlight -= 1;
          });
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  // Intentionally do NOT exit on stdin 'end'. Codex (via rmcp) closes stdin
  // after the startup handshake but keeps the subprocess around to handle
  // later tool calls. If we exit here, every subsequent `tools/call` from the
  // model lands on a dead process and the user sees "unsupported call".
  // The process only exits via SIGINT / SIGTERM, both of which already wire
  // to `process.exit(0)` in installSignalHandlers() above.
}

void main();
