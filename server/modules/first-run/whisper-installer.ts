// First-run installer for whisper.cpp (chat voice transcription).
//
// Goal: a fresh `git clone && npm install && npm run dev` must leave the chat
// voice button working end-to-end — no manual `setup.sh`, no ROS tracing,
// no `.env` tweaking. This is the same contract `rag-mcp-installer.ts`
// delivers for the Python RAG helper.
//
// Flow on backend startup:
//   1. Platform gate: linux + darwin only (matches `rag-mcp-installer.ts`
//      and the existing shell launcher). Windows users get the manual
//      `bash server/whisper/setup.sh` path; the UI tooltip explains this.
//   2. Sentinel gate: app_config key `whisper_installed_v1` with a version
//      constant. If it matches, install is skipped. Bump the version to
//      force a re-run after model/binary upgrades.
//   3. Mark `liveState` as `cloning` and spawn `setup.sh` (cross-spawn).
//      Stream stdout/stderr; parse `[stage: …]` markers emitted by the
//      script to transition through `cloning → building → downloading-
//      model → done`. Tail output is captured for error reporting.
//   4. On exit code 0: write sentinel `{ binaryPath, modelPath, installedAt }`
//      and flip state to `done`. On non-zero: flip to `failed` with the
//      last ~800 chars of stderr attached.
//   5. State is mirrored to `/api/whisper/config` so the chat composer can
//      show a "Setting up voice…" spinner instead of the dimmed error
//      tooltip the old button used.
//
// Concurrency: a module-level `installPromise` dedupes parallel callers
// within the same boot. Failure modes never throw — every path returns a
// discriminated `WhisperInstallState`. `server/index.js` does not need a
// try/catch.
//
// The `liveState` module-level variable is *in-memory only*. If the server
// restarts mid-install, the install restarts from scratch (the underlying
// `setup.sh` is idempotent and skips already-built/downloaded artifacts,
// so this is cheap).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import spawnPkg from 'cross-spawn';

import { appConfigDb } from '@/modules/database/index.js';
import { findAppRoot } from '@/utils/runtime-paths.js';

const { spawn: crossSpawn } = spawnPkg;

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['linux', 'darwin']);

export const SENTINEL_KEY = 'whisper_installed_v1';
export const SENTINEL_VERSION = '1';

// Generous: cmake builds the whisper.cpp binary in parallel (-j N) which
// tops out around 60 s on a 4-core machine; factor in model download.
const INSTALL_TIMEOUT_MS = Number.parseInt(
  process.env.OPENCLI_WHISPER_INSTALL_TIMEOUT_MS || String(10 * 60 * 1000),
  10,
);
const PROBE_TIMEOUT_MS = 10_000;

export type WhisperInstallStage =
  | 'idle'
  | 'detecting-binary'
  | 'cloning'
  | 'building'
  | 'downloading-model'
  | 'verifying-model'
  | 'done'
  | 'failed'
  | 'skipped-platform'
  | 'skipped-disabled';

export type WhisperInstallState = {
  stage: WhisperInstallStage;
  /** Convenience flag — true while `stage` is one of the transient states. */
  inProgress: boolean;
  /** 0..1 best-effort estimate of the install progress. */
  progress: number;
  /** Human-readable message — surfaced in the Mic tooltip. */
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
};

export type WhisperInstallSummary = {
  state: WhisperInstallState;
  installed: boolean;
  installedAt: string | null;
  binaryPath: string | null;
  modelPath: string | null;
};

/** Module-level: read-only API for routes. */
let liveState: WhisperInstallState = {
  stage: 'idle',
  inProgress: false,
  progress: 0,
  message: 'Voice transcription not set up yet.',
  startedAt: null,
  finishedAt: null,
  error: null,
};

let installedAt: string | null = null;
let installedBinaryPath: string | null = null;
let installedModelPath: string | null = null;

/** Race-safe singleton so two parallel callers don't kick off two installs. */
let installPromise: Promise<WhisperInstallState> | null = null;

/**
 * Public entry point. Fire-and-forget from `runFirstRunOnStartup()` —
 * never throws. Returns the final state regardless of path.
 */
