#!/usr/bin/env node
import './load-env.js';

import { BROWSER_MCP_TOOLS } from './modules/browser-use/browser-mcp.tools.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const textResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

const jsonResponse = (value: unknown) => textResponse(JSON.stringify(value, null, 2));

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const apiUrl = (process.env.CLOUDCLI_BROWSER_USE_API_URL || 'http://127.0.0.1:3001/api/browser-use-mcp').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_BROWSER_USE_MCP_TOKEN || '';
const API_TIMEOUT_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_API_TIMEOUT_MS || '60000', 10);

async function callBrowserUseApi(toolName: string, input: Record<string, unknown>) {
  if (!apiToken) {
    throw new Error('CLOUDCLI_BROWSER_USE_MCP_TOKEN is not configured.');
  }

  const response = await fetch(`${apiUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await response.json() as { success?: boolean; data?: unknown; error?: string };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Browser API request failed (${response.status})`);
  }
  return data.data;
}

const sessionIdSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Browser session id.' },
  },
  required: ['sessionId'],
};

// Re-export so downstream readers can `import { tools } from './browser-use-mcp.ts'`
// while the single source of truth lives in `./browser-mcp.tools.ts`. The shape
// matches the JSON-RPC `tools/list` payload verbatim.
const tools = BROWSER_MCP_TOOLS;

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'browser_create_session':
      return jsonResponse(await callBrowserUseApi(name, {
        profileName: readOptionalString(args.profileName),
      }));
    case 'browser_list_sessions':
      return jsonResponse(await callBrowserUseApi(name, {}));
    case 'browser_snapshot':
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    case 'browser_take_screenshot': {
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    }
    case 'browser_navigate':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        url: readString(args.url, 'url'),
      }));
    case 'browser_click':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readOptionalString(args.selector),
        text: readOptionalString(args.text),
        x: readNumber(args.x),
        y: readNumber(args.y),
      }));
    case 'browser_type':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readOptionalString(args.selector),
        text: readString(args.text, 'text'),
        submit: args.submit === true,
      }));
    case 'browser_fill_form': {
      const fields = Array.isArray(args.fields)
        ? args.fields.map((field) => {
          const record = field as Record<string, unknown>;
          return {
            selector: readString(record.selector, 'field.selector'),
            value: readString(record.value, 'field.value'),
          };
        })
        : [];
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        fields,
      }));
    }
    case 'browser_press_key':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        key: readString(args.key, 'key'),
      }));
    case 'browser_select_option':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        selector: readString(args.selector, 'selector'),
        values: Array.isArray(args.values) ? args.values.filter((value): value is string => typeof value === 'string') : [],
      }));
    case 'browser_wait_for':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        text: readOptionalString(args.text),
        url: readOptionalString(args.url),
        timeoutMs: readNumber(args.timeoutMs),
      }));
    case 'browser_tabs':
      return jsonResponse(await callBrowserUseApi(name, {
        sessionId: readString(args.sessionId, 'sessionId'),
        action: args.action === 'new' || args.action === 'select' || args.action === 'close' || args.action === 'list'
          ? args.action
          : undefined,
        index: readNumber(args.index),
        url: readOptionalString(args.url),
      }));
    case 'browser_close_session':
      return jsonResponse(await callBrowserUseApi(name, { sessionId: readString(args.sessionId, 'sessionId') }));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cloudcli-browser', version: '1.0.0' },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
  }

  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = readString(params.name, 'name');
    const args = (params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;
    return callTool(name, args);
  }

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(message: Record<string, unknown>) {
  // MCP stdio transport uses newline-delimited JSON (one JSON-RPC message per line,
  // no embedded newlines). This is NOT the LSP Content-Length framing.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: string | number | null | undefined, result: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null | undefined, error: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const rawMessage = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!rawMessage) {
      continue;
    }

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch (error) {
        sendError(null, error);
        return;
      }
      try {
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
  }
});
