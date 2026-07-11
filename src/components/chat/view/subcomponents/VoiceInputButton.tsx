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
export default function VoiceInputButton({ state, onToggle, errorMsg }: Props) {
  const { t } = useTranslation('chat');
  if (state === 'unsupported') return null;

  const label = state === 'listening' ? t('voice.stopRecording') : t('voice.input');

  return (
    <span className="relative inline-flex">
      {errorMsg && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 max-w-[240px] -translate-x-1/2 whitespace-normal rounded bg-red-600 px-2 py-1 text-center text-xs text-white shadow-lg">
          {errorMsg}
        </span>
      )}
      <button
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
    </span>
  );
}