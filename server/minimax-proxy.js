import { spawn } from 'node:child_process';

import express from 'express';

// MiniMax proxy — exposes the data needed for the MiniMax settings tab and
// the Tasks tab. Wraps `mmx auth status`, `mmx config show`, and
// `mmx quota show`, plus a `/health` probe. Mounted at /api/minimax behind
// authenticateToken so a logged-in user can read their own state.
const MMX_BIN = (process.env.MMX_BIN || 'mmx').trim() || 'mmx';

const DEFAULT_TIMEOUT_MS = 30000;
const _parsed = Number(process.env.MMX_TIMEOUT_MS);
const MMX_TIMEOUT_MS = Number.isFinite(_parsed) && _parsed > 0 ? _parsed : DEFAULT_TIMEOUT_MS;

const router = express.Router();

let _cache = null;
let _cacheAt = 0;
let _textCache = null;
let _textCacheAt = 0;
const QUOTA_TTL_MS = 30 * 1000;

/**
 * Spawn `mmx` with the given args and resolve with { code, stdout, stderr }.
 * Aborts after MMX_TIMEOUT_MS so a stalled CLI can't hold the request open.
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
      reject(new Error(`${MMX_BIN} timed out after ${Math.round(MMX_TIMEOUT_MS / 1000)}s`));
    }, MMX_TIMEOUT_MS);
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
 * GET /api/minimax/health -> { configured, version }.
 * `configured` is true when the `mmx` binary is reachable.
 */
router.get('/health', async (_req, res) => {
  try {
    const { code, stdout } = await runMmx(['--version']);
    if (code !== 0) {
      return res.json({ configured: false, version: null });
    }
    return res.json({ configured: true, version: stdout.trim() });
  } catch (e) {
    return res.json({ configured: false, version: null, error: e.message });
  }
});

/**
 * GET /api/minimax/auth -> parsed `mmx auth status --output json` payload
 * (e.g. `{ method: 'api-key', source: 'config.json', key: 'sk-c...LEVY' }`).
 * Returns 200 with `{ configured: false, error }` on CLI failure so the UI
 * can degrade gracefully instead of erroring.
 */
router.get('/auth', async (_req, res) => {
  try {
    const { code, stdout, stderr } = await runMmx([
      'auth', 'status', '--output', 'json', '--quiet', '--no-color', '--non-interactive',
    ]);
    if (code !== 0) {
      return res.json({
        configured: false,
        error: (stderr || '').trim().split('\n').slice(-3).join(' | ') || `exit ${code}`,
      });
    }
    try {
      const parsed = JSON.parse(stdout);
      return res.json({ configured: true, ...parsed });
    } catch (e) {
      return res.status(502).json({ error: `mmx auth output is not JSON: ${e.message}` });
    }
  } catch (e) {
    res.json({ configured: false, error: e.message });
  }
});

/**
 * GET /api/minimax/config -> parsed `mmx config show --output json` payload
 * (region, base_url, output, timeout, config_file). Same graceful shape as
 * /auth on failure.
 */
router.get('/config', async (_req, res) => {
  try {
    const { code, stdout, stderr } = await runMmx([
      'config', 'show', '--output', 'json', '--quiet', '--no-color', '--non-interactive',
    ]);
    if (code !== 0) {
      return res.json({
        configured: false,
        error: (stderr || '').trim().split('\n').slice(-3).join(' | ') || `exit ${code}`,
      });
    }
    try {
      const parsed = JSON.parse(stdout);
      return res.json({ configured: true, ...parsed });
    } catch (e) {
      return res.status(502).json({ error: `mmx config output is not JSON: ${e.message}` });
    }
  } catch (e) {
    res.json({ configured: false, error: e.message });
  }
});

/**
 * GET /api/minimax/quota -> the parsed `mmx quota show --output json` payload,
 * or a structured 502 if the CLI fails. Cached briefly to avoid hammering the
 * CLI when the settings tab auto-refreshes.
 */
router.get('/quota', async (_req, res) => {
  const now = Date.now();
  if (_cache && now - _cacheAt < QUOTA_TTL_MS) {
    res.setHeader('X-MiniMax-Cache', 'hit');
    return res.json(_cache);
  }
  try {
    const { code, stdout, stderr } = await runMmx(['quota', 'show', '--output', 'json']);
    if (code !== 0) {
      const tail = (stderr || '').trim().split('\n').slice(-3).join(' | ');
      return res.status(502).json({
        error: `mmx quota show failed: ${tail || `exit ${code}`}`,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      return res.status(502).json({ error: `mmx quota output is not JSON: ${e.message}` });
    }
    _cache = parsed;
    _cacheAt = now;
    res.setHeader('X-MiniMax-Cache', 'miss');
    return res.json(parsed);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});


/**
 * GET /api/minimax/quota/text -> the raw `mmx quota show` output (text mode).
 * Unlike /quota this never JSON-parses, so the UI can render the bordered
 * table directly. Cached like /quota to avoid hammering the CLI.
 */
router.get('/quota/text', async (_req, res) => {
  const now = Date.now();
  if (_textCache && now - _textCacheAt < QUOTA_TTL_MS) {
    res.setHeader('X-MiniMax-Cache', 'hit');
    return res.type('text/plain').send(_textCache);
  }
  try {
    const { code, stdout, stderr } = await runMmx(['quota', 'show']);
    if (code !== 0) {
      const tail = (stderr || '').trim().split('\n').slice(-3).join(' | ');
      return res.status(502).type('text/plain').send(
        `mmx quota show failed: ${tail || `exit ${code}`}`,
      );
    }
    _textCache = stdout;
    _textCacheAt = now;
    res.setHeader('X-MiniMax-Cache', 'miss');
    return res.type('text/plain').send(stdout);
  } catch (e) {
    return res.status(502).type('text/plain').send(`mmx quota show failed: ${e.message}`);
  }
});

export default router;