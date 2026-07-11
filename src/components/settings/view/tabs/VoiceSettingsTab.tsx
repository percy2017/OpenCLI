import { useEffect, useMemo, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useVoiceConfig, readVoiceConfig } from '../../../../hooks/useVoiceConfig';
import { fetchVoiceCatalog } from '../../../chat/hooks/useVoiceAvailable';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { config, update } = useVoiceConfig();
  const voiceEnabled = preferences.voiceEnabled;
  const [catalog, setCatalog] = useState<{ models: string[]; voices: string[] }>({ models: [], voices: [] });
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    setCatalogError(null);
    try {
      const next = await fetchVoiceCatalog();
      setCatalog(next);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!voiceEnabled) return;
    void refresh();
  }, [voiceEnabled]);

  const defaults = useMemo(() => {
    const c = readVoiceConfig();
    return { model: c.model, voice: c.voice };
  }, []);

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
          </div>
          <SettingsToggle
            checked={voiceEnabled}
            onChange={(v) => setPreference('voiceEnabled', v)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </div>
      </SettingsSection>

      {voiceEnabled && (
        <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
          <div className="space-y-4">
            <Field
              label={t('voiceSettings.model')}
              placeholder={defaults.model || 'speech-2.8-hd'}
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              list="voice-models"
            />
            <datalist id="voice-models">
              {catalog.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <Field
              label={t('voiceSettings.voice')}
              placeholder={defaults.voice || 'English_expressive_narrator'}
              value={config.voice}
              onChange={(e) => update({ voice: e.target.value })}
              list="voice-voices"
            />
            <datalist id="voice-voices">
              {catalog.voices.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                {t('voiceSettings.refreshVoices')}
              </button>
              {catalogError && (
                <span className="text-xs text-red-500">{catalogError}</span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
