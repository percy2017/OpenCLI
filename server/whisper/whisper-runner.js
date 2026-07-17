/**
 * Whisper.cpp transcription runner.
 *
 * Pipeline (per request):
 *   1. Save the uploaded audio buffer to a temp file (preserve extension so
 *      ffmpeg can autodetect the codec — webm/opus from Chrome/Firefox,
 *      mp4/aac from Safari).
 *   2. ffmpeg → 16 kHz mono PCM s16le WAV. whisper.cpp is happiest with this.
 *   3. whisper-cli (preferred) or `main` (legacy) with --output-file so it
 *      writes a .txt alongside the wav, then read that text file.
 *
 * Binary probing is memoized per process (`probeWhisperAvailable`) so the
 * startup cost is paid once, matching the pattern used by the TTS module.
 *
 * Why shell out to whisper.cpp instead of calling a hosted STT API: the user
 * asked for whisper.cpp specifically, and OpenCLI's self-hosted story makes
 * leaks of microphone audio to third parties a non-starter.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

const DEFAULT_WHISPER_BINARY_CANDIDATES = ['whisper-cli', 'whisper', 'main'];
const DEFAULT_LANGUAGE = 'auto';
const DEFAULT_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_WHISPER_MODEL = '';

function readEnvString(key, fallback) {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

function readEnvBool(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return String(raw).toLowerCase() === 'true';
}

function readEnvInt(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let binaryCache = null; // { resolved: string | null }
let probeProbe = null;

export function isWhisperEnabled() {
  return readEnvBool('WHISPER_ENABLED', true);
}

export function getWhisperConfig() {
  return {
    enabled: isWhisperEnabled(),
    language: readEnvString('WHISPER_LANGUAGE', DEFAULT_LANGUAGE),
    model: readEnvString('WHISPER_MODEL', DEFAULT_WHISPER_MODEL),
    binary: readEnvString('WHISPER_BINARY', ''),
    timeoutMs: readEnvInt('WHISPER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    available: false, // overwritten by callers that already probed
  };
}

/**
 * Resolve which whisper.cpp binary to use. If WHISPER_BINARY is set we use
 * it verbatim; otherwise we try each candidate in order. Result is cached
 * for the lifetime of the process.
 */
async function resolveWhisperBinary() {
  if (binaryCache !== null) return binaryCache.resolved;

  const explicit = readEnvString('WHISPER_BINARY', '');
  const candidates = explicit ? [explicit] : DEFAULT_WHISPER_BINARY_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const child = spawn(candidate, ['--help'], { stdio: ['ignore', 'ignore', 'ignore'] });
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(false);
        }, PROBE_TIMEOUT_MS);
        timer.unref?.();
        child.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code === 0 || code === null);
        });
      });
      if (ok) {
        binaryCache = { resolved: candidate };
        return candidate;
      }
    } catch {
      // binary not on PATH or not executable; try next
    }
  }
  binaryCache = { resolved: null };
  return null;
}

/**
 * Probe whisper.cpp availability. Unlike mmx the binary does not always
 * exit 0 on `--help` (older `main` returns 1), so we accept either exit
 * code 0 or absence of error.
 */
export function probeWhisperAvailable() {
  if (!probeProbe) {
    probeProbe = (async () => {
      if (!isWhisperEnabled()) return false;
      const binary = await resolveWhisperBinary();
      return binary !== null;
    })();
  }
  return probeProbe;
}

/** Reset caches (useful for tests). */
export function resetWhisperCaches() {
  binaryCache = null;
  probeProbe = null;
}

/** Resolve the model path: explicit WHISPER_MODEL or default in the whisper folder.
 *  WHISPER_MODEL may be an absolute path or a plain filename relative to the
 *  bundled `models/` directory. Anything with `..`, an absolute path that
 *  escapes `models/`, or a name that doesn't match the `ggml-*.bin` pattern
 *  is rejected to keep arbitrary file reads off-limits.
 */
function resolveModelPath() {
  const explicit = readEnvString('WHISPER_MODEL', DEFAULT_WHISPER_MODEL);
  const here = path.dirname(new URL(import.meta.url).pathname);
  const modelsDir = path.join(here, 'models');

  if (explicit) {
    if (path.isAbsolute(explicit)) return explicit;
    if (!/^ggml-[\w.-]+\.bin$/.test(explicit) || explicit.includes('..')) {
      throw new Error(`Invalid WHISPER_MODEL filename: ${explicit}`);
    }
    return path.join(modelsDir, explicit);
  }
  return path.join(modelsDir, 'ggml-base.bin');
}

