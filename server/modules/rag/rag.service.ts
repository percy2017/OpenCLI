/**
 * RAG service: orchestrates upload → parse → chunk → embed → store → query.
 *
 * Uploads land in `~/.cloudcli/rag/documents/<uuid>.<ext>`. The pipeline
 * runs synchronously inside the upload request for v1 (small files, fast
 * enough for the UI to update status in one round trip). A queue can be
 * added later without changing the route shape.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getConnection } from '@/modules/database/index.js';
import { chunkText } from './chunker.js';
import { chatComplete } from './chat.js';
import { EmbeddingsConfigError } from './embedding-providers/embedding-provider.js';
import { embedTexts, getEmbeddingProvider } from './embedding-providers/registry.js';
import { parseFile } from './parser.js';
import {
  countChunks,
  createDocument,
  deleteChunksForDocument,
  deleteDocument,
  getDocument,
  insertChunks,
  listChunksForDocument,
  listDocuments,
  reapStuckIndexingDocuments,
  searchChunks,
  updateDocumentStatus,
} from './store.js';
import type { DocumentKind, RagDocumentRow, RagSearchHit } from './types.js';

const RAG_ROOT = path.join(os.homedir(), '.cloudcli', 'rag');
const DOCUMENTS_DIR = path.join(RAG_ROOT, 'documents');

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

async function ensureRagRoot(): Promise<void> {
  await mkdir(DOCUMENTS_DIR, { recursive: true });
}

function mapDocument(row: RagDocumentRow) {
  return {
    id: row.document_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    chunks: row.chunk_count,
    errorMessage: row.error_message,
    uploadedAt: row.uploaded_at,
    indexedAt: row.indexed_at,
  };
}

export const ragService = {
  async getConfig() {
    return getEmbeddingProvider().getConfig();
  },

  async listDocuments() {
    return listDocuments().map(mapDocument);
  },

  async getDocument(id: string) {
    const row = getDocument(id);
    return row ? mapDocument(row) : null;
  },

  async getChunks(id: string) {
    const rows = listChunksForDocument(id);
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      index: row.chunk_index,
      text: row.text,
    }));
  },

  async deleteDocument(id: string) {
    const row = getDocument(id);
    if (!row) return;
    try {
      await rm(row.storage_path, { force: true });
    } catch {
      // best-effort file removal; DB row is the source of truth
    }
    deleteDocument(id);
  },

  async reindex(id: string) {
    const row = getDocument(id);
    if (!row) {
      throw new Error('Document not found.');
    }
    return this.indexFromDisk({
      documentId: row.document_id,
      storagePath: row.storage_path,
      name: row.name,
      kind: row.kind,
    });
  },

  async uploadAndIndex(filename: string, bytes: Buffer) {
    await ensureRagRoot();

    const extension = getExtension(filename);
    const documentId = await this.reserveDocument(filename, bytes.length);
    const storagePath = path.join(DOCUMENTS_DIR, `${documentId}${extension}`);

    await writeFile(storagePath, bytes);

    // Patch the storage path into the row we just created.
    getConnection()
      .prepare('UPDATE rag_documents SET storage_path = ? WHERE document_id = ?')
      .run(storagePath, documentId);

    return this.indexFromDisk({
      documentId,
      storagePath,
      name: filename,
      kind: getDocument(documentId)!.kind,
    });
  },

  async reserveDocument(filename: string, sizeBytes: number) {
    // Compute kind from extension; we store the row with placeholder storage_path.
    const extension = getExtension(filename);
    const kind = inferKindFromExtension(extension);
    const placeholderPath = path.join(DOCUMENTS_DIR, `pending-${Date.now()}${extension}`);
    const row = createDocument({
      name: filename,
      kind,
      mimeType: inferMimeFromExtension(extension),
      sizeBytes,
      storagePath: placeholderPath,
    });
    return row.document_id;
  },

  async indexFromDisk(input: {
    documentId: string;
    storagePath: string;
    name: string;
    kind: DocumentKind;
  }) {
    updateDocumentStatus(input.documentId, 'indexing', { errorMessage: null });

    try {
      const provider = getEmbeddingProvider();
      const config = await provider.getConfig();
      const parsed = await parseFile(input.storagePath, input.name);
      const chunks = chunkText(parsed.text, config.chunkSize, config.chunkOverlap);

      if (chunks.length === 0) {
        deleteChunksForDocument(input.documentId);
        updateDocumentStatus(input.documentId, 'ready', {
          chunkCount: 0,
          indexedAt: new Date().toISOString(),
        });
        return { ...mapDocument(getDocument(input.documentId)!), chunks: [] as Array<{ chunkId: string; documentId: string; index: number; text: string }> };
      }

      // Wipe old chunks in case of reindex.
      deleteChunksForDocument(input.documentId);

      const embedded = await embedTexts({ texts: chunks.map((c) => c.text), isQuery: false });

      const rows = chunks.map((chunk, idx) => ({
        chunkIndex: chunk.index,
        text: chunk.text,
        embedding: embedded.vectors[idx] ?? [],
        provider: provider.id,
        model: embedded.model,
        dimensions: embedded.dimensions,
      }));
      insertChunks(input.documentId, rows);

      updateDocumentStatus(input.documentId, 'ready', {
        chunkCount: rows.length,
        indexedAt: new Date().toISOString(),
      });

      return {
        ...mapDocument(getDocument(input.documentId)!),
        chunks: rows.map((row, idx) => ({
          chunkId: `pending-${idx}`,
          documentId: input.documentId,
          index: row.chunkIndex,
          text: row.text,
        })),
      };
    } catch (error) {
      const message =
        error instanceof EmbeddingsConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Indexing failed.';
      updateDocumentStatus(input.documentId, 'error', { errorMessage: message });
      throw error;
    }
  },

  async query(input: { query: string; topK?: number; documentIds?: string[] }) {
    const trimmed = input.query.trim();
    if (!trimmed) {
      throw new Error('Query must not be empty.');
    }

    const provider = getEmbeddingProvider();
    const config = await provider.getConfig();
    const queryEmbedding = await embedTexts({ texts: [trimmed], isQuery: true });
    const vector = queryEmbedding.vectors[0];
    if (!vector) {
      throw new Error('Failed to embed query.');
    }

    const topK = Math.max(1, Math.min(20, input.topK ?? 5));
    // Filter by the active provider + dims so vectors from a previous
    // provider are never scored against new query vectors (different
    // dimensions produce nonsense similarity).
    const hits = searchChunks(vector, topK, {
      documentIds: input.documentIds,
      provider: provider.id,
      dimensions: queryEmbedding.dimensions,
    });

    if (hits.length === 0) {
      return {
        answer: config.apiKeyPresent
          ? 'No relevant documents found in the knowledge base.'
          : `${config.providerLabel} is not configured. Set the required API key/host and reindex documents.`,
        hits: [] as RagSearchHit[],
        model: config.chatModel,
      };
    }

    const context = hits
      .map((hit, idx) => `[${idx + 1}] (${hit.document_name} #${hit.chunk_index})\n${hit.text}`)
      .join('\n\n');

    const systemPrompt =
      'You are a retrieval-augmented assistant. Answer the user question using ONLY the provided context. ' +
      'If the context does not contain the answer, say you do not know. ' +
      'Cite sources inline as [n] where n is the number of the matching context block.';

    const userPrompt = `Context:\n${context}\n\nQuestion: ${trimmed}`;

    let answer: string;
    let model: string;
    try {
      const completion = await chatComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.3, maxTokens: 1024 },
      );
      answer = completion.content;
      model = completion.model;
    } catch (error) {
      // The chat synthesis is a nice-to-have — the chunks themselves are the
      // primary payload. If synthesis fails (no API key, missing chat model,
      // upstream 5xx) we still return the hits so the agent can quote them.
      const message = error instanceof Error ? error.message : 'Unknown error';
      answer = `Found ${hits.length} relevant chunk${hits.length === 1 ? '' : 's'} but could not synthesize a natural-language answer (${message}). The raw chunks are below.`;
      model = 'fallback';
    }

    return {
      answer,
      hits,
      model,
    };
  },

  async getChunksForPreview(id: string, limit = 5) {
    const row = getDocument(id);
    if (!row) return null;
    const chunks = listChunksForDocument(id, limit);
    return {
      document: mapDocument(row),
      chunks: chunks.map((chunk) => ({
        chunkId: chunk.chunk_id,
        documentId: chunk.document_id,
        index: chunk.chunk_index,
        text: chunk.text,
      })),
    };
  },

  async readRawFile(id: string) {
    const row = getDocument(id);
    if (!row) return null;
    const bytes = await readFile(row.storage_path);
    return { name: row.name, mimeType: row.mime_type, bytes };
  },

  countChunks,
  reapStuckIndexingDocuments,
};

function inferKindFromExtension(ext: string): DocumentKind {
  const cleaned = ext.replace(/^\./, '').toLowerCase();
  const map: Record<string, DocumentKind> = {
    pdf: 'pdf',
    doc: 'word',
    docx: 'word',
    odt: 'word',
    rtf: 'word',
    xls: 'spreadsheet',
    xlsx: 'spreadsheet',
    ods: 'spreadsheet',
    csv: 'spreadsheet',
    ppt: 'presentation',
    pptx: 'presentation',
    odp: 'presentation',
    txt: 'text',
    md: 'markdown',
    markdown: 'markdown',
    rst: 'text',
    epub: 'epub',
    ts: 'code',
    tsx: 'code',
    js: 'code',
    jsx: 'code',
    mjs: 'code',
    cjs: 'code',
    py: 'code',
    rs: 'code',
    go: 'code',
    java: 'code',
    c: 'code',
    h: 'code',
    cpp: 'code',
    hpp: 'code',
    cc: 'code',
    cs: 'code',
    rb: 'code',
    php: 'code',
    swift: 'code',
    kt: 'code',
    sh: 'code',
    bash: 'code',
    zsh: 'code',
    css: 'code',
    scss: 'code',
    sass: 'code',
    less: 'code',
    html: 'code',
    htm: 'code',
    xml: 'code',
    json: 'code',
    yaml: 'code',
    yml: 'code',
    toml: 'code',
    sql: 'code',
    vue: 'code',
    svelte: 'code',
    lua: 'code',
  };
  return map[cleaned] ?? 'other';
}

function inferMimeFromExtension(ext: string): string {
  const cleaned = ext.replace(/^\./, '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    csv: 'text/csv',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odp: 'application/vnd.oasis.opendocument.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    rst: 'text/plain',
    epub: 'application/epub+zip',
    json: 'application/json',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return map[cleaned] ?? 'application/octet-stream';
}
