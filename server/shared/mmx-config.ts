/**
 * Read the MiniMax API key from the `mmx` CLI's own config file so the rest
 * of the server doesn't have to duplicate the secret in its own environment.
 *
 * Resolution order (first hit wins):
 *   1. process.env.MINIMAX_API_KEY  (explicit override, e.g. CI / Docker)
 *   2. process.env.MMX_API_KEY       (legacy alias)
 *   3. $MMX_CONFIG_PATH/config.json  (test override)
 *   4. ~/.mmx/config.json            (mmx CLI default)
 *   5. ~/.config/mmx/config.json     (XDG fallback)
 *
 * Returns null when nothing is configured. Callers decide whether that's an
 * error (most embeddings/chat code paths want a hard failure with a clear
 * message).
 */

import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const MMX_CONFIG_CANDIDATES = [
  process.env.MMX_CONFIG_PATH,
  path.join(os.homedir(), '.mmx', 'config.json'),
  path.join(os.homedir(), '.config', 'mmx', 'config.json'),
].filter((p): p is string => typeof p === 'string' && p.length > 0);

let cached: { key: string | null } | null = null;

export async function getMmxApiKey(): Promise<string | null> {
  if (cached) return cached.key;

  const fromEnv = (process.env.MINIMAX_API_KEY || process.env.MMX_API_KEY || '').trim();
  if (fromEnv) {
    cached = { key: fromEnv };
    return fromEnv;
  }

  for (const candidate of MMX_CONFIG_CANDIDATES) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as { api_key?: unknown };
      if (typeof parsed.api_key === 'string' && parsed.api_key.trim()) {
        const key = parsed.api_key.trim();
        cached = { key };
        return key;
      }
    } catch {
      // try next candidate
    }
  }

  cached = { key: null };
  return null;
}

/** For tests: drop the memoized key so a config edit is picked up next call. */
export function resetMmxApiKeyCache(): void {
  cached = null;
}