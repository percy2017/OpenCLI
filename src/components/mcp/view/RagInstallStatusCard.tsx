// RAG MCP install status card.
//
// Renders the current install state from `useRagMcpInstall` as a colored
// banner with an optional Retry button. Sits above the per-server list on
// Settings → Agents → Claude → MCP (mounted by McpServers.tsx).
//
// Visual chassis mirrors `BrowserUsePanel.tsx:278-297`
// (`rounded-md border border-border bg-muted/30 p-3`), with the same
// `<Loader2 className="h-4 w-4 animate-spin" />` icon-swap on the action
// button while a retry is in flight.

import { useTranslation } from 'react-i18next';
import { Loader2, RotateCw } from 'lucide-react';

import { Button } from '../../../shared/view/ui';

import type { UseRagMcpInstallResult } from '../hooks/useRagMcpInstall';

type Props = Pick<UseRagMcpInstallResult, 'state' | 'isRetrying' | 'retryInstall'>;

const TONE_CLASSES = {
  installed: 'border-green-300 bg-green-50 text-green-900 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-100',
  pending: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100',
  failed: 'border-red-300 bg-red-50 text-red-900 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-100',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function RagInstallStatusCard({ state, isRetrying, retryInstall }: Props) {
  const { t } = useTranslation('settings');

  // While the initial GET is in flight, show a neutral placeholder rather
  // than nothing — keeps the layout stable and avoids a flash of empty space.
  if (!state) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('mcpServers.ragInstallStatus.cardTitle', { defaultValue: 'RAG MCP install' })}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('mcpServers.ragInstallStatus.loading', { defaultValue: 'Checking…' })}
            </div>
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const tone = TONE_CLASSES[state.status];
  const reasonKey = state.status === 'pending' || state.status === 'failed' ? state.reason : null;

  let title: string;
  if (state.status === 'installed') {
    title = t('mcpServers.ragInstallStatus.installed', { defaultValue: 'Installed' });
  } else if (state.status === 'pending') {
    title = t('mcpServers.ragInstallStatus.pending', { defaultValue: 'Not installed yet' });
  } else {
    title = t('mcpServers.ragInstallStatus.failed', { defaultValue: 'Install failed' });
  }

  let detail: string | null = null;
  if (state.status === 'installed') {
    detail = t('mcpServers.ragInstallStatus.installedDetail', {
      manager: state.manager,
      date: formatDate(state.lastUpdated),
      defaultValue: `Installed via ${state.manager} on ${formatDate(state.lastUpdated)}`,
    });
  } else if (reasonKey) {
    detail = t(`mcpServers.ragInstallStatus.reasons.${reasonKey}`, {
      defaultValue: reasonKey,
    });
  }

  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          {detail && <div className="mt-1 text-sm opacity-90">{detail}</div>}
          {state.status === 'failed' && state.message && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/10 p-2 text-xs whitespace-pre-wrap break-words">
              {state.message}
            </pre>
          )}
        </div>

        {state.status !== 'installed' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRetrying}
            onClick={() => {
              void retryInstall();
            }}
            className="flex-shrink-0"
          >
            {isRetrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            {isRetrying
              ? t('mcpServers.ragInstallStatus.action.retrying', { defaultValue: 'Installing…' })
              : t('mcpServers.ragInstallStatus.action.retry', { defaultValue: 'Retry install' })}
          </Button>
        )}
      </div>
    </div>
  );
}
