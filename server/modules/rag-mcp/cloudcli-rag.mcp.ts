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

import { ragTools } from './rag-tools.js';

const SERVER_INFO = {
  name: 'cloudcli-rag',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: 'search_knowledge_base',
    description:
      'Search the user’s local knowledge base for documents relevant to a query. ' +
      'Returns the top matching chunks plus a synthesized answer when the MiniMax API key is available. ' +
      'Use this whenever the user references documents they have uploaded, asks about content that could be in their files, ' +
      'or asks a question whose answer should come from their own corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query. Be specific: include the topic, document name, or keyword you expect to find.',
        },
        topK: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'How many chunks to return. Defaults to 5.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_documents',
    description:
      'List every document in the user’s knowledge base with status, chunk count, and indexed timestamp. ' +
      'Use this before answering questions about file inventory, or to verify a document was uploaded successfully.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_document_chunks',
    description:
      'Return the indexed chunks for a single document. Useful for inspecting what was extracted from a file, ' +
      'debugging retrieval results, or quoting the user’s own content back to them with citations.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The document id returned by list_documents.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of chunks to return. Defaults to 50.',
        },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
  },
];

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
          protocolVersion: '2024-11-05',
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
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const response = await handle(line);
          if (response) {
            process.stdout.write(response + '\n');
          }
        } catch (error) {
          // Never crash the server on a single bad request.
          const message = error instanceof Error ? error.message : 'Unknown error';
          process.stderr.write(`[cloudcli-rag] handler error: ${message}\n`);
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

void main();
