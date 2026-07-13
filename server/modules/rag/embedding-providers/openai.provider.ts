/**
 * OpenAI embeddings provider.
 *
 * Endpoint: POST {baseUrl}/v1/embeddings
 * Auth: Bearer OPENAI_API_KEY.
 * Body: { model, input: string[] | string, encoding_format?, dimensions? }
 * Response: { data: [{ embedding: number[] }], model, usage }
 *
 * Default: text-embedding-3-small (1536 dims, configurable down to 256).
 * Free tier: 100 RPM / 40k TPM.
 */

import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
} from './embedding-provider.js';
import { EmbeddingsConfigError } from './embedding-provider.js';

const PROVIDER_ID = 'openai' as const;
const PROVIDER_LABEL = 'OpenAI';

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = PROVIDER_ID;
  readonly label = PROVIDER_LABEL;
  readonly defaultModel = 'text-embedding-3-small';
  readonly defaultDimensions = 1536;

  getConfig(): EmbeddingProviderConfig {
    const model = (process.env.OPENAI_EMBEDDING_MODEL as string | undefined) ?? this.defaultModel;
    const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    return {
      providerId: this.id,
      providerLabel: this.label,
      model,
      dimensions: MODEL_DIMENSIONS[model] ?? this.defaultDimensions,
      apiKeyPresent: Boolean(this.resolveApiKey()),
      baseUrl,
      chunkSize: this.parseChunkSize(),
      chunkOverlap: this.parseChunkOverlap(),
    };
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (input.texts.length === 0) {
      return { vectors: [], model: (await this.getConfig()).model, dimensions: 0 };
    }

    const config = await this.getConfig();
    const apiKey = this.resolveApiKey();
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
    const batchSize = Math.max(
      1,
      Number.parseInt(process.env.OPENAI_EMBEDDING_BATCH_SIZE ?? '64', 10) || 64,
    );
    const maxRetries = Math.max(
      0,
      Number.parseInt(process.env.OPENAI_EMBEDDING_RETRIES ?? '3', 10) || 3,
    );

    const allVectors: number[][] = [];
    let lastModel = config.model;
    let lastDims = 0;

    for (let offset = 0; offset < input.texts.length; offset += batchSize) {
      const batch = input.texts.slice(offset, offset + batchSize);
      const { vectors, model, dimensions } = await this.embedBatchWithRetry(
        url,
        apiKey,
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

  private resolveApiKey(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key || key.trim().length === 0) {
      throw new EmbeddingsConfigError(
        'OpenAI API key not configured. Set OPENAI_API_KEY in your environment.',
      );
    }
    return key.trim();
  }

  private parseChunkSize(): number {
    return Number.parseInt(process.env.RAG_CHUNK_SIZE ?? '512', 10) || 512;
  }

  private parseChunkOverlap(): number {
    return Number.parseInt(process.env.RAG_CHUNK_OVERLAP ?? '50', 10) || 50;
  }

  private async embedBatchWithRetry(
    url: string,
    apiKey: string,
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
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: texts,
            encoding_format: 'float',
          }),
        });

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          const waitMs = retryAfterHeader
            ? Math.max(1_000, Number.parseInt(retryAfterHeader, 10) * 1_000)
            : Math.min(backoffMs(attempt), 30_000);
          console.warn(
            `[embeddings/openai] Rate limited. Retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}).`,
          );
          await sleep(waitMs);
          attempt += 1;
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `OpenAI embeddings API failed (${response.status}): ${errorText || response.statusText}`,
          );
        }

        const json = (await response.json()) as {
          data?: Array<{ embedding: number[]; index: number }>;
          model?: string;
        };

        if (!Array.isArray(json.data) || json.data.length !== texts.length) {
          throw new Error(
            `OpenAI embeddings API returned unexpected payload (count=${json.data?.length ?? 'n/a'}, expected ${texts.length})`,
          );
        }

        // OpenAI returns embeddings ordered by `index`; sort defensively.
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        const vectors = sorted.map((row) => row.embedding);
        const dims = vectors[0]?.length ?? 0;
        if (dims === 0) {
          throw new Error('OpenAI embeddings API returned empty vectors.');
        }

        return { vectors, model: json.model ?? model, dimensions: dims };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const isNetwork = /fetch|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message);
        if (!isNetwork || attempt >= maxRetries) {
          if (lastError && isNetwork) throw lastError;
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(message);
        const waitMs = backoffMs(attempt);
        console.warn(
          `[embeddings/openai] Network error "${message}". Retrying in ${Math.round(waitMs / 1000)}s.`,
        );
        await sleep(waitMs);
        attempt += 1;
      }
    }

    throw lastError ?? new Error('OpenAI embeddings API failed after exhausting retries.');
  }
}

function backoffMs(attempt: number): number {
  return Math.min(2_000 * Math.pow(2, attempt), 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}