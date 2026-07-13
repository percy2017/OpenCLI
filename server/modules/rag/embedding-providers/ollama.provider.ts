/**
 * Ollama embeddings provider (local).
 *
 * Uses the modern `/api/embed` endpoint which accepts batch input natively
 * (the legacy `/api/embeddings` is single-string and deprecated).
 *
 * Endpoint: POST {baseUrl}/api/embed
 * Body: { model, input: string[], truncate?, keep_alive? }
 * Response: { model, embeddings: number[][] }
 *
 * No auth, no rate limit. Default model: mxbai-embed-large (1024 dims).
 * Other reasonable choices: nomic-embed-text (768), all-minilm (384).
 *
 * Setup: `ollama serve` + `ollama pull mxbai-embed-large`.
 */

import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
} from './embedding-provider.js';
import { EmbeddingsConfigError } from './embedding-provider.js';

const PROVIDER_ID = 'ollama' as const;
const PROVIDER_LABEL = 'Ollama (local)';

const MODEL_DIMENSIONS: Record<string, number> = {
  'mxbai-embed-large': 1024,
  'nomic-embed-text': 768,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
  'snowflake-arctic-embed:335m': 1024,
  'snowflake-arctic-embed:137m': 768,
  'snowflake-arctic-embed:33m': 384,
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = PROVIDER_ID;
  readonly label = PROVIDER_LABEL;
  readonly defaultModel = 'mxbai-embed-large';
  readonly defaultDimensions = 1024;

  getConfig(): EmbeddingProviderConfig {
    const model = (process.env.OLLAMA_EMBEDDING_MODEL as string | undefined) ?? this.defaultModel;
    const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    return {
      providerId: this.id,
      providerLabel: this.label,
      model,
      dimensions: MODEL_DIMENSIONS[model] ?? this.defaultDimensions,
      apiKeyPresent: true, // Local provider never needs a key.
      baseUrl,
      chunkSize: this.parseChunkSize(),
      chunkOverlap: this.parseChunkOverlap(),
    };
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (input.texts.length === 0) {
      return { vectors: [], model: this.getConfig().model, dimensions: 0 };
    }

    const config = this.getConfig();
    const url = `${config.baseUrl.replace(/\/+$/, '')}/api/embed`;
    const batchSize = Math.max(
      1,
      Number.parseInt(process.env.OLLAMA_EMBEDDING_BATCH_SIZE ?? '32', 10) || 32,
    );
    const maxRetries = Math.max(
      0,
      Number.parseInt(process.env.OLLAMA_EMBEDDING_RETRIES ?? '2', 10) || 2,
    );

    const allVectors: number[][] = [];
    let lastModel = config.model;
    let lastDims = 0;

    for (let offset = 0; offset < input.texts.length; offset += batchSize) {
      const batch = input.texts.slice(offset, offset + batchSize);
      const { vectors, model, dimensions } = await this.embedBatchWithRetry(
        url,
        config.model,
        batch,
        maxRetries,
      );
      allVectors.push(...vectors);
      lastModel = model;
      lastDims = dimensions;
    }

    return { vectors: allVectors, model: lastModel, dimensions: lastDims };
  }

  private async embedBatchWithRetry(
    url: string,
    model: string,
    texts: string[],
    maxRetries: number,
  ): Promise<EmbeddingResponse> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            input: texts,
            truncate: true,
            keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '5m',
          }),
        });

        if (response.status === 404) {
          throw new EmbeddingsConfigError(
            `Ollama responded 404. Did you \`ollama pull ${model}\`? (and is the server reachable at ${url})`,
          );
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `Ollama embeddings API failed (${response.status}): ${errorText || response.statusText}`,
          );
        }

        const json = (await response.json()) as {
          model?: string;
          embeddings?: number[][];
        };

        if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
          throw new Error(
            `Ollama embeddings API returned unexpected payload (count=${json.embeddings?.length ?? 'n/a'}, expected ${texts.length})`,
          );
        }

        const dims = json.embeddings[0]?.length ?? 0;
        if (dims === 0) {
          throw new Error('Ollama embeddings API returned empty vectors.');
        }

        return {
          vectors: json.embeddings,
          model: json.model ?? model,
          dimensions: dims,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        const isConfigError = error instanceof EmbeddingsConfigError;
        if (isConfigError || attempt >= maxRetries) throw lastError;
        const waitMs = Math.min(2_000 * Math.pow(2, attempt), 15_000);
        console.warn(
          `[embeddings/ollama] Error "${message}". Retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}).`,
        );
        await sleep(waitMs);
        attempt += 1;
      }
    }

    throw lastError ?? new Error('Ollama embeddings API failed after exhausting retries.');
  }

  private parseChunkSize(): number {
    return Number.parseInt(process.env.RAG_CHUNK_SIZE ?? '512', 10) || 512;
  }

  private parseChunkOverlap(): number {
    return Number.parseInt(process.env.RAG_CHUNK_OVERLAP ?? '50', 10) || 50;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}