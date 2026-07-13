/**
 * Thin wrappers around the rag service used by the cloudli-rag MCP server.
 *
 * Lives in its own module so the stdio JSON-RPC layer above stays focused on
 * protocol plumbing. The service module is loaded lazily on the first tool
 * invocation to avoid pulling SQLite / better-sqlite3 init into the
 * top-level import graph of the MCP entry point.
 */

type RagToolSearchArgs = {
  query: string;
  topK?: number;
};

type RagToolGetChunksArgs = {
  documentId: string;
  limit?: number;
};

async function getService() {
  const moduleRef = await import('@/modules/rag/rag.service.js');
  return moduleRef.ragService;
}

export const ragTools = {
  async search({ query, topK }: RagToolSearchArgs) {
    const service = await getService();
    return service.query({ query, topK });
  },

  async list() {
    const service = await getService();
    return service.listDocuments();
  },

  async getChunks({ documentId, limit }: RagToolGetChunksArgs) {
    const service = await getService();
    return service.getChunksForPreview(documentId, limit);
  },
};
