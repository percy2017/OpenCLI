/**
 * Embedding provider registry.
 *
 * Resolves the active provider from `RAG_EMBEDDING_PROVIDER` (default: ollama).
 * Caches the singleton per id so config reads happen once per process.
 *
 * Supported providers: minimax | openai | ollama.
 */

import type {
  EmbeddingProvider,
  EmbeddingProviderId,
  EmbeddingRequest,
  EmbeddingResponse,
} from './embedding-provider.js';
import { MiniMaxEmbeddingProvider } from './minimax.provider.js';
import { OllamaEmbeddingProvider } from './ollama.provider.js';
import { OpenAIEmbeddingProvider } from './openai.provider.js';

const VALID_IDS: readonly EmbeddingProviderId[] = ['minimax', 'openai', 'ollama'];

function isValidId(value: string): value is EmbeddingProviderId {
  return (VALID_IDS as readonly string[]).includes(value);
}

function resolveProviderId(): EmbeddingProviderId {
  const raw = (process.env.RAG_EMBEDDING_PROVIDER ?? 'ollama').trim().toLowerCase();
  if (!isValidId(raw)) {
    throw new Error(
      `Invalid RAG_EMBEDDING_PROVIDER="${raw}". Supported: ${VALID_IDS.join(', ')}.`,
    );
  }
  return raw;
}

const cache = new Map<EmbeddingProviderId, EmbeddingProvider>();

export function getEmbeddingProvider(): EmbeddingProvider {
  const id = resolveProviderId();
  const existing = cache.get(id);
  if (existing) return existing;

  let provider: EmbeddingProvider;
  switch (id) {
    case 'minimax':
      provider = new MiniMaxEmbeddingProvider();
      break;
    case 'openai':
      provider = new OpenAIEmbeddingProvider();
      break;
    case 'ollama':
      provider = new OllamaEmbeddingProvider();
      break;
  }
  cache.set(id, provider);
  return provider;
}

/**
 * Helper used by callers that don't care which provider is active —
 * just resolve the current one and embed.
 */
export async function embedTexts(input: EmbeddingRequest): Promise<EmbeddingResponse> {
  return getEmbeddingProvider().embed(input);
}