export async function ensureWhisperOnStartup(): Promise<WhisperInstallState> {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    setLiveState({
      stage: 'skipped-platform',
      inProgress: false,
      progress: 0,
      message: `Voice auto-install is not supported on ${process.platform}. Run bash server/whisper/setup.sh manually.`,
      error: { code: 'unsupported-platform', message: `Platform ${process.platform} is not supported.` },
    });
    return readState();
  }

  if (!isEnabled()) {
    setLiveState({
      stage: 'skipped-disabled',
      inProgress: false,
      progress: 0,
      message: 'Voice transcription is disabled via WHISPER_ENABLED=false.',
      error: null,
    });
    return readState();
  }

  // Already installed per sentinel? Transition to `done` lazily — without
  // re-probing the binary, just confirm the sentinel payload looks sane.
  const sentinel = readSentinel();
  if (sentinel && sentinel.version === SENTINEL_VERSION) {
    installedAt = sentinel.installedAt;
    installedBinaryPath = sentinel.binaryPath;
    installedModelPath = sentinel.modelPath;
    setLiveState({
      stage: 'done',
      inProgress: false,
      progress: 1,
      message: 'Voice transcription ready.',
      error: null,
    });
    return readState();
  }

  if (installPromise) return installPromise;
  installPromise = runOnce().finally(() => {
    installPromise = null;
  });
  return installPromise;
}

