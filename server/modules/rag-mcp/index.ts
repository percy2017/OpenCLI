/**
 * Barrel file for `@/modules/rag-mcp`. Re-exports the public surface so other
 * modules can pull the RAG MCP tool catalog via a module-scoped import path
 * that satisfies the ESLint `boundaries/dependencies` rule.
 */

export { RAG_MCP_TOOLS, type RagToolDefinition } from './rag-mcp.tools.js';
