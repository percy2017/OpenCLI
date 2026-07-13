import { useTranslation } from 'react-i18next';
import { MoreHorizontal, RefreshCw, Trash2, Download } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { formatBytes, formatRelativeTime } from '../constants';
import type { DocumentAction, KnowledgeDocument } from '../types';
import DocumentIcon from './DocumentIcon';
import DocumentStatusBadge from './DocumentStatusBadge';

type DocumentListItemProps = {
  document: KnowledgeDocument;
  isActive: boolean;
  onSelect: () => void;
  onAction: (action: DocumentAction['id']) => void;
};

const ICON_BY_KEY = {
  trash: Trash2,
  refresh: RefreshCw,
  download: Download,
} as const;

export default function DocumentListItem({ document, isActive, onSelect, onAction }: DocumentListItemProps) {
  const { t } = useTranslation();

  const actions: DocumentAction[] = [
    { id: 'reindex', labelKey: 'knowledgeBase.actions.reindex', icon: 'refresh' },
    { id: 'download', labelKey: 'knowledgeBase.actions.download', icon: 'download' },
    { id: 'delete', labelKey: 'knowledgeBase.actions.delete', icon: 'trash', destructive: true },
  ];

  return (
    <div
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        isActive
          ? 'border-primary/50 bg-primary/5'
          : 'border-transparent hover:border-border hover:bg-accent/40',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <DocumentIcon kind={document.kind} className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{document.name}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(document.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {document.status === 'ready'
                ? t('knowledgeBase.list.chunksCount', { count: document.chunks })
                : t('knowledgeBase.list.pendingChunks')}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(document.uploadedAt)}</span>
          </div>
          <div className="mt-1.5">
            <DocumentStatusBadge status={document.status} />
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <details className="relative">
          <summary
            className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={t('knowledgeBase.actions.menu')}
          >
            <MoreHorizontal className="h-4 w-4" />
          </summary>
          <div className="absolute right-0 top-8 z-20 min-w-[10rem] rounded-md border border-border bg-popover p-1 text-sm shadow-lg">
            {actions.map((action) => {
              const Icon = ICON_BY_KEY[action.icon];
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onAction(action.id);
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent',
                    action.destructive && 'text-red-600 hover:bg-red-500/10 dark:text-red-400',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(action.labelKey)}
                </button>
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}