/**
 * Convert any audio container to 16 kHz mono PCM s16le WAV using ffmpeg.
 * Throws if ffmpeg is missing or conversion fails. Best-effort cleanup.
 */
async function convertToWav(inputPath, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out while converting audio'));
    }, 30_000);
    timer.unref?.();

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg not available: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.trim() || 'unknown error'}`));
      }
    });
  });
}

/**
 * Transcribe a WAV file with whisper.cpp.
 *
 * @param {string} wavPath absolute path to 16 kHz mono PCM WAV
 * @param {{ language?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<string>} joined transcription text
 */
async function runWhisper(wavPath, opts = {}) {
  const binary = await resolveWhisperBinary();
  if (!binary) {
    throw new WhisperUnavailableError();
  }

  const modelPath = resolveModelPath();
  // whisper.cpp's `-l` flag expects ISO-639-1 (e.g. "en", "es") — nothing
  // longer. Browsers hand us full locales like "en-US" via navigator.language,
  // which whisper would reject with "unknown language". Strip the variant.
  const requested = opts.language || readEnvString('WHISPER_LANGUAGE', DEFAULT_LANGUAGE);
  const language = requested && requested.includes('-')
    ? requested.split('-')[0].toLowerCase()
    : requested;
  const timeoutMs = opts.timeoutMs || readEnvInt('WHISPER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);

  // `-of prefix` makes whisper.cpp write <prefix>.txt alongside the input.
  const outPrefix = wavPath.replace(/\.[^.]+$/, '');

  // whisper-cli boolean flags take no value. Earlier versions of this
  // runner emitted `--print-progress false` / `--print-realtime false` /
  // `--print-colors false`, but those flags don't accept a value on the
  // v1.9.x builds we ship; the binary interprets them as unknown options
  // and dumps --help instead of transcribing, producing a 502 on the
  // route. `-np` (no prints) already silences progress + realtime in one
  // shot.
  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '-l', language,
    '-of', outPrefix,
    '-otxt',
    '-nt',  // no timestamps
    '-np',  // no prints (silences progress / realtime / decoration)
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stderr = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`whisper.cpp timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    timer.unref?.();

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      finish(() => reject(new WhisperUnavailableError(`Failed to spawn whisper: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(async () => {
        if (code === 0) {
          try {
            const txt = await readFile(`${outPrefix}.txt`, 'utf8');
            resolve(txt.trim());
          } catch (err) {
            reject(new Error(`whisper.cpp completed but no output file found: ${err.message}`));
          }
        } else {
          reject(new Error(parseWhisperError(stderr) || `whisper.cpp exited with code ${code}`));
        }
      });
    });
  });
}

function parseWhisperError(stderr) {
  if (!stderr) return null;
  // whisper.cpp prints multi-line stacks; truncate instead of slicing the
  // last line so we don't lose the cause of a model load failure.
  const trimmed = stderr.trim();
  if (trimmed.length <= 800) return trimmed;
  return `${trimmed.slice(0, 800)}…`;
}

export class WhisperUnavailableError extends Error {
  constructor(message = 'whisper.cpp binary not found on PATH') {
    super(message);
    this.name = 'WhisperUnavailableError';
  }
}

/**
 * Transcribe an uploaded audio buffer.
 * @param {Buffer} audioBuffer
 * @param {string} originalName used to detect extension for ffmpeg
 * @param {{ language?: string }} [opts]
 */
export async function transcribeBuffer(audioBuffer, originalName, opts = {}) {
  if (!isWhisperEnabled()) {
    throw new WhisperUnavailableError('whisper.cpp is disabled via WHISPER_ENABLED=false');
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'whisper-'));
  const id = randomUUID();
  const ext = path.extname(originalName || '') || '.webm';
  // Keep the input and output paths strictly disjoint: when the upload
  // already carries a .wav extension, `${id}.wav` would resolve to the
  // same path as the input and ffmpeg aborts with
  // "Output ... same as Input #0 - exiting".
  const inputPath = path.join(tmpDir, `in-${id}${ext}`);
  const wavPath = path.join(tmpDir, `out-${id}.wav`);

  try {
    await writeFile(inputPath, audioBuffer);
    await convertToWav(inputPath, wavPath);
    const text = await runWhisper(wavPath, opts);
    return text;
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
