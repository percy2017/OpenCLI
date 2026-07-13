import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';
import type { LLMProvider, UpsertProviderMcpServerInput } from '@/shared/types.js';

const MCP_SERVER_NAME = 'cloudcli-minimax';
const SERVER_COMMAND = 'uvx';
const SERVER_ARGS = ['minimax-coding-plan-mcp', '-y'];
const SERVER_TRANSPORT = 'stdio' as const;
const SERVER_SCOPE = 'user' as const;
const API_HOST = 'https://api.minimax.io';

const STATE_KEY = 'mcp_minimax_enabled';
const BACKUP_KEY = 'mcp_minimax_backup';

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const CLAUDE_CONFIG_PATH = path.join(os.homedir(), '.claude.json');

type BackupBlock = {
  rawText: string;
  parsed: Record<string, unknown>;
  capturedAt: string;
};

type BackupSnapshot = {
  codex: BackupBlock | null;
  claude: BackupBlock | null;
};

type PersistedState = {
  enabled: boolean;
  lastChangedAt: string | null;
};

type ProviderConfigured = { configured: boolean };

type ProviderResult = {
  provider: LLMProvider;
  ok: boolean;
  error?: string;
};

const DEFAULT_STATE: PersistedState = {
  enabled: false,
  lastChangedAt: null,
};

function readState(): PersistedState {
  try {
    const raw = appConfigDb.get(STATE_KEY);
    if (!raw) {
      return { ...DEFAULT_STATE };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      enabled: parsed.enabled === true,
      lastChangedAt: typeof parsed.lastChangedAt === 'string' ? parsed.lastChangedAt : null,
    };
  } catch (error: any) {
    console.warn('[mcp-minimax] Failed to read state:', error?.message || error);
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

function readBackup(): BackupSnapshot {
  try {
    const raw = appConfigDb.get(BACKUP_KEY);
    if (!raw) {
      return { codex: null, claude: null };
    }

    const parsed = JSON.parse(raw) as Partial<BackupSnapshot>;
    return {
      codex: parsed.codex && typeof parsed.codex === 'object' ? parsed.codex as BackupBlock : null,
      claude: parsed.claude && typeof parsed.claude === 'object' ? parsed.claude as BackupBlock : null,
    };
  } catch (error: any) {
    console.warn('[mcp-minimax] Failed to read backup:', error?.message || error);
    return { codex: null, claude: null };
  }
}

function writeBackup(snapshot: BackupSnapshot): void {
  appConfigDb.set(BACKUP_KEY, JSON.stringify(snapshot));
}

async function readCodexBlock(): Promise<BackupBlock | null> {
  let content: string;
  try {
    content = await readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = TOML.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const mcpServers = (parsedConfig.mcp_servers && typeof parsedConfig.mcp_servers === 'object')
    ? parsedConfig.mcp_servers as Record<string, unknown>
    : {};
  const block = mcpServers[MCP_SERVER_NAME];
  if (!block || typeof block !== 'object') {
    return null;
  }

  const parsed = block as Record<string, unknown>;
  let rawText = '';
  try {
    rawText = TOML.stringify({ [MCP_SERVER_NAME]: parsed } as never);
  } catch {
    rawText = '';
  }

  return {
    rawText,
    parsed,
    capturedAt: new Date().toISOString(),
  };
}

async function readClaudeBlock(): Promise<BackupBlock | null> {
  let content: string;
  try {
    content = await readFile(CLAUDE_CONFIG_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const mcpServers = (parsedConfig.mcpServers && typeof parsedConfig.mcpServers === 'object')
    ? parsedConfig.mcpServers as Record<string, unknown>
    : {};
  const block = mcpServers[MCP_SERVER_NAME];
  if (!block || typeof block !== 'object') {
    return null;
  }

  const parsed = block as Record<string, unknown>;
  let rawText = '';
  try {
    rawText = JSON.stringify(parsed, null, 2);
  } catch {
    rawText = '';
  }

  return {
    rawText,
    parsed,
    capturedAt: new Date().toISOString(),
  };
}

async function captureBackup(): Promise<BackupSnapshot> {
  const existing = readBackup();
  const capturedAt = new Date().toISOString();

  const codexBlock = existing.codex ?? await readCodexBlock().catch(() => null);
  const claudeBlock = existing.claude ?? await readClaudeBlock().catch(() => null);

  return {
    codex: codexBlock ? { ...codexBlock, capturedAt } : null,
    claude: claudeBlock ? { ...claudeBlock, capturedAt } : null,
  };
}

async function isCodexConfigured(): Promise<boolean> {
  const block = await readCodexBlock().catch(() => null);
  return block !== null;
}

async function isClaudeConfigured(): Promise<boolean> {
  const block = await readClaudeBlock().catch(() => null);
  return block !== null;
}

function getCanonicalServerConfig(): Omit<UpsertProviderMcpServerInput, 'scope'> {
  return {
    name: MCP_SERVER_NAME,
    transport: SERVER_TRANSPORT,
    command: SERVER_COMMAND,
    args: SERVER_ARGS,
    env: { MINIMAX_API_HOST: API_HOST },
    envVars: [],
  };
}

function normalizeResults(results: Array<{ provider: LLMProvider; created?: boolean; removed?: boolean; error?: string }>): ProviderResult[] {
  return results.map((result) => {
    const ok = result.error ? false : (result.created === true || result.removed === true);
    return {
      provider: result.provider,
      ok,
      ...(result.error ? { error: result.error } : {}),
    };
  });
}

async function enable(): Promise<ProviderResult[]> {
  const config = getCanonicalServerConfig();
  const results = await providerMcpService.addMcpServerToAllProviders({
    ...config,
    scope: SERVER_SCOPE,
  });
  return normalizeResults(results);
}

async function disable(): Promise<ProviderResult[]> {
  const backup = await captureBackup();
  writeBackup(backup);

  const results = await providerMcpService.removeMcpServerFromAllProviders({
    name: MCP_SERVER_NAME,
    scope: SERVER_SCOPE,
  });
  return normalizeResults(results);
}

export const mcpMinimaxService = {
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

  // Exposed for tests / debugging. Touches disk but does not write state.
  async captureBackupForInspection(): Promise<BackupSnapshot> {
    return captureBackup();
  },

  // Constants exported for callers that need to reference the canonical server config.
  getCanonicalServerConfig,

  // Constants for clients that want to render the server name without hardcoding.
  serverName: MCP_SERVER_NAME,
};

// Make sure the config directory exists for first-run writes (Codex side).
async function ensureCodexConfigDir(): Promise<void> {
  try {
    await mkdir(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
  } catch {
    // best-effort; the provider writer will surface real errors
  }
}

void ensureCodexConfigDir();