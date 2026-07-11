import { authenticatedFetch } from '../utils/api';
import { readVoiceConfig, voiceConfigHeaders } from '../hooks/useVoiceConfig';

export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  return authenticatedFetch('/api/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ text }),
    headers: voiceConfigHeaders(),
    signal,
  });
}
