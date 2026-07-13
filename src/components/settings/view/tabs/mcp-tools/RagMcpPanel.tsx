import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

import McpToolsList from './McpToolsList';

type RagVectorState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

type RagMcpProviders = {
  codex: { configured: boolean };
  claude: { configured: boolean };
};

type RagMcpStatusResponse = {
  data: {
    state: RagVectorState;
    providers: RagMcpProviders;
  };
};

type RagMcpUpdateResponse = {
  data: {
    state: RagVectorState;
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

export default function RagMcpPanel() {
  const { t } = useTranslation('common');

  // Unified state — single switch governs both the RAG Vector UI tab and the
  // cloudli-rag MCP server registration. They share one boolean.
  const [mcpState, setMcpState] = useState<RagVectorState | null>(null);
  const [mcpProviders, setMcpProviders] = useState<RagMcpProviders | null>(null);
  const [isMcpLoading, setIsMcpLoading] = useState(true);
  const [isMcpSaving, setIsMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const loadMcpState = useCallback(async () => {
    const response = await authenticatedFetch('/api/rag-mcp/state');
    const data = await readJson<RagMcpStatusResponse>(response);
    setMcpState(data.data.state);
    setMcpProviders(data.data.providers);
  }, []);

  useEffect(() => {
    setMcpError(null);
    setIsMcpLoading(true);
    void loadMcpState()
      .catch((err) => setMcpError(err instanceof Error ? err.message : t('mmxCli.errors.loadState')))
      .finally(() => setIsMcpLoading(false));
  }, [loadMcpState, t]);

  const updateMcpState = async (enabled: boolean) => {
    setIsMcpSaving(true);
    setMcpError(null);
    try {
      // Update the MCP server registration first — it's the slower operation
      // (writes to provider configs). If it fails the feature-flag stays in
      // its current state and the user sees the error.
      const mcpResponse = await authenticatedFetch('/api/rag-mcp/state', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      const mcpData = await readJson<RagMcpUpdateResponse>(mcpResponse);
      setMcpState(mcpData.data.state);

      const failures = (mcpData.data.results || []).filter((result) => !result.ok);
      if (failures.length > 0) {
        setMcpError(t('mmxCli.errors.partialFailure', {
          providers: failures.map((failure) => failure.provider).join(', '),
        }));
      }

      // Mirror the same boolean into the RAG Vector feature flag so the header
      // tab gains/loses visibility in lockstep with the MCP toggle. Failures
      // here are non-fatal — the feature flag still updates and the event
      // fires on success.
      try {
        const flagResponse = await authenticatedFetch('/api/feature-flags/rag-vector', {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        });
        await readJson(flagResponse);
        window.dispatchEvent(new Event('ragVectorStateChanged'));
      } catch (flagErr) {
        console.error('[rag-mcp] failed to mirror RAG Vector flag:', flagErr);
      }

      await loadMcpState();
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : t('mmxCli.errors.saveState'));
    } finally {
      setIsMcpSaving(false);
    }
  };

  const mcpEnabled = mcpState?.enabled === true;

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('mmxCli.sectionTitle')}
        description={t('mmxCli.sectionDescription')}
      >
        <SettingsCard divided>
          <SettingsRow
            label={t('mmxCli.enableLabel')}
            description={t('mmxCli.enableDescription')}
          >
            {isMcpLoading && !mcpState ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={mcpEnabled}
                onChange={(value) => void updateMcpState(value)}
                ariaLabel={t('mmxCli.enableAria')}
                disabled={isMcpSaving}
              />
            )}
          </SettingsRow>

          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                {t('mmxCli.stateLabel', {
                  state: mcpEnabled
                    ? t('mmxCli.stateEnabled')
                    : t('mmxCli.stateDisabled'),
                })}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('mmxCli.codexStatus', {
                  state: mcpProviders?.codex.configured
                    ? t('mmxCli.providerConfigured')
                    : t('mmxCli.providerMissing'),
                })}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('mmxCli.claudeStatus', {
                  state: mcpProviders?.claude.configured
                    ? t('mmxCli.providerConfigured')
                    : t('mmxCli.providerMissing'),
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

        <McpToolsList serverId="rag" />
      </SettingsSection>
    </div>
  );
}
