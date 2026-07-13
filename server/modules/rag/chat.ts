/**
 * MiniMax chat completion client used by the RAG Q&A path.
 *
 * Mirrors `mmx text chat` (POST /v1/chat/completions). Streams NDJSON if
 * `stream: true` is passed; otherwise returns a single message.
 *
 * For v1 we use the non-streaming path inside the /api/rag/query endpoint.
 * Streaming can be layered on top later via SSE without changing this client.
 */

import { getEmbeddingsConfig } from './embeddings.js';
import { getEmbeddingProvider } from './embedding-providers/registry.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse = {
  content: string;
  model: string;
  finishReason?: string;
};

function resolveApiKey(): string {
  const key = process.env.MINIMAX_API_KEY || process.env.MMX_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      'MiniMax API key not configured. Set MINIMAX_API_KEY (or MMX_API_KEY) in your environment.',
    );
  }
  return key.trim();
}

export async function chatComplete(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
  const config = getEmbeddingsConfig();
  const apiKey = resolveApiKey();
  // Resolve chat model from (in order): explicit option → MiniMax env
  // (chat is still MiniMax-only) → provider's advertised chatModel.
  // If none resolves, throw — better than silently calling the API with
  // an unknown model.
  const envChatModel = process.env.MINIMAX_CHAT_MODEL;
  const providerChatModel = getEmbeddingProvider().getConfig().chatModel;
  const model = options.model ?? envChatModel ?? providerChatModel;
  if (!model) {
    throw new Error(
      'No chat model configured. Set MINIMAX_CHAT_MODEL in your environment ' +
        '(e.g. MINIMAX_CHAT_MODEL=MiniMax-M3[1m]) or pass options.model explicitly.',
    );
  }

  const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const body = JSON.stringify({
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1024,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`MiniMax chat API failed (${response.status}): ${errorText || response.statusText}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    base_resp?: { status_code?: number; status_msg?: string };
    model?: string;
  };

  if (json.base_resp && json.base_resp.status_code && json.base_resp.status_code !== 0) {
    throw new Error(`MiniMax chat API error: ${json.base_resp.status_msg ?? json.base_resp.status_code}`);
  }

  const content = json.choices?.[0]?.message?.content ?? '';
  const finishReason = json.choices?.[0]?.finish_reason;

  return {
    content,
    model: json.model ?? model ?? 'unknown',
    finishReason,
  };
}
