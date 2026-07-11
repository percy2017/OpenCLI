import { sessionsDb } from '@/modules/database/index.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import {
  clearProviderSessionActiveModelChanges,
  getProviderSessionActiveModelChangesPath,
} from '@/shared/utils.js';
import type {
  ProviderAbortFunction,
  ProviderAbortRegistry,
} from '@/shared/provider-abort.js';
import type { LLMProvider } from '@/shared/types.js';

type ModelsService = typeof providerModelsService;

export type ProviderResetServiceDependencies = {
  abortRegistry?: ProviderAbortRegistry;
  modelsService?: ModelsService;
  activeModelChangesPath?: string;
};

export type ProviderResetSummary = {
  provider: LLMProvider;
  abortedProcesses: number;
  deletedSessions: number;
  clearedFromModelsCache: boolean;
  clearedActiveModelChangeEntries: number;
};

const resolveAbortFn = (
  registry: ProviderAbortRegistry | undefined,
  provider: LLMProvider,
): ProviderAbortFunction | undefined => registry?.[provider];

/**
 * Orchestrates the per-provider reset flow.
 *
 * Steps, in order:
 *   1. List every session row for the provider (so each session's abort
 *      function can be called before the row is dropped).
 *   2. Abort any live process for those sessions. Best-effort, fire-and-forget.
 *   3. DELETE every `sessions` row in a single SQLite transaction.
 *   4. Drop the provider entry from the persisted models cache file.
 *   5. Drop every session-model-change override whose key starts with
 *      `${provider}:` from the overrides cache file.
 *
 * Steps 4 and 5 swallow filesystem errors so the critical state — sessions
 * and live processes — is always cleaned up even if a cache rewrite fails.
 */
export const createProviderResetService = (
  dependencies: ProviderResetServiceDependencies = {},
) => {
  const abortRegistry = dependencies.abortRegistry;
  const modelsService = dependencies.modelsService ?? providerModelsService;
  const activeModelChangesPath =
    dependencies.activeModelChangesPath ?? getProviderSessionActiveModelChangesPath();

  const resetProvider = async (provider: LLMProvider): Promise<ProviderResetSummary> => {
    const sessions = sessionsDb.getAllByProvider(provider);

    const abortFn = resolveAbortFn(abortRegistry, provider);
    let abortedProcesses = 0;
    for (const session of sessions) {
      const sessionId = session.provider_session_id ?? session.session_id;
      if (typeof sessionId === 'string' && abortFn?.(sessionId)) {
        abortedProcesses += 1;
      }
    }

    const deletedSessions = sessionsDb.deleteByProvider(provider);

    let clearedFromModelsCache = false;
    try {
      clearedFromModelsCache = await modelsService.clearCacheForProvider(provider);
    } catch (error) {
      console.error('Provider reset: models cache cleanup failed', error);
    }

    let clearedActiveModelChangeEntries = 0;
    try {
      clearedActiveModelChangeEntries = await clearProviderSessionActiveModelChanges(provider, {
        filePath: activeModelChangesPath,
      });
    } catch (error) {
      console.error('Provider reset: active model changes cleanup failed', error);
    }

    return {
      provider,
      abortedProcesses,
      deletedSessions,
      clearedFromModelsCache,
      clearedActiveModelChangeEntries,
    };
  };

  return { resetProvider };
};

export const providerResetService = createProviderResetService();