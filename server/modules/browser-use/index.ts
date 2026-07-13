/**
 * Barrel file for `@/modules/browser-use`. Re-exports the public surface so
 * other modules can pull the browser MCP tool catalog via a module-scoped
 * import path that satisfies the ESLint `boundaries/dependencies` rule.
 */

export { BROWSER_MCP_TOOLS, type ToolDefinition } from './browser-mcp.tools.js';
