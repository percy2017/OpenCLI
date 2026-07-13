import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import { findAppRoot } from '@/utils/runtime-paths.js';
import { providerMcpService } from '@/modules/providers/index.js';
import type { LLMProvider } from '@/shared/types.js';

const MCP_SERVER_NAME = 'cloudcli-rag';
const SERVER_TRANSPORT = 'stdio' as const;
const SERVER_SCOPE = 'user' as const;

const STATE_KEY = 'rag_mcp_enabled';

type PersistedState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

type ProviderConfigured = { configured: boolean };

const DEFAULT_STATE: PersistedState = {
  enabled: false,
  lastChangedAt: null,
};

function resolveServerEntry(): { command: string; args: string[] } {
  // The MCP server is the compiled `.js` file. In dev we run from `server/`,
  // in prod from `dist-server/server/`. `findAppRoot` collapses both layouts.
  const appRoot = findAppRoot(import.meta.url);
  const candidates = [
    path.join(appRoot, 'dist-server', 'server', 'modules', 'rag-mcp', 'cloudcli-rag.mcp.js'),
    path.join(appRoot, 'server', 'modules', 'rag-mcp', 'cloudcli-rag.mcp.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: 'node', args: [candidate] };
    }
  }
  // Default to the prod path so installers / first-run writes succeed even if
  // the file hasn't been built yet — the next `npm run build:server` will
  // produce it and a subsequent toggle-off / toggle-on cycle will pick it up.
  return {
    command: 'node',
    args: [candidates[0]],
  };
}

// Tiny local sync exists check to avoid importing fs/promises on every read.
function existsSync(filePath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readState(): PersistedState {
  try {
    const raw = appConfigDb.get(STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      enabled: parsed.enabled === true,
      lastChangedAt: typeof parsed.lastChangedAt === 'string' ? parsed.lastChangedAt : null,
    };
  } catch (error: any) {
    console.warn('[rag-mcp-toggle] Failed to read state:', error?.message || error);
    return { ...DEFAULT_STATE };
  }
}

function writeState(state: PersistedState): PersistedState {
  const normalized: PersistedState = {
    enabled: state.enabled === true,
    lastChangedAt: typeof state.lastChangedAt === 'string' ? state.lastChangedAt : null,
  };
  appConfigDb.set(STATE_KEY, JSON.stringify(normalized));
  return normalized;
}

function getCanonicalServerConfig() {
  const entry = resolveServerEntry();
  return {
    name: MCP_SERVER_NAME,
    transport: SERVER_TRANSPORT,
    command: entry.command,
    args: entry.args,
    env: {} as Record<string, string>,
    envVars: [] as string[],
  };
}

function normalizeResults(results: Array<{ provider: LLMProvider; created?: boolean; removed?: boolean; error?: string }>) {
  return results.map((result) => {
    const ok = result.error ? false : result.created === true || result.removed === true;
    return {
      provider: result.provider,
      ok,
      ...(result.error ? { error: result.error } : {}),
    };
  });
}

async function enable(): Promise<Array<{ provider: LLMProvider; ok: boolean; error?: string }>> {
  const config = getCanonicalServerConfig();
  const results = await providerMcpService.addMcpServerToAllProviders({
    ...config,
    scope: SERVER_SCOPE,
  });
  return normalizeResults(
    results.map((r) => ({
      provider: r.provider,
      created: r.created,
      error: r.error,
    })),
  );
}

async function disable(): Promise<Array<{ provider: LLMProvider; ok: boolean; error?: string }>> {
  const results = await providerMcpService.removeMcpServerFromAllProviders({
    name: MCP_SERVER_NAME,
    scope: SERVER_SCOPE,
  });
  return normalizeResults(
    results.map((r) => ({
      provider: r.provider,
      removed: r.removed,
      error: r.error,
    })),
  );
}

async function isCodexConfigured(): Promise<boolean> {
  try {
    const servers = await providerMcpService.listProviderMcpServersForScope('codex', 'user');
    return servers.some((entry) => entry.name === MCP_SERVER_NAME);
  } catch {
    return false;
  }
}

async function isClaudeConfigured(): Promise<boolean> {
  try {
    const servers = await providerMcpService.listProviderMcpServersForScope('claude', 'user');
    return servers.some((entry) => entry.name === MCP_SERVER_NAME);
  } catch {
    return false;
  }
}

export const ragMcpToggleService = {
  async getState() {
    return readState();
  },

  async getStatus() {
    const [codexConfigured, claudeConfigured] = await Promise.all([
      isCodexConfigured(),
      isClaudeConfigured(),
    ]);
    return {
      state: readState(),
      providers: {
        codex: { configured: codexConfigured } satisfies ProviderConfigured,
        claude: { configured: claudeConfigured } satisfies ProviderConfigured,
      },
    };
  },

  async setEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.');
    }
    const results = enabled ? await enable() : await disable();
    const lastChangedAt = new Date().toISOString();
    const nextState = writeState({ enabled, lastChangedAt });
    return { state: nextState, results };
  },

  getCanonicalServerConfig,
  serverName: MCP_SERVER_NAME,
};

void os; // keep import to avoid lint removing unused for future env-based paths
