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
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
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
      return respond(id, {
        result: {
          protocolVersion: '2025-03-26',
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
  // them mid-await. Hosts like Codex close stdin immediately after writing the
  // last request line, but tool calls can take seconds (RAG embeddings + chat
  // synthesis). We let the handlers complete and only exit once stdout drains.
  let inFlight = 0;
  let settled = false;

  const tryExit = () => {
    if (settled && inFlight === 0) {
      process.exit(0);
    }
  };

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
            tryExit();
          });
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  process.stdin.on('end', () => {
    // stdin closed by the host. Don't kill the process — wait for in-flight
    // handlers to finish writing their responses, then exit.
    settled = true;
    tryExit();
  });
}

void main();
