import { Download, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';
import { formatBytes } from '../constants';
import type { DocumentAction, DocumentStatus, KnowledgeChunk, KnowledgeDocument } from '../types';
import DocumentIcon from './DocumentIcon';
import DocumentStatusBadge from './DocumentStatusBadge';

type DocumentDetailProps = {
  document: KnowledgeDocument;
  chunks: KnowledgeChunk[];
  isLoadingChunks?: boolean;
  onAction: (action: DocumentAction['id']) => void;
};

const STATUS_BANNER: Record<DocumentStatus, { tone: string; title: string; description: string } | null> = {
  pending: null,
  indexing: {
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    title: 'knowledgeBase.detail.indexingTitle',
    description: 'knowledgeBase.detail.indexingDescription',
  },
  ready: null,
  error: {
    tone: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    title: 'knowledgeBase.detail.errorTitle',
    description: 'knowledgeBase.detail.errorDescription',
  },
};

export default function DocumentDetail({ document, chunks, isLoadingChunks, onAction }: DocumentDetailProps) {
  const { t } = useTranslation();
  const banner = STATUS_BANNER[document.status];
  const preview = chunks.map((chunk) => chunk.text);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-shrink-0 items-start gap-4 border-b border-border/60 px-5 py-4">
        <DocumentIcon kind={document.kind} className="mt-1 h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{document.name}</h2>
            <DocumentStatusBadge status={document.status} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
            <div>
              <dt className="font-medium uppercase tracking-wide text-muted-foreground/70">{t('knowledgeBase.detail.sizeLabel')}</dt>
              <dd className="mt-0.5 text-foreground">{formatBytes(document.sizeBytes)}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-muted-foreground/70">{t('knowledgeBase.detail.chunksLabel')}</dt>
              <dd className="mt-0.5 text-foreground">{document.chunks}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-muted-foreground/70">{t('knowledgeBase.detail.uploadedLabel')}</dt>
              <dd className="mt-0.5 text-foreground">{new Date(document.uploadedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-muted-foreground/70">{t('knowledgeBase.detail.indexedLabel')}</dt>
              <dd className="mt-0.5 text-foreground">
                {document.indexedAt ? new Date(document.indexedAt).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAction('reindex')}
            disabled={document.status === 'indexing' || document.status === 'pending'}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('knowledgeBase.actions.reindex')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAction('download')}
          >
            <Download className="h-3.5 w-3.5" />
            {t('knowledgeBase.actions.download')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAction('delete')}
            className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('knowledgeBase.actions.delete')}
          </Button>
        </div>
      </header>

      {banner && (
        <div className={cn('border-b px-5 py-3 text-sm', banner.tone)}>
          <p className="font-medium">{t(banner.title)}</p>
          {document.errorMessage && document.status === 'error' ? (
            <p className="mt-1 text-xs opacity-90">{document.errorMessage}</p>
          ) : (
            <p className="mt-1 text-xs opacity-90">{t(banner.description)}</p>
          )}
        </div>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('knowledgeBase.detail.previewTitle')}
          </h3>
          {preview.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('knowledgeBase.detail.previewCount', { count: preview.length })}
            </span>
          )}
        </div>
        {preview.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">
              {isLoadingChunks
                ? t('knowledgeBase.detail.previewLoading')
                : t('knowledgeBase.detail.previewEmpty')}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {preview.map((snippet, index) => (
              <li
                key={`${document.id}-chunk-${index}`}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('knowledgeBase.detail.chunkIndex', { index: index + 1 })}
                </div>
                <p className="whitespace-pre-wrap break-words text-foreground/90">{snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
