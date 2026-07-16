/**
 * MessagePlayControl — single button next to MessageCopyControl on each
 * assistant message. Click toggles playback of the message's markdown
 * content (filtered server-side for prose only — see
 * /server/modules/tts/text-cleaner.ts).
 *
 * The button has four visual states gated by the player hook:
 *   - `idle`     → Play icon, click → start
 *   - `loading`  → spinner, click → cancel
 *   - `playing`  → Pause icon, click → stop
 *   - `error`    → muted icon with red accent, tooltip carries the message
 *
 * Mirrors the styling of MessageCopyControl (h-3.5 w-3.5, `text-gray-400
 * dark:text-gray-500` tone) so the two buttons feel like one toolbar.
 */

import { Loader2, Pause, Play, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTtsPlayer, type TtsError } from '../../../../hooks/useTtsPlayer';

const TONE = 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300';

type MessagePlayControlProps = {
  content: string;
  messageId?: string;
};

function errorTooltip(t: (k: string, opts?: Record<string, unknown>) => string, err: TtsError): string {
  switch (err.kind) {
    case 'unavailable':
      return t('playMessage.unavailable', { defaultValue: 'TTS is not available (mmx not installed)' });
    case 'disabled':
      return t('playMessage.disabled', { defaultValue: 'Read-aloud is disabled in server settings' });
    case 'empty':
      return err.message || t('playMessage.error', { defaultValue: 'Could not play message' });
    case 'http':
      return err.message || t('playMessage.error', { defaultValue: 'Could not play message' });
    case 'unsupported':
    default:
      return err.message || t('playMessage.error', { defaultValue: 'Could not play message' });
  }
}

export default function MessagePlayControl({ content, messageId }: MessagePlayControlProps) {
  const { t } = useTranslation('chat');
  const { config, isLoading, isPlaying, error, play, stop } = useTtsPlayer();

  // Disabled-by-config gate. Either feature disabled in .env, or mmx missing,
  // or there's no message body. Same gate MessageCopyControl uses
  // (`!trimmed`) so the two buttons appear/vanish together.
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;
  if (config && config.enabled === false) return null;

  const isError = error !== null;
  const errorTitle = isError ? errorTooltip(t, error) : null;

  const handleClick = () => {
    if (isLoading || isPlaying) {
      stop();
      return;
    }
    if (isError) {
      // Retry: clear error and try again on a fresh request.
      void play(trimmed);
      return;
    }
    void play(trimmed);
  };

  const baseTitle = isPlaying
    ? t('playMessage.stop', { defaultValue: 'Stop reading' })
    : t('playMessage.play', { defaultValue: 'Read aloud' });

  const ariaLabel = isError && errorTitle ? errorTitle : baseTitle;
  const title = errorTitle ?? baseTitle;

  const icon = isError ? (
    <VolumeX className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
  ) : isLoading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
  ) : isPlaying ? (
    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
  ) : (
    <Play className="h-3.5 w-3.5" aria-hidden="true" />
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={isPlaying}
      data-tts-message-id={messageId}
      data-tts-state={isError ? 'error' : isLoading ? 'loading' : isPlaying ? 'playing' : 'idle'}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${TONE} ${isError ? 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300' : ''}`}
    >
      {icon}
    </button>
  );
}
