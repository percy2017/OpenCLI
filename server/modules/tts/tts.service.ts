/**
 * Backend wrapper around the `mmx speech synthesize` CLI.
 *
 * Why a wrapper instead of calling MiniMax's HTTP API directly:
 *   - `mmx` is already installed and authenticated on this server
 *     (see /root/.mmx/config.json, resolved by shared/mmx-config.ts).
 *   - It handles retries, region routing, and the speech-2.8-hd model
 *     selection for us.
 *   - Reusing the same CLI that the bundled minimax-mm-cli skill teaches
 *     keeps the operator surface uniform.
 *
 * Lifecycle:
 *   - At first call we run a `mmx --version` probe to confirm the binary is
 *     on PATH. The result is memoized so every later request avoids the
 *     startup cost. A negative probe makes synthesize() throw immediately
 *     with a clear `tts-unavailable` error so the route layer can map it
 *     to a 503.
 *   - Each call writes the mp3 to a unique tmp file, then reads it back
 *     into memory before unlinking. We could stream the bytes through,
 *     but the simpler buffer round-trip is fine for ≤30-second clips and
 *     makes the route layer's `res.send(buffer)` trivial.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

export type TtsOptions = {
  voice?: string;
  speed?: number;
  language?: string;
  model?: string;
  format?: string;
};

export type TtsPublicConfig = {
  voice: string;
  speed: number;
  language: string;
  model: string;
  autoPlay: boolean;
  mmxAvailable: boolean;
};

const DEFAULT_VOICE = 'Spanish_Narrator';
const DEFAULT_MODEL = 'speech-2.8-hd';
const DEFAULT_LANGUAGE = 'es';
const DEFAULT_SPEED = 1.0;
const DEFAULT_FORMAT = 'mp3';
const DEFAULT_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

let mmxProbe: Promise<boolean> | null = null;

function readEnvFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return String(raw).toLowerCase() === 'true';
}

function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvString(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}

/** Read the user-facing defaults straight from env at call time so config
 *  changes don't need a server restart. */
export function getTtsConfig(): TtsPublicConfig {
  return {
    voice: readEnvString('TTS_VOICE', DEFAULT_VOICE),
    speed: clampSpeed(readEnvFloat('TTS_SPEED', DEFAULT_SPEED)),
    language: readEnvString('TTS_LANGUAGE', DEFAULT_LANGUAGE),
    model: readEnvString('TTS_MODEL', DEFAULT_MODEL),
    autoPlay: readEnvBool('TTS_AUTO_PLAY', false),
    mmxAvailable: false, // overwritten by callers that already probed
  };
}

/** Operator kill-switch. Returns false when TTS_ENABLED is explicitly
 *  set to "false" (the .env default is "true"). Used by both the route
 *  layer (to short-circuit before invoking mmx) and the frontend (so the
 *  button can hide itself entirely instead of just erroring on click). */
export function isTtsEnabled(): boolean {
  return readEnvBool('TTS_ENABLED', true);
}

/** Probe `mmx --version` once per process. Returns true if the binary is
 *  on PATH and exits 0. */
export function probeMmxAvailable(): Promise<boolean> {
  if (!mmxProbe) {
    mmxProbe = new Promise((resolve) => {
      const child = spawn('mmx', ['--version'], {
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
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
        resolve(code === 0);
      });
    });
  }
  return mmxProbe;
}

/** Reset the cached probe (for tests). */
export function resetMmxProbeCache(): void {
  mmxProbe = null;
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED;
  return Math.min(2.0, Math.max(0.5, speed));
}

export class TtsUnavailableError extends Error {
  constructor(message = 'mmx CLI not found on PATH') {
    super(message);
    this.name = 'TtsUnavailableError';
  }
}

export class TtsEmptyError extends Error {
  constructor(message = 'No text to synthesize') {
    super(message);
    this.name = 'TtsEmptyError';
  }
}

/** Run `mmx speech synthesize` and return the synthesized mp3 buffer. */
export async function synthesizeToBuffer(
  text: string,
  opts: TtsOptions = {},
): Promise<Buffer> {
  const cleaned = String(text || '').trim();
  if (!cleaned) {
    throw new TtsEmptyError();
  }

  const available = await probeMmxAvailable();
  if (!available) {
    throw new TtsUnavailableError();
  }

  const voice = opts.voice || readEnvString('TTS_VOICE', DEFAULT_VOICE);
  const speed = clampSpeed(opts.speed ?? readEnvFloat('TTS_SPEED', DEFAULT_SPEED));
  const language = opts.language || readEnvString('TTS_LANGUAGE', DEFAULT_LANGUAGE);
  const model = opts.model || readEnvString('TTS_MODEL', DEFAULT_MODEL);
  const format = opts.format || DEFAULT_FORMAT;

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tts-'));
  const outFile = path.join(tmpDir, `${randomUUID()}.${format}`);

  const args = [
    'speech', 'synthesize',
    '--text', cleaned,
    '--voice', voice,
    '--speed', String(speed),
    '--language', language,
    '--model', model,
    '--format', format,
    '--out', outFile,
  ];

  const timeoutMs = readEnvInt('TTS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);

  try {
    await runMmx(args, timeoutMs);
    return await readFile(outFile);
  } finally {
    // Best-effort cleanup; never let tmp teardown mask the real error.
    rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runMmx(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('mmx', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`mmx timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    timer.unref?.();

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        // Try to surface the structured error JSON mmx prints when it
        // exists; otherwise fall back to the raw stderr.
        const parsed = parseMmxError(stderr);
        reject(new Error(parsed || `mmx exited with code ${code}: ${stderr.trim()}`));
      });
    });
  });
}

function parseMmxError(stderr: string): string | null {
  if (!stderr) return null;
  try {
    // mmx prints JSON on a single line for known failures. Find the first
    // JSON object in the buffer and extract its `error.message`.
    const match = stderr.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    const message = obj?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
    return null;
  } catch {
    return null;
  }
}

/** Proxy `mmx speech voices` so the frontend can list voices without
 *  shelling out on the user's machine. */
export async function listVoices(language?: string): Promise<unknown[]> {
  const available = await probeMmxAvailable();
  if (!available) {
    throw new TtsUnavailableError();
  }

  const args = ['speech', 'voices', '--output', 'json'];
  if (language) {
    args.push('--language', language);
  }

  const stdout = await runMmxCapture(args, 15_000);
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function runMmxCapture(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('mmx', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`mmx timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const parsed = parseMmxError(stderr);
        reject(new Error(parsed || `mmx exited with code ${code}: ${stderr.trim()}`));
      });
    });
  });
}