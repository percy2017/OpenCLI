// First-run installer for the Python-based RAG MCP.
//
// Goal: a fresh `git clone && npm install && npm run dev` must leave the RAG MCP
// installed and registered in the Claude provider's user-scope config
// (~/.claude.json) — no manual `uv venv`, `pip install`, or JSON pasting.
//
// Flow on backend startup:
//   1. Gate by sentinel in `app_config` (key = `rag_mcp_installed_v1`). Bump
//      the version constant to force a re-install.
//   2. Detect a Python package manager: prefer `uv`, fall back to
//      `python3 -m pip`. If neither is available, log a multi-line warning,
//      leave sentinel untouched, and return without registering the MCP — the
//      server still boots; the user sees the warning in the console and in the
//      Settings → RAG status card.
//   3. Recreate `mcp/rag/.venv` if missing and run an editable install
//      (`pip install -e .`) so changes to `src/rag_mcp/` are picked up on the
//      next launch without a re-install.
//   4. Health-check: spawn the venv python and `import rag_mcp.server`.
//      Failure aborts registration; sentinel stays unwritten so the next boot
//      retries from step 2.
//   5. Register the MCP via `providerMcpService.upsertProviderMcpServer`
//      writing the `command` as the absolute path to the existing
//      `run-server.sh` launcher (so the shell-script's env translation layer
//      keeps working).
//   6. Write the sentinel so subsequent boots short-circuit.
//
// Concurrency: a module-level `installPromise` dedupes parallel callers within
// the same boot. Failure modes never throw — every path logs and returns a
// discriminated `InstallerResult`. `server/index.js` does not need a try/catch.
//
// Platform: only `linux` and `darwin` are supported (matches the shell
// launcher). Windows returns early; the MCP UI shows it as absent.

import { existsSync } from 'node:fs';
import path from 'node:path';

import spawn from 'cross-spawn';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { findAppRoot } from '@/utils/runtime-paths.js';
import { appConfigDb } from '@/modules/database/index.js';

type InstallerResult =
  | { installed: true; manager: 'uv' | 'pip'; commandPath: string }
  | { skipped: false; reason: 'health-check-failed'; stderr: string }
  | { skipped: false; reason: 'install-failed'; message: string }
  | { skipped: true; reason: 'already-installed'; version: string; manager: string }
  | { skipped: true; reason: 'unsupported-platform'; platform: NodeJS.Platform }
  | { skipped: true; reason: 'pyproject-missing'; ragDir: string }
  | { skipped: true; reason: 'no-package-manager' };

/**
 * UI-friendly view of the install state. Flattens `InstallerResult` and the
 * sentinel into a discriminated union that the Settings → MCP card can render
 * without needing to inspect the underlying failure details.
 */
export type InstallerSummary =
  | { status: 'installed'; manager: 'uv' | 'pip'; commandPath: string; lastUpdated: string }
  | { status: 'pending'; reason: 'never-installed' | 'version-mismatch' }
  | {
      status: 'failed';
      reason:
        | 'health-check-failed'
        | 'install-failed'
        | 'no-package-manager'
        | 'pyproject-missing'
        | 'unsupported-platform';
      message?: string;
      platform?: string;
      ragDir?: string;
    };

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['linux', 'darwin']);
export const SENTINEL_KEY = 'rag_mcp_installed_v1';
export const SENTINEL_VERSION = '1';
// Keep generous: editable installs over the full pyproject.toml dependency set
// can take several minutes on a cold cache.
const INSTALL_TIMEOUT_MS = Number.parseInt(
  process.env.OPENCLI_RAG_INSTALL_TIMEOUT_MS || String(10 * 60 * 1000),
  10,
);
const PROBE_TIMEOUT_MS = 10_000;

// Module-level singleton so two parallel callers don't kick off two installs.
let installPromise: Promise<InstallerResult> | null = null;

export async function ensureRagMcpOnStartup(): Promise<InstallerResult> {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    console.log(`[rag-mcp] Skipping install: ${process.platform} is not supported.`);
    return { skipped: true, reason: 'unsupported-platform', platform: process.platform };
  }

  if (installPromise) {
    return installPromise;
  }

  installPromise = runOnce();
  try {
    return await installPromise;
  } finally {
    installPromise = null;
  }
}

