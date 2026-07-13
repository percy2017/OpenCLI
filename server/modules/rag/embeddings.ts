/**
 * Compatibility shim for the legacy embeddings module.
 *
 * The implementation now lives in `embedding-providers/`. This file
 * re-exports the public surface so callers can keep importing from
 * `./embeddings.js` until they're migrated to `./embedding-providers/registry.js`.
 */

import { EmbeddingsConfigError } from './embedding-providers/embedding-provider.js';
import { embedTexts, getEmbeddingProvider } from './embedding-providers/registry.js';

export { EmbeddingsConfigError };
export { embedTexts, getEmbeddingProvider };

/**
 * @deprecated Use `getEmbeddingProvider().getConfig()` instead.
 * Kept for callers that still expect the flat legacy shape.
 */
export function getEmbeddingsConfig() {
  return getEmbeddingProvider().getConfig();
}