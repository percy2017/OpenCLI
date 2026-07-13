/**
 * Embedding provider abstraction.
 *
 * Each provider translates a list of strings into fixed-dimension float
 * vectors. The RAG module only cares about the output shape; request
 * format, auth, and model selection are provider-internal.
 *
 * The `isQuery` flag lets providers that train asymmetrically
 * (MiniMax `type=query`, Voyage `input_type=query`) optimize retrieval
 * without leaking vendor-specific knobs into the orchestrator.
 */

export type EmbeddingProviderId = 'minimax' | 'openai' | 'ollama';

export type EmbeddingRequest = {
  texts: string[];
  isQuery: boolean;
};

export type EmbeddingResponse = {
  vectors: number[][];
  model: string;
  dimensions: number;
};

export type EmbeddingProviderConfig = {
  providerId: EmbeddingProviderId;
  providerLabel: string;
  model: string;
  dimensions: number;
  apiKeyPresent: boolean;
  baseUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  /** Optional chat model exposed for query-answer generation. The RAG
   *  pipeline asks the embeddings provider which chat model to use (so a
   *  provider can pair embeddings + chat on the same vendor); falls back
   *  to a hardcoded default in `chat.ts` when not set. */
  chatModel?: string;
};

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly label: string;
  readonly defaultModel: string;
  readonly defaultDimensions: number;
  getConfig(): EmbeddingProviderConfig;
  embed(input: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export class EmbeddingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingsConfigError';
  }
}