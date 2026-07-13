import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';
import SettingsSection from '../../SettingsSection';
import SettingsToggle from '../../SettingsToggle';

type TerminalState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

type TerminalStateResponse = {
  data: TerminalState;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function TerminalSettingsTab() {
  const { t } = useTranslation('common');

  const [state, setState] = useState<TerminalState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    const response = await authenticatedFetch('/api/terminal/state');
    const data = await readJson<TerminalStateResponse>(response);
    setState(data.data);
  }, []);

  useEffect(() => {
    setError(null);
    setIsLoading(true);
    void loadState()
      .catch((err) => setError(err instanceof Error ? err.message : t('terminal.errors.loadState')))
      .finally(() => setIsLoading(false));
  }, [loadState, t]);

  const updateState = async (enabled: boolean) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/terminal/state', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      const data = await readJson<TerminalStateResponse>(response);
      setState(data.data);
      window.dispatchEvent(new Event('terminalStateChanged'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('terminal.errors.saveState'));
    } finally {
      setIsSaving(false);
    }
  };

  const enabled = state?.enabled === true;

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('terminal.sectionTitle')}
        description={t('terminal.sectionDescription')}
      >
        <SettingsCard divided>
          <SettingsRow
            label={t('terminal.enableLabel')}
            description={t('terminal.enableDescription')}
          >
            {isLoading && !state ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <SettingsToggle
                checked={enabled}
                onChange={(value) => void updateState(value)}
                ariaLabel={t('terminal.enableAria')}
                disabled={isSaving}
              />
            )}
          </SettingsRow>

          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                {t('terminal.stateLabel', {
                  state: enabled
                    ? t('terminal.stateEnabled')
                    : t('terminal.stateDisabled'),
                })}
              </span>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}