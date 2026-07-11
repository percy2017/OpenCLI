import type { LLMProvider } from '@/shared/types.js';

/**
 * Registry of per-provider abort functions.
 *
 * The websocket runtime is wired up with one abort function per provider
 * (`chat.abortFns` in `server/index.js`). The reset endpoint needs the
 * same functions, but it lives in a different module (`provider.routes.ts`)
 * — so the wiring happens once at startup via `setProviderAbortRegistry`,
 * and the routes read the latest map via `getProviderAbortFunction`.
 *
 * This indirection is required because the `boundaries/elements` ESLint
 * rule forbids routes from importing directly from `server/index.js`.
 */

export type ProviderAbortFunction = (sessionId: string) => boolean;

export type ProviderAbortRegistry = Partial<Record<LLMProvider, ProviderAbortFunction>>;

let registry: ProviderAbortRegistry = {};

export const setProviderAbortRegistry = (next: ProviderAbortRegistry): void => {
  registry = { ...next };
};

export const getProviderAbortFunction = (provider: LLMProvider): ProviderAbortFunction | undefined => (
  registry[provider]
);