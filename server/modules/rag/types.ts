export type DocumentKind =
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'csv'
  | 'presentation'
  | 'text'
  | 'markdown'
  | 'code'
  | 'epub'
  | 'other';

export type DocumentStatus = 'pending' | 'indexing' | 'ready' | 'error';

export type RagDocumentRow = {
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

export type RagChunkRow = {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  embedding: string;
  model: string;
  dimensions: number;
  created_at: string;
};

export type RagSearchHit = {
  chunk_id: string;
  document_id: string;
  document_name: string;
  chunk_index: number;
  text: string;
  score: number;
};

export type RagConfigSnapshot = {
  configured: boolean;
  apiKeyPresent: boolean;
  embeddingModel: string;
  embeddingDimensions: number;
  chatModel: string;
  baseUrl: string;
  chunkSize: number;
  chunkOverlap: number;
};