async function runOnce(): Promise<WhisperInstallState> {
  const appRoot = findAppRoot(import.meta.url);
  const setupSh = path.join(appRoot, 'server', 'whisper', 'setup.sh');

  if (!existsSync(setupSh)) {
    return failOnce({
      code: 'setup-script-missing',
      message: `setup.sh not found at ${setupSh}. Did the repo checkout succeed?`,
    }, 'failed');
  }

  setLiveState({
    stage: 'detecting-binary',
    inProgress: true,
    progress: 0.05,
    message: 'Detecting an existing whisper.cpp install…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });

  return new Promise<WhisperInstallState>((resolve) => {
    const child = crossSpawn('bash', [setupSh], {
      cwd: path.dirname(setupSh),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finishWith = (state: WhisperInstallState) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeAllListeners();
      // SIGKILL if still alive — won't normally trigger; defensive.
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(state);
    };

    timer = setTimeout(() => {
      finishWith(failOnce({
        code: 'install-timeout',
        message: `setup.sh timed out after ${INSTALL_TIMEOUT_MS}ms.`,
      }, 'failed'));
    }, INSTALL_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stdoutTail = (stdoutTail + text).slice(-4000);
      handleStdoutLine(text);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      stderrTail = (stderrTail + text).slice(-4000);
      // Mirror stderr to console so operators see what cmake is yelling.
      process.stderr.write(`[whisper-install] ${text}`);
    });

    child.on('error', (err) => {
      finishWith(failOnce({
        code: 'spawn-failed',
        message: `Could not run setup.sh: ${err.message}`,
      }, 'failed'));
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Mark `done` even if stage never emitted the marker — the script
        // is the source of truth.
        try { refreshInstalledPaths(); } catch { /* ignore — best effort */ }
        setLiveState({
          stage: 'done',
          inProgress: false,
          progress: 1,
          message: 'Voice transcription ready.',
          finishedAt: new Date().toISOString(),
          error: null,
        });
        writeSentinel();
        finishWith(readState());
        return;
      }
      const message = (stderrTail + stdoutTail).trim().slice(-800) || `setup.sh exited with code ${code}`;
      finishWith(failOnce({
        code: 'install-failed',
        message,
      }, 'failed'));
    });
  });
}

function handleStdoutLine(chunk: string): void {
  // The script emits exactly one of these per logical stage. Each marker
  // may carry an optional payload on the same line after the bracket.
  const match = chunk.match(/^\s*\[stage:\s*([a-z][a-z0-9-]*)\]\s*(.*)?$/m);
  if (!match) return;
  const [, stageRaw, payload] = match;
  const stage = stageRaw as WhisperInstallStage;

  switch (stage) {
    case 'detecting-binary':
      setLiveState({
        stage: 'detecting-binary',
        inProgress: true,
        progress: 0.05,
        message: payload?.trim() || 'Detecting an existing whisper.cpp install…',
      });
      break;
    case 'cloning':
      setLiveState({
        stage: 'cloning',
        inProgress: true,
        progress: 0.1,
        message: payload?.trim() || 'Cloning whisper.cpp source…',
      });
      break;
    case 'building':
      setLiveState({
        stage: 'building',
        inProgress: true,
        progress: 0.45,
        message: payload?.trim() || 'Compiling whisper.cpp (first run takes ~1-2 min)…',
      });
      break;
    case 'downloading-model': {
      const pctMatch = payload?.match(/(\d+(?:\.\d+)?)%/);
      const pct = pctMatch ? Number.parseFloat(pctMatch[1]) / 100 : null;
      setLiveState({
        stage: 'downloading-model',
        inProgress: true,
        progress: pct != null ? 0.7 + 0.25 * pct : 0.8,
        message: payload?.trim() || 'Downloading ggml-base.bin model…',
      });
      break;
    }
    case 'verifying-model':
      setLiveState({
        stage: 'verifying-model',
        inProgress: true,
        progress: 0.95,
        message: payload?.trim() || 'Verifying downloaded model…',
      });
      break;
    case 'done':
      setLiveState({
        stage: 'done',
        inProgress: false,
        progress: 1,
        message: payload?.trim() || 'Voice transcription ready.',
        finishedAt: new Date().toISOString(),
        error: null,
      });
      break;
    default:
      // Unknown marker — log it but don't crash the install.
      if (process.env.DEBUG?.includes('whisper-install')) {
        console.log(`[whisper-install] unknown stage marker: ${stage}`);
      }
  }
}

function setLiveState(partial: Partial<WhisperInstallState>): void {
  liveState = { ...liveState, ...partial };
}

function failOnce(error: { code: string; message: string }, stage: WhisperInstallStage): WhisperInstallState {
  setLiveState({
    stage,
    inProgress: false,
    progress: liveState.progress,
    message: error.message,
    finishedAt: new Date().toISOString(),
    error,
  });
  return readState();
}

function readState(): WhisperInstallState {
  return { ...liveState };
}

// ------------------------------------------------------------------
// Public read-only API for /api/whisper/config and the first-run routes.
// ------------------------------------------------------------------

export function getWhisperInstallSummary(): WhisperInstallSummary {
  return {
    state: readState(),
    installed: liveState.stage === 'done',
    installedAt,
    binaryPath: installedBinaryPath,
    modelPath: installedModelPath,
  };
}

/**
 * Re-scan filesystem to refresh the cached binary/model paths. Called
 * after a successful install — the script writes both files in known
 * locations, so we re-derive the absolute paths from the app root.
 */
function refreshInstalledPaths(): void {
  const appRoot = findAppRoot(import.meta.url);
  const modelsDir = path.join(appRoot, 'server', 'whisper', 'models');
  const buildDir = path.join(appRoot, 'server', 'whisper', 'build');
  const binaryCandidates = [
    path.join(buildDir, 'build', 'bin', 'whisper-cli'),
    path.join(buildDir, 'bin', 'whisper-cli'),
    'whisper-cli',
  ];
  installedBinaryPath = binaryCandidates.find((candidate) => existsSync(candidate)) || 'whisper-cli';
  installedModelPath = path.join(modelsDir, 'ggml-base.bin');
  installedAt = new Date().toISOString();
}

/**
 * Clear the sentinel and re-run the installer. Used by the retry button
 * in the chat composer tooltip on install failure.
 */
export async function retryWhisperInstall(): Promise<WhisperInstallSummary> {
  appConfigDb.delete(SENTINEL_KEY);
  await ensureWhisperOnStartup();
  return getWhisperInstallSummary();
}

function readSentinel(): { version: string; installedAt: string; binaryPath: string; modelPath: string } | null {
  try {
    const raw = appConfigDb.get(SENTINEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      installedAt?: unknown;
      binaryPath?: unknown;
      modelPath?: unknown;
    };
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.installedAt !== 'string' ||
      typeof parsed.binaryPath !== 'string' ||
      typeof parsed.modelPath !== 'string'
    ) {
      return null;
    }
    return {
      version: parsed.version,
      installedAt: parsed.installedAt,
      binaryPath: parsed.binaryPath,
      modelPath: parsed.modelPath,
    };
  } catch {
    return null;
  }
}

function writeSentinel(): void {
  if (!installedBinaryPath || !installedModelPath || !installedAt) {
    refreshInstalledPaths();
  }
  appConfigDb.set(
    SENTINEL_KEY,
    JSON.stringify({
      version: SENTINEL_VERSION,
      installedAt,
      binaryPath: installedBinaryPath,
      modelPath: installedModelPath,
    }),
  );
}

function isEnabled(): boolean {
  const raw = process.env.WHISPER_ENABLED;
  if (raw === undefined) return true;
  return String(raw).toLowerCase() === 'true';
}

// Make TS happy about the imported-but-unused spawn from node:child_process —
// we use cross-spawn because shell:true is not desirable here.
void spawn;
