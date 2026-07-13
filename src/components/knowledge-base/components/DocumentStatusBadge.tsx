import { AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';
import type { DocumentStatus } from '../types';

type DocumentStatusBadgeProps = {
  status: DocumentStatus;
  className?: string;
};

const VARIANT_MAP: Record<DocumentStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  indexing: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export default function DocumentStatusBadge({ status, className }: DocumentStatusBadgeProps) {
  const { t } = useTranslation();
  const Icon =
    status === 'indexing'
      ? Loader2
      : status === 'ready'
        ? CheckCircle2
        : status === 'error'
          ? AlertCircle
          : Upload;

  return (
    <Badge variant="outline" className={cn('gap-1 border-transparent font-medium', VARIANT_MAP[status], className)}>
      <Icon className={cn('h-3 w-3', status === 'indexing' && 'animate-spin', status === 'pending' && 'animate-pulse')} />
      <span>{t(`knowledgeBase.status.${status}`)}</span>
    </Badge>
  );
}
