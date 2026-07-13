# RAG module

Document indexing + semantic search for the knowledge base.

Pipeline: **upload → parse → chunk → embed → store**, then **query → embed → cosine similarity → chat completion**.

## Embedding providers

The provider is selected by `RAG_EMBEDDING_PROVIDER` (default `ollama`). Each provider has the same `embed({ texts, isQuery })` interface; the orchestrator does not know or care which one is active.

| Provider | `RAG_EMBEDDING_PROVIDER` | Auth | Endpoint | Default model | Dims |
| --- | --- | --- | --- | --- | --- |
| Ollama (local) | `ollama` | none | `${OLLAMA_BASE_URL}/api/embed` | `mxbai-embed-large` | 1024 |
| MiniMax | `minimax` | `MINIMAX_API_KEY` (or `MMX_API_KEY`) | `${MINIMAX_BASE_URL}/v1/embeddings` | `embo-01` | 1024 |
| OpenAI | `openai` | `OPENAI_API_KEY` | `${OPENAI_BASE_URL}/v1/embeddings` | `text-embedding-3-small` | 1536 |

## Switching providers

Set the env var in `.env` and restart the backend. Existing chunks stay valid for their original provider; the orchestrator always filters `WHERE provider = ? AND dimensions = ?` on query, so cross-provider vectors are never compared (different dims would produce nonsense similarity).

**Per-document re-index is required** if you switch providers — existing chunks keep their old `provider` value and won't be returned by queries against the new provider.

## Common issues

### "Ollama responded 404"

The daemon is reachable but the model isn't installed:

```bash
ollama pull mxbai-embed-large
```

### "rate limit exceeded (RPM)" / `1002`

Your MiniMax plan is throttled. Either:

- Switch to Ollama (free, local, no limit) — set `RAG_EMBEDDING_PROVIDER=ollama`.
- Wait for the quota window to reset.
- Upgrade the plan.

### Document stuck in "Indexing"

The pipeline crashed mid-flight (e.g. server restart). Two recovery options:

- Restart the backend: `runMigrations()` reap runs at boot and marks anything in `indexing` older than 5 minutes as `error`.
- Manual: `POST /api/rag/reap-stuck` reaps immediately. Then click **Reindex** on the document.

## File layout

```
modules/rag/
  embedding-providers/
    embedding-provider.ts     # interface + EmbeddingsConfigError
    minimax.provider.ts       # MiniMax impl (existing rate-limit handling)
    ollama.provider.ts        # Ollama impl (local, /api/embed)
    openai.provider.ts        # OpenAI impl (text-embedding-3-small)
    registry.ts               # RAG_EMBEDDING_PROVIDER dispatch
  embeddings.ts               # legacy shim (re-exports registry symbols)
  parser.ts                   # DOCX/XLSX/PPTX/text → text extraction
  chunker.ts                  # text → chunks (size + overlap)
  chat.ts                     # chat completion (MiniMax, independent of embeddings)
  store.ts                    # SQLite repositories (rag_documents, rag_chunks)
  rag.service.ts              # upload / index / query / delete orchestration
  rag.routes.ts               # HTTP API
  types.ts                    # shared types
```