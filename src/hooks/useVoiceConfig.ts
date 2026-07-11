import { useState } from 'react';

export type VoiceConfig = {
  model: string;
  voice: string;
};

const STORAGE_KEY = 'voiceConfig';
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';

export const VOICE_DEFAULTS: VoiceConfig = {
  model: '',
  voice: '',
};

export function readVoiceConfig(): VoiceConfig {
  if (typeof window === 'undefined') return { ...VOICE_DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...VOICE_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...VOICE_DEFAULTS };
    return {
      model: typeof parsed.model === 'string' ? parsed.model : '',
      voice: typeof parsed.voice === 'string' ? parsed.voice : '',
    };
  } catch {
    return { ...VOICE_DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-request model/voice.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.model) h['x-voice-model'] = c.model;
  if (c.voice) h['x-voice-id'] = c.voice;
  return h;
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...VOICE_DEFAULTS } : readVoiceConfig()
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}
