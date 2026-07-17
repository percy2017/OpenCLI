/**
 * useVoiceRecorder — drives the chat voice button.
 *
 * Captures microphone audio via MediaRecorder, posts the resulting Blob to
 * `/api/whisper/transcribe`, and exposes a typed transcript callback. We
 * pick the first supported MIME type (opus/webm preferred, mp4 fallback
 * for Safari) and revoke the stream tracks on stop to release the
 * microphone immediately — without this the browser keeps the "recording"
 * indicator on even after the UI stops.
 *
 * Status states:
 *   'idle'       — ready to record
 *   'recording'  — mic hot
 *   'processing' — uploading + transcribing
 *   'error'      — see `error` for the reason
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api';

export type VoiceRecorderStatus = 'idle' | 'recording' | 'processing' | 'error';

export type VoiceRecorderError =
  | { kind: 'unsupported'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'http'; status: number; message: string };

export type VoiceRecorderConfig = {
  enabled: boolean;
  available: boolean;
  language: string;
  model: string;
  timeoutMs: number;
};

export interface UseVoiceRecorderArgs {
  /** Called with the transcribed text after a successful round-trip. */
  onTranscript?: (text: string) => void;
  /** Optional language hint forwarded to the backend (default 'auto'). */
  language?: string;
}

export interface UseVoiceRecorderResult {
  status: VoiceRecorderStatus;
  error: VoiceRecorderError | null;
  config: VoiceRecorderConfig | null;
  /** True while MediaRecorder is open or the request is in flight. */
  busy: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  refreshConfig: () => Promise<void>;
}

const DEFAULT_CONFIG: VoiceRecorderConfig = {
  enabled: true,
  available: false,
  language: 'auto',
  model: 'ggml-base.bin',
  timeoutMs: 60_000,
};

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function useVoiceRecorder({
  onTranscript,
  language,
}: UseVoiceRecorderArgs = {}): UseVoiceRecorderResult {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Set when the user explicitly cancels — distinguishes from a normal stop.
  const cancelledRef = useRef(false);
  // Flipped to false on unmount so the async tail of `recorder.onstop` can't
  // fire state updates / onTranscript after the component is gone.
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  const [config, setConfig] = useState<VoiceRecorderConfig | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/whisper/config');
      const json = await response.json().catch(() => null);
      if (response.ok && json?.success && json.data) {
        setConfig({ ...DEFAULT_CONFIG, ...(json.data as Partial<VoiceRecorderConfig>) });
        return;
      }
      setConfig({ ...DEFAULT_CONFIG, available: false });
    } catch {
      setConfig({ ...DEFAULT_CONFIG, available: false });
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // Release mic + recorder on unmount.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch { /* ignore */ }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
  // React 18 dev runs an unmount/remount cycle once between mount and the
  // real remount (StrictMode), leaving mountedRef = false. Reset on every
  // start so a user-initiated recording still updates state afterwards.
  mountedRef.current = true;
  setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError({ kind: 'unsupported', message: 'Browser does not support microphone capture.' });
      setStatus('error');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError({ kind: 'unsupported', message: 'Browser does not support audio recording.' });
      setStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const wasCancelled = cancelledRef.current;
        if (wasCancelled) {
          cleanup();
          if (mountedRef.current) setStatus('idle');
          return;
        }
        try {
          if (mountedRef.current) setStatus('processing');
          const collected = chunksRef.current;
          cleanup();
          if (collected.length === 0) {
            if (mountedRef.current) {
              setError({ kind: 'empty', message: 'No audio captured.' });
              setStatus('error');
            }
            return;
          }
          const blob = new Blob(collected, { type: recorder.mimeType || 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, `recording.${extensionForMime(blob.type)}`);
          // Forward the requested language hint; whisper.cpp ignores it
          // when set to `auto` (the server default).
          if (language && language !== 'auto') {
            formData.append('language', language);
          }

          const response = await authenticatedFetch('/api/whisper/transcribe', {
            method: 'POST',
            body: formData,
          });
          const payload = await response.json().catch(() => null);

          if (!mountedRef.current) return;

          if (!response.ok || !payload?.success) {
            const status = response.status;
            const message =
              payload?.message ||
              payload?.error ||
              `Whisper request failed (HTTP ${status}).`;
            if (status === 503) {
              setError({ kind: 'unavailable', message });
            } else if (status === 422) {
              setError({ kind: 'empty', message });
            } else {
              setError({ kind: 'http', status, message });
            }
            setStatus('error');
            return;
          }

          const text = (payload.text || '').trim();
          if (!text) {
            setError({ kind: 'empty', message: 'No speech detected.' });
            setStatus('error');
            return;
          }

          setError(null);
          setStatus('idle');
          onTranscript?.(text);
        } catch (err) {
          if (!mountedRef.current) return;
          const message = err instanceof Error ? err.message : 'Unknown error.';
          setError({ kind: 'unsupported', message });
          setStatus('error');
        }
      };

      cancelledRef.current = false;
      recorder.start();
      setStatus('recording');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      const isDenied =
        (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'NotAllowedError') ||
        /denied|permission/i.test(message);
      setError({ kind: isDenied ? 'denied' : 'unsupported', message });
      setStatus('error');
      cleanup();
    }    }, [cleanup, onTranscript, language]);

  const stop = useCallback(() => {
    cancelledRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      cleanup();
      setStatus('idle');
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    cleanup();
    setStatus('idle');
  }, [cleanup]);

  return {
    status,
    error,
    config,
    busy: status === 'recording' || status === 'processing',
    start,
    stop,
    cancel,
    refreshConfig,
  };
}
