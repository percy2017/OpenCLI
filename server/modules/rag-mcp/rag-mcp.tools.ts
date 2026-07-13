/**
 * Tool catalog for the `cloudcli-rag` MCP server.
 *
 * Extracted from `server/modules/rag-mcp/cloudcli-rag.mcp.ts` so the catalog
 * can be reused by the `/api/mcp-tools` HTTP endpoint without spawning the
 * stdio server. Runtime behavior of `cloudcli-rag.mcp.ts` is unchanged — it
 * imports this constant and serves the same `tools/list` payload over
 * JSON-RPC.
 */

export type RagToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const RAG_MCP_TOOLS: RagToolDefinition[] = [
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
