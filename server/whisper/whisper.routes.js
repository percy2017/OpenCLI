/**
 * Express routes for the chat "Voice → Whisper" button.
 *
 *   GET  /api/whisper/config
 *     Returns whether whisper.cpp is enabled and resolvable; the frontend
 *     hides the mic button when neither flag is set, instead of letting
 *     the user click into a guaranteed failure.
 *
 *   POST /api/whisper/transcribe   (multipart/form-data, field "audio")
 *     Returns { success: true, text: "..." }. Errors are mapped to
 *     503 (unavailable / disabled), 422 (empty / silence), 413 (too big),
 *     502 (whisper.cpp crashed). The frontend reads `error` to render
 *     the right localized tooltip.
 */
import express from 'express';
import multer from 'multer';

import { getWhisperInstallSummary } from '../modules/first-run/index.js';

import {
  WhisperUnavailableError,
  getWhisperConfig,
  isWhisperEnabled,
  probeWhisperAvailable,
  transcribeBuffer,
} from './whisper-runner.js';

const MAX_BYTES = Number.parseInt(process.env.WHISPER_MAX_FILE_SIZE_MB || '25', 10) * 1024 * 1024;
const MAX_MB = Math.round(MAX_BYTES / (1024 * 1024));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

function handleMulterError(err, _req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'audio-too-large',
      message: `Audio exceeds max size of ${MAX_MB}MB.`,
    });
  }
  return next(err);
}

const router = express.Router();

router.get('/config', async (_req, res) => {
  try {
    const available = await probeWhisperAvailable();
    const cfg = getWhisperConfig();
    const installer = getWhisperInstallSummary();
    // The chat composer polls this endpoint while `installer.state.inProgress`
    // is true so the Mic button can render an installation spinner instead
    // of the dimmed error tooltip. `available` flips to true once the
    // installer sentinel is written.
    const data = {
      ...cfg,
      available,
      installing: installer.state.inProgress,
      installStage: installer.state.stage,
      installProgress: installer.state.progress,
      installMessage: installer.state.message,
      installError: installer.state.error,
      installed: installer.installed,
    };
    console.log('[whisper-config] DEBUG:', JSON.stringify(data, null, 2));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[whisper-config] ERROR:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load whisper config.',
    });
  }
});

router.post('/transcribe', (req, res, next) => {
  upload.single('audio')(req, res, (err) => (err ? handleMulterError(err, req, res, next) : next()));
}, async (req, res) => {
  // The boot-time auto-install writes its sentinel before flipping
  // `installing: false`, but we keep this guard so a stale config can't
  // produce a confusing 502 in the few-millisecond window between binary
  // appearing and `/api/whisper/config` being observed as done.
  const installer = getWhisperInstallSummary();
  if (installer.state.inProgress) {
    return res.status(503).json({
      success: false,
      error: 'whisper-installing',
      message: installer.state.message || 'Voice transcription is installing…',
      stage: installer.state.stage,
      progress: installer.state.progress,
    });
  }

  if (!isWhisperEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'whisper-disabled',
      message: 'Whisper is disabled via WHISPER_ENABLED=false in the server .env.',
    });
  }

  const available = await probeWhisperAvailable();
  if (!available) {
    return res.status(503).json({
      success: false,
      error: 'whisper-unavailable',
      message: 'whisper.cpp binary not found on PATH. Install it or set WHISPER_BINARY.',
    });
  }

  const file = req.file;
  if (!file || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'audio-required',
      message: 'No audio file was uploaded (field "audio").',
    });
  }

  if (file.size > MAX_BYTES) {
    return res.status(413).json({
      success: false,
      error: 'audio-too-large',
      message: `Audio exceeds max size of ${MAX_MB}MB.`,
    });
  }

  try {
    const text = await transcribeBuffer(file.buffer, file.originalname || 'recording.webm', {
      language: typeof req.body?.language === 'string' ? req.body.language : undefined,
    });

    const trimmed = (text || '').trim();
    if (!trimmed) {
      return res.status(422).json({
        success: false,
        error: 'transcript-empty',
        message: 'No speech detected in the recording.',
      });
    }

    return res.json({ success: true, text: trimmed, language: text?.language || null });
  } catch (error) {
    if (error instanceof WhisperUnavailableError) {
      return res.status(503).json({
        success: false,
        error: 'whisper-unavailable',
        message: error.message,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[whisper] transcription failed:', message);
    return res.status(502).json({
      success: false,
      error: 'whisper-failed',
      message,
    });
  }
});

export default router;
