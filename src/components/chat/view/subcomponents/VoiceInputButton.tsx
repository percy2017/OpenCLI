import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SpeechRecognitionState } from '../../hooks/useSpeechRecognition';

type Props = {
  state: SpeechRecognitionState;
  onToggle: () => void;
  errorMsg?: string | null;
};

// Push-to-talk mic button (presentational). The hook owns the recognition
// session; this button just toggles it and surfaces any error tooltip.
//
// The error tooltip is rendered into document.body via a portal so it can
// escape any `overflow: hidden` ancestor (the composer container clips
// `absolute` children). Position is recomputed on mount, scroll, and resize
// so it tracks the button.
export default function VoiceInputButton({ state, onToggle, errorMsg }: Props) {
  const { t } = useTranslation('chat');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!errorMsg) {
      setTooltipPos(null);
      return;
    }
    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setTooltipPos({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 6,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [errorMsg]);

  if (state === 'unsupported') return null;

  const label = state === 'listening' ? t('voice.stopRecording') : t('voice.input');

  const tooltip =
    errorMsg && tooltipPos
      ? createPortal(
          <span
            role="alert"
            style={{ left: tooltipPos.left, bottom: tooltipPos.bottom }}
            className="pointer-events-none fixed bottom-0 left-0 z-50 mx-auto max-w-[240px] -translate-x-1/2 whitespace-normal rounded bg-red-600 px-2 py-1 text-center text-xs text-white shadow-lg"
          >
            {errorMsg}
          </span>,
          document.body,
        )
      : null;

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        title={label}
        aria-label={label}
        aria-pressed={state === 'listening'}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          state === 'listening'
            ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        {state === 'listening' ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      {tooltip}
    </span>
  );
}