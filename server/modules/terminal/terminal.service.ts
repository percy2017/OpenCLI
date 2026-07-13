/**
 * Terminal module service.
 *
 * Persists the kill-switch state for the integrated shell (WebSocket /shell).
 * Backed by the `app_config` SQLite key-value store, same shape as
 * `rag_mcp_enabled` and `rag_vector_enabled` so it can evolve later without
 * a schema migration.
 */

import { appConfigDb } from '@/modules/database/index.js';

export const TERMINAL_STATE_KEY = 'terminal_enabled';

export type TerminalState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

const DEFAULT_STATE: TerminalState = {
  enabled: true,
  lastChangedAt: null,
};

function readTerminalState(): TerminalState {
  try {
    const raw = appConfigDb.get(TERMINAL_STATE_KEY);
    if (!raw) {
      return { ...DEFAULT_STATE };
    }

    const parsed = JSON.parse(raw) as Partial<TerminalState>;
    return {
      enabled: parsed.enabled === true,
      lastChangedAt: typeof parsed.lastChangedAt === 'string' ? parsed.lastChangedAt : null,
    };
  } catch {
    // Fail-open: if the row is missing or the JSON is corrupt, keep the
    // feature enabled. That preserves the historical behavior (no switch
    // existed before) and avoids bricking the shell on bad writes.
    return { ...DEFAULT_STATE };
  }
}

function writeTerminalState(next: { enabled: boolean; lastChangedAt: string }): TerminalState {
  const persisted: TerminalState = {
    enabled: next.enabled === true,
    lastChangedAt: next.lastChangedAt,
  };

  appConfigDb.set(TERMINAL_STATE_KEY, JSON.stringify(persisted));
  return persisted;
}

export const terminalService = {
  getState(): TerminalState {
    return readTerminalState();
  },

  /**
   * Hot-path check used by the WebSocket router. Kept cheap and synchronous
   * because it runs once per WS upgrade on the `/shell` path.
   */
  isEnabled(): boolean {
    return readTerminalState().enabled;
  },

  setEnabled(enabled: boolean): TerminalState {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.');
    }

    return writeTerminalState({
      enabled,
      lastChangedAt: new Date().toISOString(),
    });
  },

  stateKey: TERMINAL_STATE_KEY,
};