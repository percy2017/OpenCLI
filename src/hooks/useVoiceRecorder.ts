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

export type VoiceRecorderInstallError = {
  code: string;
  message: string;
};

export type VoiceRecorderConfig = {
  enabled: boolean;
  available: boolean;
  language: string;
  model: string;
  timeoutMs: number;
  installing: boolean;
  installed: boolean;
  installStage:
    | 'idle'
    | 'detecting-binary'
    | 'cloning'
    | 'building'
    | 'downloading-model'
    | 'verifying-model'
    | 'done'
    | 'failed'
    | 'skipped-platform'
    | 'skipped-disabled';
  installProgress: number;
  installMessage: string;
  installError: VoiceRecorderInstallError | null;
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
  installing: boolean;
  installError: VoiceRecorderInstallError | null;
  installStage: VoiceRecorderConfig['installStage'];
  installMessage: string;
  /** Wall-clock ms when recording started, or null while idle. */
  recordingStartedAt: number | null;
  /** Elapsed time since `recordingStartedAt`, updated every 250 ms while recording. */
  elapsedMs: number;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  refreshConfig: () => Promise<void>;
  retryInstall: () => Promise<void>;
}

const DEFAULT_CONFIG: VoiceRecorderConfig = {
  enabled: true,
  available: false,
  language: 'auto',
  model: 'ggml-base.bin',
  timeoutMs: 60_000,
  installing: false,
  installed: false,
  installStage: 'idle',
  installProgress: 0,
  installMessage: '',
  installError: null,
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
  // Wall-clock ms at the moment `recorder.start()` resolved, or null when idle.
  // Drove from a `setInterval` so the UI can render an mm:ss timer while
  // recording without polling Date.now() in render.
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopElapsedClock = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setRecordingStartedAt(null);
    setElapsedMs(0);
  }, []);

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

  /**
   * Trigger the install retry endpoint. Used by the chat composer's tooltip
   * on `installError`. The first response will set `installing: true` and
   * the existing poll-loop will track progress to completion.
   */
  const retryInstall = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/first-run/whisper-status/retry', {
        method: 'POST',
      });
      if (!response.ok) {
        // Even if the POST fails we still kick a refresh so the UI sees
        // whatever state the backend landed on.
        await refreshConfig();
      }
    } catch {
      await refreshConfig();
    }
  }, [refreshConfig]);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // Poll /api/whisper/config every 2 s while the installer is running. Stops
  // automatically as soon as the terminal stage is reached (`installing`
  // flips to false) or the hook unmounts.
  useEffect(() => {
    if (!config?.installing) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) void refreshConfig();
    }, 2000);
    return () => clearTimeout(timer);
  }, [config?.installing, config?.installProgress, config?.installMessage, refreshConfig]);

  // Release mic + recorder on unmount.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      if (elapsedTimerRef.current !== null) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
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
        stopElapsedClock();
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
      const startedAt = Date.now();
      setRecordingStartedAt(startedAt);
      setElapsedMs(0);
      if (elapsedTimerRef.current !== null) {
        clearInterval(elapsedTimerRef.current);
      }
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 250);
      setStatus('recording');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      const isDenied =
        (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'NotAllowedError') ||
        /denied|permission/i.test(message);
      setError({ kind: isDenied ? 'denied' : 'unsupported', message });
      setStatus('error');
      cleanup();
    }    }, [cleanup, onTranscript, language, stopElapsedClock]);

  const stop = useCallback(() => {
    cancelledRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopElapsedClock();
      cleanup();
      setStatus('idle');
    }
  }, [cleanup, stopElapsedClock]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    stopElapsedClock();
    cleanup();
    setStatus('idle');
  }, [cleanup, stopElapsedClock]);

  return {
    status,
    error,
    config,
    busy: status === 'recording' || status === 'processing',
    installing: config?.installing ?? false,
    installError: config?.installError ?? null,
    installStage: config?.installStage ?? 'idle',
    installMessage: config?.installMessage ?? '',
    recordingStartedAt,
    elapsedMs,
    start,
    stop,
    cancel,
    refreshConfig,
    retryInstall,
  };
}
