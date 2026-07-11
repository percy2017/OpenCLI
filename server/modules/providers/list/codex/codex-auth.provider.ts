import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Returns an authenticated status when an OPENAI_API_KEY is present in the
   * server process environment. Used as a fallback when auth.json is missing
   * (Codex authenticates via the CLI environment in that case).
   */
  private checkEnvApiKey(): CodexCredentialsStatus | null {
    if (!readOptionalString(process.env.OPENAI_API_KEY)) {
      return null;
    }
    return { authenticated: true, email: 'API Key Auth', method: 'env_api_key' };
  }

  /**
   * Detects credentials that the user configured directly in
   * `~/.codex/config.toml` (e.g. an `experimental_bearer_token` for a custom
   * provider). The CLI reads these without writing `auth.json`, so this is
   * the only way to recognize that setup.
   */
  private async checkConfigTomlCredentials(): Promise<CodexCredentialsStatus | null> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      if (!parsed) {
        return null;
      }

      const providers = readObjectRecord(parsed.model_providers);
      let providerMatched = false;
      if (providers) {
        for (const value of Object.values(providers)) {
          const record = readObjectRecord(value);
          if (!record) {
            continue;
          }
          if (readOptionalString(record.experimental_bearer_token)
              || readOptionalString(record.api_key)
              || readOptionalString(record.env_key)) {
            providerMatched = true;
            break;
          }
        }
      }

      if (providerMatched || readOptionalString(parsed.experimental_bearer_token)) {
        return { authenticated: true, email: 'Config credentials', method: 'config_toml' };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    try {
      const authPath = CODEX_AUTH_PATH;
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return this.checkEnvApiKey()
        ?? (await this.checkConfigTomlCredentials())
        ?? {
          authenticated: false,
          email: null,
          method: null,
          error: 'No valid tokens found',
        };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // auth.json missing — fall back to env-var or config.toml credentials
        // before reporting "not configured" (Codex authenticates via those
        // sources without ever writing auth.json).
        return this.checkEnvApiKey()
          ?? (await this.checkConfigTomlCredentials())
          ?? {
            authenticated: false,
            email: null,
            method: null,
            error: 'Codex not configured',
          };
      }
      return {
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
        return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
      }
    } catch {
      // Fall back to a generic authenticated marker if the token payload is not readable.
    }

    return 'Authenticated';
  }
}
