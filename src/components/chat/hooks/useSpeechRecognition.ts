import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Web Speech API typings (Chromium / Edge / Safari). The W3C draft exposes the
// constructor on window.SpeechRecognition; older WebKit prefixes it as
// webkitSpeechRecognition. Firefox does not implement this API at all.
type SRConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((e: Event) => void) | null;
}

function resolveSpeechRecognition(): SRConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type SpeechRecognitionState = 'idle' | 'listening' | 'unsupported';

export type UseSpeechRecognitionOptions = {
  lang?: string;
  continuous?: boolean;
};

/**
 * Push-to-talk dictation backed by the browser's Web Speech API.
 *
 * Captured audio never leaves the device except for the upstream recognition
 * service used by the browser engine (Google for Chromium-based browsers).
 * Returns text as it's recognized; `finalText` accumulates committed words and
 * `interimText` holds the in-progress hypothesis that gets replaced as the
 * user speaks.
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { t } = useTranslation('chat');
  const SR = resolveSpeechRecognition();
  const supported = SR !== null;

  const [state, setState] = useState<SpeechRecognitionState>(supported ? 'idle' : 'unsupported');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const lang = options.lang;
  const continuous = options.continuous ?? true;

  // Translate Web Speech API error codes (e.g. "no-speech", "audio-capture") into
  // human-readable, localized messages. Unknown codes fall back to a generic error.
  const translateError = useCallback((code: string | null | undefined): string => {
    if (!code) return t('voice.errors.unknown');
    // Map kebab-case API codes to camelCase i18n keys.
    const key = code
      .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
      .replace(/^[a-z]/, (ch) => ch.toLowerCase());
    const translated = t(`voice.errors.${key}`, { defaultValue: '' });
    return translated || t('voice.errors.unknown');
  }, [t]);

  // Stop recognition if the component unmounts mid-listen.
  useEffect(() => {
    return () => {
      try { recRef.current?.abort(); } catch { /* ignore */ }
    };
  }, []);

  const start = useCallback(() => {
    if (!SR || state === 'listening') return;
    setError(null);
    setFinalText('');
    setInterimText('');

    const rec = new SR();
    rec.lang = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.continuous = continuous;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interimChunk += result[0].transcript;
      }
      if (finalChunk) setFinalText((prev) => prev + finalChunk);
      setInterimText(interimChunk);
    };

    rec.onerror = (e) => {
      setError(translateError(e.error));
    };

    rec.onend = () => {
      setState('idle');
      setInterimText('');
    };

    recRef.current = rec;
    setState('listening');
    try {
      rec.start();
    } catch {
      setError(t('voice.errors.unknown'));
      setState('idle');
    }
  }, [SR, state, lang, continuous, translateError, t]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const toggle = useCallback(() => {
    if (state === 'listening') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  const reset = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setError(null);
  }, []);

  // Combined view: finals + (space + interim) so the consumer can render a
  // single string while the user is still speaking.
  const needsSpace = finalText.length > 0 && !finalText.endsWith(' ') && interimText.length > 0;
  const text = (finalText + (needsSpace ? ' ' : '') + interimText).trim();

  return {
    state,
    finalText,
    interimText,
    text,
    error,
    supported,
    start,
    stop,
    toggle,
    reset,
  };
}