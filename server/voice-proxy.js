import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

// Optional voice proxy — invokes the `mmx` MiniMax CLI for Text-to-Speech.
//
// MiniMax has TTS via `mmx speech synthesize` but exposes no STT/ASR command,
// so speech-to-text is intentionally not supported here. The mic UI is hidden
// when this module is mounted (see useVoiceAvailable/useVoiceInput).
//
// Config is resolved per-request from headers (set by the client's voice
// settings), falling back to server env defaults. Mounted at /api/voice behind
// authenticateToken.
const MMX_BIN = (process.env.MMX_BIN || 'mmx').trim() || 'mmx';

const ENV = {
  model: process.env.VOICE_DEFAULT_MODEL || 'speech-2.8-hd',
  voice: process.env.VOICE_DEFAULT_VOICE || 'English_expressive_narrator',
};

const DEFAULT_VOICE_TIMEOUT_MS = 300000;
const _parsedTimeout = Number(process.env.VOICE_TIMEOUT_MS);
const VOICE_TIMEOUT_MS = Number.isFinite(_parsedTimeout) && _parsedTimeout > 0
  ? _parsedTimeout
  : DEFAULT_VOICE_TIMEOUT_MS;

const DEFAULT_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
];

/**
 * Resolve the voice config for a request. Client headers (set from the user's
 * in-app voice settings) take precedence over the server env defaults.
 * @param {import('express').Request} req
 * @returns {{model: string, voice: string}}
 */
function resolveConfig(req) {
  const h = req.headers;
  return {
    model: String(h['x-voice-model'] || '').trim() || ENV.model,
    voice: String(h['x-voice-id'] || '').trim() || ENV.voice,
  };
}

const router = express.Router();

let _voicesCache = null;
let _voicesCacheAt = 0;
const VOICES_TTL_MS = 5 * 60 * 1000;

/**
 * Spawn `mmx` with the given args and resolve with { code, stdout, stderr }.
 * Aborts after VOICE_TIMEOUT_MS so a stalled CLI can't hold the request open.
 * @param {string[]} args
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runMmx(args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(MMX_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error(`Failed to spawn ${MMX_BIN}: ${e.message}`));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`${MMX_BIN} timed out after ${Math.round(VOICE_TIMEOUT_MS / 1000)}s`));
    }, VOICE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Translate a non-zero `mmx` exit into a useful client-facing error.
 * @param {string} stderr
 * @param {number} code
 * @returns {string}
 */
function mmxErrorMessage(stderr, code) {
  const tail = (stderr || '').trim().split('\n').slice(-3).join(' | ');
  if (!tail) return `${MMX_BIN} exited with code ${code}`;
  return tail;
}

/**
 * GET /api/voice/health -> { configured, models, voices, model, voice }.
 * `configured` is true when the `mmx` binary is reachable.
 */
router.get('/health', async (req, res) => {
  try {
    const { code } = await runMmx(['--version']);
    const configured = code === 0;
    if (!configured) {
      return res.json({
        configured: false,
        models: DEFAULT_MODELS,
        voices: [],
        model: resolveConfig(req).model,
        voice: resolveConfig(req).voice,
      });
    }
    const cfg = resolveConfig(req);
    let voices = _voicesCache;
    const now = Date.now();
    if (!voices || now - _voicesCacheAt > VOICES_TTL_MS) {
      try {
        const { code: vcode, stdout } = await runMmx(['speech', 'voices']);
        if (vcode === 0) {
          try {
            const parsed = JSON.parse(stdout);
            voices = Array.isArray(parsed?.voices) ? parsed.voices : [];
            if (!voices.length && Array.isArray(parsed)) voices = parsed;
          } catch {
            voices = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
          }
        } else {
          voices = [];
        }
        _voicesCache = voices;
        _voicesCacheAt = now;
      } catch {
        voices = _voicesCache || [];
      }
    }
    res.json({ configured: true, models: DEFAULT_MODELS, voices, model: cfg.model, voice: cfg.voice });
  } catch (e) {
    res.json({
      configured: false,
      models: DEFAULT_MODELS,
      voices: [],
      model: resolveConfig(req).model,
      voice: resolveConfig(req).voice,
      error: e.message,
    });
  }
});

/**
 * POST /api/voice/tts { text } -> audio bytes (mp3).
 * Spawns `mmx speech synthesize` with a temp output file, then streams the
 * resulting audio to the client. Cached by hash(text+model+voice) so replaying
 * the same message doesn't resynthesize.
 */
const audioCache = new Map();
const AUDIO_CACHE_MAX = 64;
const _ttsTmpDir = mkdtemp(join(tmpdir(), 'voice-mmx-')).catch(() => null);

router.post('/tts', async (req, res) => {
  const cfg = resolveConfig(req);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text required' });

  const cacheKey = `${cfg.model}|${cfg.voice}|${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(cached.buffer);
  }

  let tmpDir;
  try {
    tmpDir = await _ttsTmpDir;
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!tmpDir) return res.status(500).json({ error: 'voice tmp dir unavailable' });

  const outFile = join(tmpDir, `tts-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    const { code, stderr } = await runMmx([
      'speech', 'synthesize',
      '--text', text,
      '--model', cfg.model,
      '--voice', cfg.voice,
      '--format', 'mp3',
      '--out', outFile,
    ]);
    if (code !== 0) {
      return res.status(502).json({ error: `mmx speech synthesize failed: ${mmxErrorMessage(stderr, code)}` });
    }
    let buf;
    try {
      const s = await stat(outFile);
      if (!s.size) throw new Error('empty output file');
      buf = await readFile(outFile);
    } finally {
      unlink(outFile).catch(() => { /* ignore */ });
    }
    if (audioCache.size >= AUDIO_CACHE_MAX) {
      const firstKey = audioCache.keys().next().value;
      if (firstKey) audioCache.delete(firstKey);
    }
    audioCache.set(cacheKey, { contentType: 'audio/mpeg', buffer: buf });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    res.status(502).json({ error: `voice backend unreachable: ${e.message}` });
  }
});

export default router;
