import { AlertCircle, CheckCircle2, FileText, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { formatBytes } from '../constants';
import type { UploadItem } from '../types';

type UploadQueueItemProps = {
  item: UploadItem;
};

export default function UploadQueueItem({ item }: UploadQueueItemProps) {
  const { t } = useTranslation();
  const Icon =
    item.status === 'done'
      ? CheckCircle2
      : item.status === 'error'
        ? AlertCircle
        : Upload;
  const colorClass =
    item.status === 'error'
      ? 'text-red-500'
      : item.status === 'done'
        ? 'text-emerald-500'
        : 'text-primary';

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm transition-colors',
        item.status === 'error'
          ? 'border-red-500/30 bg-red-500/5'
          : item.status === 'done'
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-border bg-muted/30',
      )}
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{item.file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.file.size)}</span>
          </div>
          {item.status === 'error' && item.errorMessage && (
            <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">{item.errorMessage}</p>
          )}
        </div>
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            colorClass,
            item.status === 'uploading' && 'animate-pulse',
          )}
        />
      </div>
      {item.status === 'uploading' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-background/80">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}
      {item.status === 'pending' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('knowledgeBase.upload.queued')}</p>
      )}
    </div>
  );
}
