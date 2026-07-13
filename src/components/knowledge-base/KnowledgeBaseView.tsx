import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, UploadCloud } from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';
import { Button } from '../../shared/view/ui';
import type {
  DocumentAction,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  UploadItem,
} from './types';
import DocumentDetail from './components/DocumentDetail';
import DocumentList from './components/DocumentList';
import EmptyState from './components/EmptyState';
import UploadModal from './components/UploadModal';

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

function generateLocalId(): string {
  return `doc-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function KnowledgeBaseView() {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeDocumentDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const documentsRef = useRef<KnowledgeDocument[]>([]);
  documentsRef.current = documents;

  const loadList = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/rag/documents');
      const data = await readJson<{ data: KnowledgeDocument[] }>(response);
      setDocuments(data.data ?? []);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : t('knowledgeBase.errors.loadFailed'));
    } finally {
      setIsLoadingList(false);
    }
  }, [t]);

  const loadDetail = useCallback(async (id: string) => {
    setIsLoadingDetail(true);
    try {
      const response = await authenticatedFetch(`/api/rag/documents/${id}/chunks`);
      const data = await readJson<{ data: KnowledgeDocumentDetail }>(response);
      setSelectedDetail(data.data);
    } catch (error) {
      setSelectedDetail(null);
      setGlobalError(error instanceof Error ? error.message : t('knowledgeBase.errors.loadFailed'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleListAction = useCallback(
    async (id: string, action: DocumentAction['id']) => {
      if (action === 'delete') {
        try {
          await readJson(await authenticatedFetch(`/api/rag/documents/${id}`, { method: 'DELETE' }));
          if (selectedId === id) {
            setSelectedId(null);
          }
          await loadList();
        } catch (error) {
          setGlobalError(error instanceof Error ? error.message : t('knowledgeBase.errors.deleteFailed'));
        }
      } else if (action === 'reindex') {
        try {
          await readJson(await authenticatedFetch(`/api/rag/documents/${id}/reindex`, { method: 'POST' }));
          if (selectedId === id) {
            await loadDetail(id);
          }
          await loadList();
        } catch (error) {
          setGlobalError(error instanceof Error ? error.message : t('knowledgeBase.errors.reindexFailed'));
        }
      } else if (action === 'download') {
        try {
          const response = await authenticatedFetch(`/api/rag/documents/${id}/download`);
          if (!response.ok) {
            throw new Error(`Download failed (${response.status})`);
          }
          const blob = await response.blob();
          const doc = documentsRef.current.find((d) => d.id === id);
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = doc?.name ?? `document-${id}`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        } catch (error) {
          setGlobalError(error instanceof Error ? error.message : t('knowledgeBase.errors.downloadFailed'));
        }
      }
    },
    [loadList, loadDetail, selectedId, t],
  );

  const handleDetailAction = useCallback(
    (action: DocumentAction['id']) => {
      if (!selectedId) return;
      void handleListAction(selectedId, action);
    },
    [handleListAction, selectedId],
  );

  const handleUploadSubmit = useCallback(
    async (items: UploadItem[]) => {
      const optimisticIds: string[] = [];

      // Optimistic placeholders so the list reflects the new uploads immediately.
      const nowIso = new Date().toISOString();
      const optimistic: KnowledgeDocument[] = items.map((item) => {
        const id = generateLocalId();
        optimisticIds.push(id);
        return {
          id,
          name: item.file.name,
          kind: 'other',
          mimeType: item.file.type || 'application/octet-stream',
          sizeBytes: item.file.size,
          status: 'pending',
          chunks: 0,
          uploadedAt: nowIso,
          indexedAt: null,
        };
      });
      setDocuments((current) => [...optimistic, ...current]);
      if (optimistic.length > 0) {
        setSelectedId(null);
      }

      // Upload each file. On success we patch the optimistic row with the real id+status.
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const localId = optimisticIds[i];
        try {
          const response = await authenticatedFetch('/api/rag/documents', {
            method: 'POST',
            headers: { 'X-Filename': item.file.name, 'Content-Type': item.file.type || 'application/octet-stream' },
            body: item.file,
          });
          const created = await readJson<{ data: KnowledgeDocument }>(response);
          // Replace optimistic row with the server row.
          setDocuments((current) =>
            current.map((doc) =>
              doc.id === localId
                ? {
                    ...created.data,
                    // Keep optimistic order in the list.
                    uploadedAt: doc.uploadedAt,
                  }
                : doc,
            ),
          );
          // Auto-select the first successful upload.
          if (i === 0) {
            setSelectedId(created.data.id);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : t('knowledgeBase.errors.uploadFailed');
          setDocuments((current) =>
            current.map((doc) =>
              doc.id === localId
                ? { ...doc, status: 'error', errorMessage: message }
                : doc,
            ),
          );
          setGlobalError(message);
        }
      }

      // Refresh from the server to pick up any state changes (counts, indexed_at).
      await loadList();
    },
    [loadList, t],
  );

  const selected = useMemo<KnowledgeDocument | null>(() => {
    if (!selectedId) return null;
    return documents.find((doc) => doc.id === selectedId) ?? null;
  }, [documents, selectedId]);

  const previewChunks: KnowledgeChunk[] = useMemo(() => {
    if (selectedDetail?.chunks) return selectedDetail.chunks;
    return [];
  }, [selectedDetail]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
        <div className="space-y-0.5">
          <h1 className="text-base font-semibold text-foreground">{t('knowledgeBase.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('knowledgeBase.description')}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setIsUploadOpen(true)}>
          <UploadCloud className="h-4 w-4" />
          {t('knowledgeBase.uploadCta')}
        </Button>
      </header>

      {globalError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-700 dark:text-red-300">
          {globalError}
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            className="ml-3 text-red-700 underline-offset-2 hover:underline dark:text-red-300"
          >
            {t('knowledgeBase.errors.dismiss')}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {documents.length === 0 && !isLoadingList ? (
          <EmptyState onUpload={() => setIsUploadOpen(true)} />
        ) : (
          <>
            <div className="hidden w-72 flex-shrink-0 sm:block">
              <DocumentList
                documents={documents}
                selectedId={selectedId}
                onSelect={handleSelect}
                onAction={handleListAction}
              />
            </div>
            {selected ? (
              <DocumentDetail
                document={selected}
                chunks={previewChunks}
                isLoadingChunks={isLoadingDetail}
                onAction={handleDetailAction}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {isLoadingList ? t('knowledgeBase.detail.loadingList') : t('knowledgeBase.detail.selectPrompt')}
              </div>
            )}
          </>
        )}
      </div>

      {documents.length > 0 && (
        <button
          type="button"
          onClick={() => setIsUploadOpen(true)}
          className="sm:hidden fixed bottom-6 right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          aria-label={t('knowledgeBase.uploadCta')}
        >
          <Plus className="h-5 w-5" />
        </button>
      )}

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUpload={handleUploadSubmit}
      />
    </div>
  );
}