async function runOnce(): Promise<InstallerResult> {
  const existing = readSentinel();
  if (existing && existing.version === SENTINEL_VERSION) {
    console.log(
      `[rag-mcp] Already installed (sentinel v${existing.version}, manager=${existing.manager}); skipping.`,
    );
    return {
      skipped: true,
      reason: 'already-installed',
      version: existing.version,
      manager: existing.manager,
    };
  }

  const appRoot = findAppRoot(import.meta.url);
  const ragDir = path.join(appRoot, 'mcp', 'rag');
  const launcherPath = path.join(ragDir, 'run-server.sh');
  const envFilePath = path.join(appRoot, '.env');

  if (!existsSync(path.join(ragDir, 'pyproject.toml'))) {
    console.warn(`[rag-mcp] pyproject.toml not found at ${ragDir}; skipping install.`);
    return { skipped: true, reason: 'pyproject-missing', ragDir };
  }

  if (!existsSync(launcherPath)) {
    console.warn(`[rag-mcp] run-server.sh not found at ${launcherPath}; skipping install.`);
    return { skipped: true, reason: 'pyproject-missing', ragDir };
  }

  const manager = await detectManager();
  if (!manager) {
    console.warn(
      [
        '[rag-mcp] Neither `uv` nor `python3 -m pip` is available on this machine.',
        '        The RAG MCP will not be registered automatically.',
        '        Install one of the following, then restart the server:',
        '          • uv:  https://docs.astral.sh/uv/getting-started/installation/',
        '          • pip: apt install python3-pip  (or your OS package manager)',
        `        Or run the install manually: cd ${ragDir} && uv venv .venv && uv pip install -e .`,
      ].join('\n'),
    );
    return { skipped: true, reason: 'no-package-manager' };
  }

  try {
    await ensureVenvAndInstall(ragDir, manager);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[rag-mcp] Install with ${manager} failed:\n${message}`);
    return { skipped: false, reason: 'install-failed', message };
  }

  const health = await runHealthCheck(ragDir);
  if (health.code !== 0) {
    console.warn(
      `[rag-mcp] Health check failed (exit ${health.code}):\n${health.stderr || '(no stderr)'}`,
    );
    return { skipped: false, reason: 'health-check-failed', stderr: health.stderr };
  }

  await providerMcpService.upsertProviderMcpServer('claude', {
    name: 'rag',
    scope: 'user',
    transport: 'stdio',
    command: launcherPath,
    args: [],
    env: { OPENCLI_ENV: envFilePath },
  });

  writeSentinel({
    version: SENTINEL_VERSION,
    installedAt: new Date().toISOString(),
    manager,
    commandPath: launcherPath,
    launcherVerified: true,
  });

  console.log(`[rag-mcp] Installed (via ${manager}) and registered as Claude MCP.`);
  return { installed: true, manager, commandPath: launcherPath };
}

async function detectManager(): Promise<'uv' | 'pip' | null> {
  if (await probe('uv', ['--version'])) {
    return 'uv';
  }
  if (await probe('python3', ['-m', 'pip', '--version'])) {
    return 'pip';
  }
  return null;
}

async function probe(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

async function ensureVenvAndInstall(ragDir: string, manager: 'uv' | 'pip'): Promise<void> {
  const venvPython = path.join(ragDir, '.venv', 'bin', 'python');

  if (!existsSync(venvPython)) {
    if (manager === 'uv') {
      console.log('[rag-mcp] Creating venv with uv…');
      await runLogged('uv', ['venv', '.venv'], ragDir);
    } else {
      console.log('[rag-mcp] Creating venv with python3 -m venv…');
      await runLogged('python3', ['-m', 'venv', '.venv'], ragDir);
    }
  }

  if (manager === 'uv') {
    console.log('[rag-mcp] Installing dependencies with uv (editable)…');
    await runLogged('uv', ['pip', 'install', '-e', '.'], ragDir);
  } else {
    const venvPy = path.join(ragDir, '.venv', 'bin', 'python');
    console.log('[rag-mcp] Installing dependencies with pip (editable)…');
    await runLogged(venvPy, ['-m', 'pip', 'install', '-e', '.'], ragDir);
  }
}

async function runLogged(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(
        `${command} ${args.join(' ')} timed out after ${INSTALL_TIMEOUT_MS}ms.`,
      )));
    }, INSTALL_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => stdoutChunks.push(String(chunk)));
    child.stderr?.on('data', (chunk) => stderrChunks.push(String(chunk)));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => {
      if (code === 0) {
        // Stream install progress at debug level only — these can be long.
        if (process.env.DEBUG?.includes('rag-mcp')) {
          console.log(`[rag-mcp] ${command} ${args.join(' ')} stdout:\n${stdoutChunks.join('')}`);
        }
        resolve();
        return;
      }
      const output = (stdoutChunks.join('') + stderrChunks.join('')).trim();
      reject(new Error(output || `${command} ${args.join(' ')} exited with code ${code}`));
    }));
  });
}

async function runHealthCheck(ragDir: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const venvPy = path.join(ragDir, '.venv', 'bin', 'python');
    const child = spawn(venvPy, ['-c', 'import rag_mcp.server'], {
      cwd: ragDir,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderrChunks: string[] = [];
    let settled = false;
    const finish = (code: number, stderr: string) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    };
    child.stderr?.on('data', (chunk) => stderrChunks.push(String(chunk)));
    child.on('error', () => finish(1, stderrChunks.join('')));
    child.on('close', (code) => finish(code ?? 1, stderrChunks.join('')));
  });
}

function readSentinel(): { version: string; manager: string } | null {
  try {
    const raw = appConfigDb.get(SENTINEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; manager?: unknown };
    if (typeof parsed.version !== 'string' || typeof parsed.manager !== 'string') {
      return null;
    }
    return { version: parsed.version, manager: parsed.manager };
  } catch {
    return null;
  }
}

function writeSentinel(payload: {
  version: string;
  installedAt: string;
  manager: 'uv' | 'pip';
  commandPath: string;
  launcherVerified: boolean;
}): void {
  appConfigDb.set(SENTINEL_KEY, JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Public API for the first-run routes / UI status card.
// ---------------------------------------------------------------------------

/**
 * Read the current install state without running anything. Maps the sentinel
 * (or its absence) onto the `InstallerSummary` discriminated union used by
 * the Settings → MCP card.
 */
export function getRagMcpInstallSummary(): InstallerSummary {
  const existing = readSentinel();
  if (!existing) {
    return { status: 'pending', reason: 'never-installed' };
  }
  if (existing.version !== SENTINEL_VERSION) {
    return { status: 'pending', reason: 'version-mismatch' };
  }

  // Re-read the full payload (manager, commandPath, installedAt). The sentinel
  // reader at the top of this file only returns { version, manager } for the
  // internal gate; here we need the rest.
  try {
    const raw = appConfigDb.get(SENTINEL_KEY);
    if (!raw) {
      return { status: 'pending', reason: 'never-installed' };
    }
    const parsed = JSON.parse(raw) as {
      manager?: unknown;
      commandPath?: unknown;
      installedAt?: unknown;
    };
    if (
      typeof parsed.manager !== 'string' ||
      (parsed.manager !== 'uv' && parsed.manager !== 'pip') ||
      typeof parsed.commandPath !== 'string' ||
      typeof parsed.installedAt !== 'string'
    ) {
      return { status: 'pending', reason: 'version-mismatch' };
    }
    return {
      status: 'installed',
      manager: parsed.manager,
      commandPath: parsed.commandPath,
      lastUpdated: parsed.installedAt,
    };
  } catch {
    return { status: 'pending', reason: 'never-installed' };
  }
}

/**
 * Clear the install sentinel and re-run the installer. Returns the resulting
 * `InstallerSummary`. Concurrent calls are deduped by `ensureRagMcpOnStartup`'s
 * `installPromise` singleton — clearing it here would race two installs
 * against the same `.venv`, so we deliberately do not.
 */
export async function retryRagMcpInstall(): Promise<InstallerSummary> {
  appConfigDb.delete(SENTINEL_KEY);
  const result = await ensureRagMcpOnStartup();
  return resultToSummary(result);
}

function resultToSummary(result: InstallerResult): InstallerSummary {
  if ('installed' in result && result.installed) {
    return {
      status: 'installed',
      manager: result.manager,
      commandPath: result.commandPath,
      lastUpdated: new Date().toISOString(),
    };
  }
  if ('skipped' in result && result.skipped) {
    if (result.reason === 'already-installed') {
      // Unreachable in the retry path (we just cleared the sentinel), but
      // mapped defensively so the API contract holds for any caller.
      return { status: 'installed', manager: 'uv', commandPath: '', lastUpdated: new Date().toISOString() };
    }
    if (result.reason === 'unsupported-platform') {
      return { status: 'failed', reason: 'unsupported-platform', platform: result.platform };
    }
    if (result.reason === 'pyproject-missing') {
      return { status: 'failed', reason: 'pyproject-missing', ragDir: result.ragDir };
    }
    if (result.reason === 'no-package-manager') {
      return { status: 'failed', reason: 'no-package-manager' };
    }
    return { status: 'pending', reason: 'never-installed' };
  }
  // `skipped: false` branches: failures.
  if ('reason' in result && result.reason === 'health-check-failed') {
    return { status: 'failed', reason: 'health-check-failed', message: result.stderr };
  }
  if ('reason' in result && result.reason === 'install-failed') {
    return { status: 'failed', reason: 'install-failed', message: result.message };
  }
  // Fallback — should not happen given the union, but TypeScript narrows here.
  return { status: 'pending', reason: 'never-installed' };
}

