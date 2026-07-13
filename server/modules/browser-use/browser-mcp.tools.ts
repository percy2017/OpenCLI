/**
 * Tool catalog for the `cloudcli-browser` MCP server.
 *
 * Extracted from `server/browser-use-mcp.ts` so the catalog can be reused by
 * the `/api/mcp-tools` HTTP endpoint without having to spawn the stdio server
 * to enumerate its `tools/list`. Runtime behavior of `browser-use-mcp.ts` is
 * unchanged — it imports this constant and serves the same `tools/list`
 * payload over JSON-RPC.
 */

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const sessionIdSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Browser session id.' },
  },
  required: ['sessionId'],
};

export const BROWSER_MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'browser_create_session',
    description: 'Create a temporary Browser session that the agent can control. Optionally provide a background profileName to reuse cookies and storage.',
    inputSchema: {
      type: 'object',
      properties: {
        profileName: { type: 'string', description: 'Optional background profile name for persistent browser storage.' },
      },
    },
  },
  {
    name: 'browser_list_sessions',
    description: 'List Browser sessions currently available to agents.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture current page metadata, screenshot data URL, and visible body text for a Browser session.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'browser_take_screenshot',
    description: 'Capture the latest screenshot for a Browser session.',
    inputSchema: sessionIdSchema,
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a Browser session to an HTTP or HTTPS URL.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['sessionId', 'url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector, visible text, or x/y coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into the focused page or fill a CSS selector. Set submit to press Enter after typing.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['sessionId', 'text'],
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields using CSS selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['selector', 'value'],
          },
        },
      },
      required: ['sessionId', 'fields'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key, for example Enter, Escape, Tab, or Control+A.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['sessionId', 'key'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select option values in a select element found by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        selector: { type: 'string' },
        values: { type: 'array', items: { type: 'string' } },
      },
      required: ['sessionId', 'selector', 'values'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait for visible text, a URL pattern, or a short timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        text: { type: 'string' },
        url: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_tabs',
    description: 'List, open, select, or close tabs in a Browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        index: { type: 'number' },
        url: { type: 'string' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'browser_close_session',
    description: 'Stop a Browser session controlled by agents.',
    inputSchema: sessionIdSchema,
  },
];
