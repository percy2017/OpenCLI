/**
 * useTtsPlayer — drives the chat "Read aloud" button.
 *
 * Responsibilities:
 *   - Fetch /api/tts/config once on mount (and again on `ttsConfigChanged`)
 *     so the UI knows whether mmx is available, which voice is the default,
 *     and whether auto-play is on.
 *   - Hold a single HTMLAudioElement per hook instance, reused across plays.
 *   - POST /api/tts/synthesize, get back audio/mpeg, wrap it in a Blob URL,
 *     play it, and revoke the URL when playback ends or the component
 *     unmounts (no leaks).
 *   - Surface errors as a discriminated union so the consumer can render
 *     the right tooltip text without parsing strings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api';

export type TtsConfig = {
  voice: string;
  speed: number;
  language: string;
  model: string;
  autoPlay: boolean;
  mmxAvailable: boolean;
  enabled: boolean;
};

export type TtsError =
  | { kind: 'unsupported'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'http'; status: number; message: string };

export type UseTtsPlayerResult = {
  config: TtsConfig | null;
  isLoading: boolean;
  isPlaying: boolean;
  error: TtsError | null;
  play: (text: string) => Promise<void>;
  stop: () => void;
  refreshConfig: () => Promise<void>;
};

const DEFAULT_CONFIG: TtsConfig = {
  voice: 'Spanish_Narrator',
  speed: 1.0,
  language: 'es',
  model: 'speech-2.8-hd',
  autoPlay: false,
  mmxAvailable: false,
  enabled: true,
};

export function useTtsPlayer(): UseTtsPlayerResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Tracks whether the in-flight playback was cancelled by stop()/unmount.
  const cancelledRef = useRef(false);

  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<TtsError | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/tts/config');
      const json = await response.json().catch(() => null);
      if (response.ok && json?.success && json.data) {
        setConfig({ ...DEFAULT_CONFIG, ...(json.data as Partial<TtsConfig>) });
        return;
      }
      // Non-OK is not fatal — the button just won't be functional. Use
      // defaults so the UI can still render without crashing.
      setConfig(DEFAULT_CONFIG);
    } catch {
      setConfig(DEFAULT_CONFIG);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    const handler = () => {
      void refreshConfig();
    };
    window.addEventListener('ttsConfigChanged', handler);
    return () => window.removeEventListener('ttsConfigChanged', handler);
  }, [refreshConfig]);

  const cleanupBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    cleanupBlob();
    setIsPlaying(false);
    setIsLoading(false);
  }, [cleanupBlob]);

  // Best-effort cleanup if the component unmounts mid-playback.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      cleanupBlob();
    };
  }, [cleanupBlob]);

  const play = useCallback(async (text: string) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      setError({ kind: 'empty', message: 'Nothing to read.' });
      return;
    }

    cancelledRef.current = false;
    setError(null);
    setIsLoading(true);

    try {
      const response = await authenticatedFetch('/api/tts/synthesize', {
        method: 'POST',
        body: JSON.stringify({ text: trimmed }),
      });

      if (cancelledRef.current) return;

      if (!response.ok) {
        const status = response.status;
        let payload: { error?: string; message?: string } | null = null;
        try {
          payload = await response.json();
        } catch {
          // ignore — fall through to the generic message below
        }
        const message = payload?.message || payload?.error || `TTS request failed (HTTP ${status}).`;

        if (status === 503) {
          setError({ kind: 'unavailable', message });
        } else if (status === 422) {
          setError({ kind: 'empty', message });
        } else {
          setError({ kind: 'http', status, message });
        }
        setIsLoading(false);
        return;
      }

      const blob = await response.blob();
      if (cancelledRef.current) return;

      cleanupBlob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      audio.src = url;
      audio.currentTime = 0;

      audio.onended = () => {
        cleanupBlob();
        setIsPlaying(false);
        setIsLoading(false);
      };
      audio.onerror = () => {
        cleanupBlob();
        setIsPlaying(false);
        setIsLoading(false);
        setError({ kind: 'unsupported', message: 'Browser could not play the audio.' });
      };

      setIsLoading(false);
      setIsPlaying(true);
      await audio.play();
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : 'Unknown TTS error.';
      setError({ kind: 'unsupported', message });
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [cleanupBlob]);

  return {
    config,
    isLoading,
    isPlaying,
    error,
    play,
    stop,
    refreshConfig,
  };
}