/**
 * SQLite-backed storage for RAG documents and chunks.
 *
 * Embeddings are stored as JSON-encoded number arrays (TEXT). For v1 we
 * compute cosine similarity in JS over the candidate set — fine up to a few
 * thousand chunks per document; we'll swap in sqlite-vec if corpora grow.
 *
 * No new connection: we reuse the singleton from `@/modules/database/index.js`.
 */

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/index.js';
import type {
  DocumentKind,
  DocumentStatus,
  RagChunkRow,
  RagDocumentRow,
  RagSearchHit,
} from './types.js';

type DocumentRow = {
  document_id: string;
  name: string;
  kind: DocumentKind;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: DocumentStatus;
  chunk_count: number;
  error_message: string | null;
  uploaded_at: string;
  indexed_at: string | null;
};

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  embedding: string;
  model: string;
  dimensions: number;
  created_at: string;
};

function decodeEmbedding(encoded: string): number[] {
  const parsed = JSON.parse(encoded) as number[];
  return Array.isArray(parsed) ? parsed : [];
}

function encodeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

export function listDocuments(): RagDocumentRow[] {
  const db = getConnection();
  return db
    .prepare(
      `SELECT document_id, name, kind, mime_type, size_bytes, storage_path,
              status, chunk_count, error_message, uploaded_at, indexed_at
         FROM rag_documents
        ORDER BY uploaded_at DESC`,
    )
    .all() as DocumentRow[];
}

export function getDocument(id: string): RagDocumentRow | null {
  const db = getConnection();
  const row = db
    .prepare(
      `SELECT document_id, name, kind, mime_type, size_bytes, storage_path,
              status, chunk_count, error_message, uploaded_at, indexed_at
         FROM rag_documents WHERE document_id = ?`,
    )
    .get(id) as DocumentRow | undefined;
  return row ?? null;
}

export function createDocument(input: {
  name: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}): RagDocumentRow {
  const db = getConnection();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rag_documents (document_id, name, kind, mime_type, size_bytes, storage_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(id, input.name, input.kind, input.mimeType, input.sizeBytes, input.storagePath);
  const created = getDocument(id);
  if (!created) {
    throw new Error('Failed to read back created RAG document row.');
  }
  return created;
}

export function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  fields: { chunkCount?: number; errorMessage?: string | null; indexedAt?: string | null } = {},
): void {
  const db = getConnection();
  const updates: string[] = ['status = ?'];
  const values: Array<string | number | null> = [status];

  if (fields.chunkCount !== undefined) {
    updates.push('chunk_count = ?');
    values.push(fields.chunkCount);
  }
  if (fields.errorMessage !== undefined) {
    updates.push('error_message = ?');
    values.push(fields.errorMessage);
  }
  if (fields.indexedAt !== undefined) {
    updates.push('indexed_at = ?');
    values.push(fields.indexedAt);
  }

  values.push(id);
  db.prepare(`UPDATE rag_documents SET ${updates.join(', ')} WHERE document_id = ?`).run(...values);
}

export function deleteDocument(id: string): void {
  const db = getConnection();
  // FK constraint ensures chunks cascade-delete if PRAGMA foreign_keys = ON.
  db.prepare('DELETE FROM rag_documents WHERE document_id = ?').run(id);
}

export function deleteChunksForDocument(id: string): void {
  const db = getConnection();
  db.prepare('DELETE FROM rag_chunks WHERE document_id = ?').run(id);
}

export function insertChunks(
  documentId: string,
  chunks: Array<{ chunkIndex: number; text: string; embedding: number[]; provider: string; model: string; dimensions: number }>,
): void {
  const db = getConnection();
  const insert = db.prepare(
    `INSERT INTO rag_chunks (chunk_id, document_id, chunk_index, text, embedding, provider, model, dimensions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: typeof chunks) => {
    for (const row of rows) {
      insert.run(
        randomUUID(),
        documentId,
        row.chunkIndex,
        row.text,
        encodeEmbedding(row.embedding),
        row.provider,
        row.model,
        row.dimensions,
      );
    }
  });
  tx(chunks);
}

export function listChunksForDocument(documentId: string, limit = 50): RagChunkRow[] {
  const db = getConnection();
  return db
    .prepare(
      `SELECT chunk_id, document_id, chunk_index, text, embedding, model, dimensions, created_at
         FROM rag_chunks
        WHERE document_id = ?
        ORDER BY chunk_index ASC
        LIMIT ?`,
    )
    .all(documentId, limit) as ChunkRow[];
}

export function countChunks(documentId: string): number {
  const db = getConnection();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM rag_chunks WHERE document_id = ?')
    .get(documentId) as { n: number };
  return row.n;
}

/**
 * Sweep documents stuck in `indexing` for longer than `maxAgeMs` (defaults
 * to 5 minutes). These are usually leftovers from a backend restart that
 * happened mid-pipeline — the catch block in `indexFromDisk` never ran, so
 * the row sits in `indexing` forever and the UI shows "Esperando
 * indexación". Marking them as `error` lets the user retry without
 * restarting the server.
 */
export function reapStuckIndexingDocuments(
  maxAgeMs: number = 5 * 60 * 1000,
): Array<{ document_id: string; name: string; stuckForSeconds: number }> {
  const db = getConnection();
  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString().replace('T', ' ').replace(/\..+$/, '');
  const stuck = db
    .prepare(
      `SELECT document_id, name,
              CAST((julianday('now') - julianday(uploaded_at)) * 86400 AS INTEGER) AS stuck_seconds
         FROM rag_documents
        WHERE status = 'indexing'
          AND uploaded_at < ?`,
    )
    .all(cutoffIso) as Array<{ document_id: string; name: string; stuck_seconds: number }>;

  if (stuck.length === 0) return [];

  const update = db.prepare(
    `UPDATE rag_documents
        SET status = 'error',
            error_message = 'Indexing interrupted (server restarted or pipeline crashed). Click Reindex to retry.'
      WHERE document_id = ?`,
  );
  const tx = db.transaction((rows: typeof stuck) => {
    for (const row of rows) update.run(row.document_id);
  });
  tx(stuck);

  return stuck.map((row) => ({
    document_id: row.document_id,
    name: row.name,
    stuckForSeconds: row.stuck_seconds,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchChunks(
  queryEmbedding: number[],
  topK: number,
  options: { documentIds?: string[]; provider?: string; dimensions?: number } = {},
): RagSearchHit[] {
  const db = getConnection();
  const params: Array<string | number> = [];
  const filters: string[] = [];

  if (options.documentIds && options.documentIds.length > 0) {
    const placeholders = options.documentIds.map(() => '?').join(',');
    filters.push(`rd.document_id IN (${placeholders})`);
    params.push(...options.documentIds);
  }
  if (options.provider) {
    filters.push('rc.provider = ?');
    params.push(options.provider);
  }
  if (options.dimensions !== undefined) {
    filters.push('rc.dimensions = ?');
    params.push(options.dimensions);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT rc.chunk_id, rc.document_id, rc.chunk_index, rc.text, rc.embedding,
              rd.name AS document_name
         FROM rag_chunks rc
         JOIN rag_documents rd ON rd.document_id = rc.document_id
         ${where}`,
    )
    .all(...params) as Array<{
      chunk_id: string;
      document_id: string;
      chunk_index: number;
      text: string;
      embedding: string;
      document_name: string;
    }>;

  const scored = rows.map((row) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    document_name: row.document_name,
    chunk_index: row.chunk_index,
    text: row.text,
    score: cosineSimilarity(queryEmbedding, decodeEmbedding(row.embedding)),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK));
}
