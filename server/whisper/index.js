/**
 * Barrel for the whisper module. Mounted in server/index.js as
 *   app.use('/api/whisper', authenticateToken, whisperRoutes);
 */
export { default } from './whisper.routes.js';
export { default as whisperRoutes } from './whisper.routes.js';
export {
  isWhisperEnabled,
  getWhisperConfig,
  probeWhisperAvailable,
  resetWhisperCaches,
  transcribeBuffer,
  WhisperUnavailableError,
} from './whisper-runner.js';
