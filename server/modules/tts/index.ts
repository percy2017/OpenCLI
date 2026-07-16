/**
 * Barrel for the TTS module. Mounted in server/index.js as
 *   app.use('/api/tts', authenticateToken, ttsRoutes);
 */

export { default } from './tts.routes.js';
export { default as ttsRoutes } from './tts.routes.js';
export {
  TtsEmptyError,
  TtsUnavailableError,
  getTtsConfig,
  isTtsEnabled,
  listVoices,
  probeMmxAvailable,
  resetMmxProbeCache,
  synthesizeToBuffer,
} from './tts.service.js';
export { cleanTextForSpeech } from './text-cleaner.js';