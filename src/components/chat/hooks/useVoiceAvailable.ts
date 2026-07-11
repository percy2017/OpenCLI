import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { VOICE_CONFIG_SYNC_EVENT } from '../../../hooks/useVoiceConfig';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.
const STORAGE_KEY = 'uiPreferences';
const SYNC_EVENT = 'ui-preferences:sync';
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = authenticatedFetch('/api/voice/health')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return data?.configured === true;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

function readVoiceEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.voiceEnabled === true || parsed?.voiceEnabled === 'true';
  } catch {
    return false;
  }
}

export type VoiceCatalog = {
  models: string[];
  voices: string[];
};

let catalogCache: { value: VoiceCatalog; at: number } | null = null;
const CATALOG_TTL_MS = 60 * 1000;

export async function fetchVoiceCatalog(): Promise<VoiceCatalog> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const res = await authenticatedFetch('/api/voice/health');
  if (!res.ok) throw new Error(`Voice health failed (${res.status})`);
  const data = await res.json();
  const catalog: VoiceCatalog = {
    models: Array.isArray(data?.models) ? data.models : [],
    voices: Array.isArray(data?.voices) ? data.voices : [],
  };
  catalogCache = { value: catalog, at: now };
  return catalog;
}

export function useVoiceAvailable(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readVoiceEnabled()
  );
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const update = () => setEnabled(readVoiceEnabled());
    window.addEventListener('storage', update);
    window.addEventListener(SYNC_EVENT, update as EventListener);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(SYNC_EVENT, update as EventListener);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!enabled) {
        setAvailable(false);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        if (active && id === requestId) setAvailable(result);
      } catch {
        if (active && id === requestId) setAvailable(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled]);

  return enabled && available;
}
