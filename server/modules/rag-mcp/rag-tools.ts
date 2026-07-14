/**
 * Thin wrappers around the rag service used by the cloudli-rag MCP server.
 *
 * Lives in its own module so the stdio JSON-RPC layer above stays focused on
 * protocol plumbing. The service module is loaded lazily on the first tool
 * invocation to avoid pulling SQLite / better-sqlite3 init into the
 * top-level import graph of the MCP entry point.
 *
 * The MCP subprocess is spawned independently of the Express backend, so it
 * must run migrations on its own before touching the DB. Otherwise the
 * `rag_documents` / `rag_chunks` tables are missing the first time a tool is
 * called and `list_documents` returns "no such table". This bootstrap is
 * idempotent (CREATE TABLE IF NOT EXISTS + per-migration guards).
 */

type RagToolSearchArgs = {
  query: string;
  topK?: number;
};

type RagToolGetChunksArgs = {
  documentId: string;
  limit?: number;
};

let bootstrapPromise: Promise<void> | null = null;

async function ensureSchema() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const { getConnection } = await import('@/modules/database/connection.js');
    const schemaModule = await import('@/modules/database/schema.js');
    const migrationsModule = await import('@/modules/database/migrations.js');

    const db = getConnection();
    db.exec(schemaModule.INIT_SCHEMA_SQL);
    db.exec(schemaModule.RAG_DOCUMENTS_TABLE_SCHEMA_SQL);
    db.exec(schemaModule.RAG_CHUNKS_TABLE_SCHEMA_SQL);
    migrationsModule.runMigrations(db);
  })();
  return bootstrapPromise;
}

async function getService() {
  await ensureSchema();
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
