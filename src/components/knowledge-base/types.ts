export type DocumentStatus = 'pending' | 'indexing' | 'ready' | 'error';

export type DocumentKind =
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'markdown'
  | 'code'
  | 'epub'
  | 'other';

export type KnowledgeDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  chunks: number;
  uploadedAt: string;
  indexedAt: string | null;
  errorMessage?: string | null;
};

export type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  errorMessage?: string;
};

export type DocumentAction = {
  id: 'delete' | 'reindex' | 'download';
  labelKey: string;
  icon: 'trash' | 'refresh' | 'download';
  destructive?: boolean;
};

export type KnowledgeChunk = {
  chunkId: string;
  documentId: string;
  index: number;
  text: string;
};

export type KnowledgeDocumentDetail = {
  document: KnowledgeDocument;
  chunks: KnowledgeChunk[];
};
