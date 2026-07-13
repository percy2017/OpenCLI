import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

import McpToolsList from './McpToolsList';

type McpMinimaxState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

type McpMinimaxProviders = {
  codex: { configured: boolean };
  claude: { configured: boolean };
};

type McpMinimaxStatusResponse = {
  data: {
    state: McpMinimaxState;
    providers: McpMinimaxProviders;
  };
};

type McpMinimaxUpdateResponse = {
  data: {
    state: McpMinimaxState;
    results: Array<{ provider: string; ok: boolean; error?: string }>;
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.details || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function MinimaxMcpPanel() {
  const { t } = useTranslation('common');
  const [mcpState, setMcpState] = useState<McpMinimaxState | null>(null);
  const [mcpProviders, setMcpProviders] = useState<McpMinimaxProviders | null>(null);
  const [isMcpLoading, setIsMcpLoading] = useState(true);
  const [isMcpSaving, setIsMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const loadMcpState = useCallback(async () => {
    const response = await authenticatedFetch('/api/mcp-minimax/state');
    const data = await readJson<McpMinimaxStatusResponse>(response);
    setMcpState(data.data.state);
    setMcpProviders(data.data.providers);
  }, []);

  useEffect(() => {
    setMcpError(null);
    setIsMcpLoading(true);
    void loadMcpState()
      .catch((err) => setMcpError(err instanceof Error ? err.message : t('browserUse.minimax.errors.loadState')))
      .finally(() => setIsMcpLoading(false));
  }, [loadMcpState, t]);

  const updateMcpState = async (enabled: boolean) => {
    setIsMcpSaving(true);
    setMcpError(null);
    try {
      const response = await authenticatedFetch('/api/mcp-minimax/state', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      const data = await readJson<McpMinimaxUpdateResponse>(response);
      setMcpState(data.data.state);
      const failures = (data.data.results || []).filter((result) => !result.ok);
      if (failures.length > 0) {
        setMcpError(t('browserUse.minimax.errors.partialFailure', {
          providers: failures.map((failure) => failure.provider).join(', '),
        }));
      }
      window.dispatchEvent(new Event('mcpMinimaxStateChanged'));
      await loadMcpState();
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : t('browserUse.minimax.errors.saveState'));
    } finally {
      setIsMcpSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('browserUse.minimax.sectionTitle')}
        description={t('browserUse.minimax.sectionDescription')}
      >
        <SettingsCard divided>
          <SettingsRow
            label={t('browserUse.minimax.enableLabel')}
            description={t('browserUse.minimax.enableDescription')}
          >
            {isMcpLoading && !mcpState ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={mcpState?.enabled === true}
                onChange={(value) => void updateMcpState(value)}
                ariaLabel={t('browserUse.minimax.enableAria')}
                disabled={isMcpSaving}
              />
            )}
          </SettingsRow>

          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUse.minimax.stateLabel', {
                  state: mcpState?.enabled
                    ? t('browserUse.minimax.stateEnabled')
                    : t('browserUse.minimax.stateDisabled'),
                })}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUse.minimax.codexStatus', {
                  state: mcpProviders?.codex.configured
                    ? t('browserUse.minimax.providerConfigured')
                    : t('browserUse.minimax.providerMissing'),
                })}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('browserUse.minimax.claudeStatus', {
                  state: mcpProviders?.claude.configured
                    ? t('browserUse.minimax.providerConfigured')
                    : t('browserUse.minimax.providerMissing'),
                })}
              </span>
            </div>

            {mcpError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {mcpError}
              </div>
            )}
          </div>
        </SettingsCard>

        <McpToolsList serverId="minimax" />
      </SettingsSection>
    </div>
  );
}
