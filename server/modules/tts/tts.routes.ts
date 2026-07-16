/**
 * Express router for the chat "Read aloud" (TTS) feature.
 *
 * Endpoints (all require an authenticated session):
 *   POST /api/tts/synthesize
 *     Body: { text: string; voice?: string; speed?: number; language?: string }
 *     Response: audio/mpeg binary blob.
 *
 *   GET  /api/tts/config
 *     Response: { voice, speed, language, model, autoPlay, mmxAvailable }
 *     Used by the frontend on mount to display "Default voice: …" in the
 *     Play button's tooltip without triggering a `mmx voices` call.
 *
 *   GET  /api/tts/voices?language=<lang>
 *     Response: mmx-shaped voice list. Cheap to include even before the
 *     Settings UI exists; the data flow is the same.
 */

import express from 'express';

import {
  TtsEmptyError,
  TtsUnavailableError,
  getTtsConfig,
  isTtsEnabled,
  listVoices,
  probeMmxAvailable,
  synthesizeToBuffer,
} from './tts.service.js';
import { cleanTextForSpeech } from './text-cleaner.js';

const router = express.Router();

router.post('/synthesize', async (req, res) => {
  const body = (req.body || {}) as {
    text?: unknown;
    voice?: unknown;
    speed?: unknown;
    language?: unknown;
    model?: unknown;
  };

  if (!isTtsEnabled()) {
    res.status(503).json({
      success: false,
      error: 'tts-disabled',
      message: 'TTS is disabled via TTS_ENABLED=false in the server .env.',
    });
    return;
  }

  const rawText = typeof body.text === 'string' ? body.text : '';
  if (!rawText.trim()) {
    res.status(400).json({ success: false, error: 'text-required' });
    return;
  }
  if (rawText.length > 50_000) {
    // Defensive: even after cleaning this is well above the 10k mmx cap,
    // so we'd just truncate anyway. Reject explicitly so the client can
    // surface a useful error.
    res.status(413).json({ success: false, error: 'text-too-large' });
    return;
  }

  const available = await probeMmxAvailable();
  if (!available) {
    res.status(503).json({
      success: false,
      error: 'tts-unavailable',
      message: 'mmx CLI not found on PATH. Install mmx to enable read-aloud.',
    });
    return;
  }

  const cleaned = cleanTextForSpeech(rawText);
  if (!cleaned) {
    res.status(422).json({
      success: false,
      error: 'text-empty-after-clean',
      message: 'Nothing readable to synthesize (response was all code/JSON).',
    });
    return;
  }

  const opts: {
    voice?: string;
    speed?: number;
    language?: string;
    model?: string;
  } = {};
  if (typeof body.voice === 'string' && body.voice.trim()) opts.voice = body.voice.trim();
  if (typeof body.language === 'string' && body.language.trim()) opts.language = body.language.trim();
  if (typeof body.model === 'string' && body.model.trim()) opts.model = body.model.trim();
  if (typeof body.speed === 'number' && Number.isFinite(body.speed)) opts.speed = body.speed;

  try {
    const buffer = await synthesizeToBuffer(cleaned, opts);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(buffer);
  } catch (error) {
    if (error instanceof TtsUnavailableError) {
      res.status(503).json({ success: false, error: 'tts-unavailable', message: error.message });
      return;
    }
    if (error instanceof TtsEmptyError) {
      res.status(422).json({ success: false, error: 'text-empty-after-clean', message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[tts] synthesis failed:', message);
    res.status(502).json({ success: false, error: 'synthesis-failed', message });
  }
});

router.get('/config', async (_req, res) => {
  try {
    const available = await probeMmxAvailable();
    const config = getTtsConfig();
    res.json({
      success: true,
      data: { ...config, mmxAvailable: available, enabled: isTtsEnabled() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load TTS config.',
    });
  }
});

router.get('/voices', async (req, res) => {
  try {
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const voices = await listVoices(language);
    res.json({ success: true, data: voices });
  } catch (error) {
    if (error instanceof TtsUnavailableError) {
      res.status(503).json({ success: false, error: 'tts-unavailable', message: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list voices.',
    });
  }
});

export default router;