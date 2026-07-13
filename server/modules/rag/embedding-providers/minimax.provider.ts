/**
 * MiniMax embeddings provider.
 *
 * Endpoint: POST {baseUrl}/v1/embeddings
 * Auth: Bearer key from MINIMAX_API_KEY (or MMX_API_KEY fallback).
 * Body: { model, texts, type: 'db' | 'query' }
 * Response: { vectors: number[][], base_resp: { status_code, status_msg } }
 *
 * Rate-limit handling: HTTP 429 / base_resp 1002/1003/1004 (rate/quota/limit)
 * are retried with capped 15s waits; persistent failures bubble up so the
 * caller can mark the document as `error` instead of staying stuck in
 * `indexing`.
 */

import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
} from './embedding-provider.js';
import { EmbeddingsConfigError } from './embedding-provider.js';

const PROVIDER_ID = 'minimax' as const;
const PROVIDER_LABEL = 'MiniMax';

const MODEL_DIMENSIONS: Record<string, number> = {
  'embo-01': 1024,
  'embo-m1': 1536,
};

export class MiniMaxEmbeddingProvider implements EmbeddingProvider {
  readonly id = PROVIDER_ID;
  readonly label = PROVIDER_LABEL;
  readonly defaultModel = 'embo-01';
  readonly defaultDimensions = 1024;

  getConfig(): EmbeddingProviderConfig {
    const model = (process.env.MINIMAX_EMBEDDING_MODEL as string | undefined) ?? this.defaultModel;
    const baseUrl = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io';
    return {
      providerId: this.id,
      providerLabel: this.label,
      model,
      dimensions: MODEL_DIMENSIONS[model] ?? this.defaultDimensions,
      apiKeyPresent: Boolean(this.resolveApiKey()),
      baseUrl,
      chunkSize: this.parseChunkSize(),
      chunkOverlap: this.parseChunkOverlap(),
      chatModel: process.env.MINIMAX_CHAT_MODEL ?? 'MiniMax-M2.7',
    };
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (input.texts.length === 0) {
      return { vectors: [], model: this.getConfig().model, dimensions: 0 };
    }
    const config = this.getConfig();
    const apiKey = this.resolveApiKey();
    const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/embeddings`;

    const batchSize = Math.max(
      1,
      Number.parseInt(process.env.MINIMAX_EMBEDDING_BATCH_SIZE ?? '8', 10) || 8,
    );
    const interBatchDelayMs = Math.max(
      0,
      Number.parseInt(process.env.MINIMAX_EMBEDDING_BATCH_DELAY_MS ?? '600', 10) || 600,
    );
    const maxRetries = Math.max(
      0,
      Number.parseInt(process.env.MINIMAX_EMBEDDING_RETRIES ?? '5', 10) || 5,
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
        input.isQuery ? 'query' : 'db',
        maxRetries,
      );
      allVectors.push(...vectors);
      lastModel = model;
      lastDims = dimensions;
      if (offset + batchSize < input.texts.length && interBatchDelayMs > 0) {
        await sleep(interBatchDelayMs);
      }
    }

    return { vectors: allVectors, model: lastModel, dimensions: lastDims };
  }

  private resolveApiKey(): string {
    const key = process.env.MINIMAX_API_KEY || process.env.MMX_API_KEY;
    if (!key || key.trim().length === 0) {
      throw new EmbeddingsConfigError(
        'MiniMax API key not configured. Set MINIMAX_API_KEY (or MMX_API_KEY) in your environment.',
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
    type: 'db' | 'query',
    maxRetries: number,
  ): Promise<EmbeddingResponse> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      try {
        const body = JSON.stringify({ model, texts, type });
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        });

        if (response.status === 429 || response.status === 1002) {
          const waitMs = Math.min(backoffMs(attempt), 15_000);
          console.warn(
            `[embeddings/minimax] Rate limited (status ${response.status}). ` +
              `Retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}).`,
          );
          await sleep(waitMs);
          attempt += 1;
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(
            `MiniMax embeddings API failed (${response.status}): ${errorText || response.statusText}`,
          );
        }

        const json = (await response.json()) as {
          vectors?: number[][];
          base_resp?: { status_code?: number; status_msg?: string };
        };

        const statusCode = json.base_resp?.status_code;
        if (statusCode && statusCode !== 0) {
          const transient =
            statusCode === 1002 ||
            statusCode === 1003 ||
            (statusCode === 1004 && /rate|quota|limit/i.test(json.base_resp?.status_msg ?? ''));
          if (transient) {
            const waitMs = Math.min(backoffMs(attempt), 15_000);
            console.warn(
              `[embeddings/minimax] MiniMax returned status_code=${statusCode} (${json.base_resp?.status_msg ?? ''}). ` +
                `Retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}).`,
            );
            lastError = new Error(
              `MiniMax embeddings API error: ${json.base_resp?.status_msg ?? statusCode}`,
            );
            await sleep(waitMs);
            attempt += 1;
            continue;
          }
          throw new Error(
            `MiniMax embeddings API error: ${json.base_resp?.status_msg ?? statusCode}`,
          );
        }

        if (!Array.isArray(json.vectors) || json.vectors.length !== texts.length) {
          throw new Error(
            `MiniMax embeddings API returned unexpected payload (vectors=${json.vectors?.length ?? 'n/a'}, expected ${texts.length})`,
          );
        }

        const dims = json.vectors[0]?.length ?? 0;
        if (dims === 0) {
          throw new Error('MiniMax embeddings API returned empty vectors.');
        }

        return { vectors: json.vectors, model, dimensions: dims };
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
          `[embeddings/minimax] Network error "${message}". Retrying in ${Math.round(waitMs / 1000)}s.`,
        );
        await sleep(waitMs);
        attempt += 1;
      }
    }

    throw lastError ?? new Error('MiniMax embeddings API failed after exhausting retries.');
  }
}

function backoffMs(attempt: number): number {
  const base = 30_000;
  const capped = Math.min(base * Math.pow(2, attempt), 300_000);
  const jitter = capped * 0.1 * (Math.random() * 2 - 1);
  return Math.max(5_000, Math.floor(capped + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}