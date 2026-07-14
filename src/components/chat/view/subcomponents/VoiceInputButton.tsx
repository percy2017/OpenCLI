import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type RecorderState = 'idle' | 'recording' | 'unsupported';

type Props = {
  /** Receives the recorded audio as a File (MIME chosen by MediaRecorder, e.g. audio/webm). */
  onAudioCaptured: (file: File) => void;
};

/**
 * Voice → audio-attach button (WhatsApp-style).
 *
 * Click to start recording from the user's microphone, click again to stop.
 * The captured audio is wrapped in a `File` and bubbled up via `onAudioCaptured`
 * so the composer can add it to `attachedImages` (which is reused as the
 * catch-all attachment slot in the chat pipeline).
 *
 * Why not Web Speech API?
 *  - Many Chromium environments (especially iframes) refuse to surface
 *    `onresult` reliably even when the constructor exists.
 *  - The user expects an audio file attached to the message, not auto-typed
 *    text — same as WhatsApp Web.
 *
 * Why MediaRecorder?
 *  - Same browser API that powers WhatsApp Web's voice notes on Chromium.
 *  - No server hop; raw bytes stay on-device until the user sends.
 *
 * Permission errors surface as a 4s red tooltip near the button (same UX as
 * before). Unsupported browsers (no `mediaDevices` + no `MediaRecorder`) hide
 * the button entirely.
 */
export default function VoiceInputButton({ onAudioCaptured }: Props) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<RecorderState>(() => resolveInitialState());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop any active tracks when the component unmounts so the OS mic indicator
  // goes away if the user navigates away mid-recording.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const flashError = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(null), 4000);
  }, []);

  const startRecording = useCallback(async () => {
    if (state === 'unsupported') {
      flashError(
        t('voice.errors.unsupported', {
          defaultValue: 'Audio recording is not supported in this browser.',
        }),
      );
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      flashError(
        t('voice.errors.unsupported', {
          defaultValue: 'Audio recording is not supported in this browser.',
        }),
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
        startedAtRef.current = null;
        // Always release the mic tracks, regardless of how stop() was reached.
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });
        chunksRef.current = [];

        // 250ms minimum so we don't attach an empty/click artifact when the
        // user accidentally taps the button.
        if (blob.size === 0 || durationMs < 250) {
          setState('idle');
          flashError(
            t('voice.errors.tooShort', {
              defaultValue: 'Recording is too short — hold the mic longer.',
            }),
          );
          return;
        }

        const extension = extensionForMime(blob.type);
        const fileName = `voice-${Date.now()}.${extension}`;
        const file = new File([blob], fileName, { type: blob.type, lastModified: Date.now() });
        onAudioCaptured(file);
        setState('idle');
      };

      recorder.onerror = (event) => {
        const err = (event as unknown as { error?: DOMException }).error;
        const code = err?.name ?? 'unknown';
        flashError(t(`voice.errors.${normalizeErrorKey(code)}`, { defaultValue: code }));
        try {
          streamRef.current?.getTracks().forEach((track) => track.stop());
        } catch {
          /* noop */
        }
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setState('idle');
      };

      startedAtRef.current = Date.now();
      recorder.start();
      setState('recording');
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      flashError(
        t(`voice.errors.${normalizeErrorKey(name)}`, {
          defaultValue:
            name === 'NotAllowedError'
              ? 'Microphone permission denied.'
              : 'Could not start recording.',
        }),
      );
      setState('idle');
    }
  }, [state, flashError, onAudioCaptured, t]);

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      void startRecording();
    }
  }, [state, startRecording, stopRecording]);

  if (state === 'unsupported') return null;

  const label = state === 'recording' ? t('voice.stopRecording', { defaultValue: 'Stop recording' }) : t('voice.input', { defaultValue: 'Voice input' });
  const buttonClass =
    state === 'recording'
      ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleToggle}
        title={label}
        aria-label={label}
        aria-pressed={state === 'recording'}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${buttonClass}`}
      >
        {state === 'recording' ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      {errorMsg && createPortal(<ErrorTooltip message={errorMsg} />, document.body)}
    </span>
  );
}

function ErrorTooltip({ message }: { message: string }) {
  // The tooltip uses an inline position computed from the button rect in a
  // portal so it escapes any `overflow: hidden` ancestor. We position via a
  // CSS variable the parent sets through a data attribute on <body>.
  // Simpler: render it centered at the bottom of the viewport via fixed.
  return (
    <span
      role="alert"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 mx-auto max-w-[280px] -translate-x-1/2 whitespace-normal rounded bg-red-600 px-3 py-1.5 text-center text-xs text-white shadow-lg"
    >
      {message}
    </span>
  );
}

function resolveInitialState(): RecorderState {
  if (typeof navigator === 'undefined') return 'unsupported';
  if (typeof window === 'undefined') return 'unsupported';
  if (typeof MediaRecorder === 'undefined') return 'unsupported';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return 'idle';
}

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function extensionForMime(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

function normalizeErrorKey(name: string): string {
  // Map DOMException names to camelCase i18n keys under voice.errors.*
  if (!name) return 'unknown';
  return name.replace(/^[A-Z]/, (ch) => ch.toLowerCase());
}
