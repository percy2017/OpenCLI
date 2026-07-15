from concurrent.futures import ThreadPoolExecutor

import httpx

from ..config import EMBED_CONCURRENCY, EMBED_MODEL, EMBED_TIMEOUT, OLLAMA_URL


def embed_one(text: str) -> list[float]:
    """Embed a single string via Ollama's /api/embeddings (legacy `prompt` field).
    Synchronous; tests and one-off callers use this directly."""
    resp = httpx.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=EMBED_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a list of strings, fanning out across `EMBED_CONCURRENCY` workers
    using a thread pool.

    Pure-thread implementation (no asyncio) so this works when called from
    inside an already-running event loop — the FastMCP server runs tools
    inside its own asyncio loop, and `asyncio.run()` from there would raise
    "cannot be called from a running event loop". ThreadPoolExecutor sidesteps
    that entirely while keeping the parallelization win: an N-chunk file
    finishes in roughly ceil(N / CONCURRENCY) HTTP round-trips instead of N.

    Each request still hits Ollama's legacy `/api/embeddings` (single `prompt`
    field) — the parallelization is at the HTTP layer, not the API contract.
    Ollama serializes the actual model forward pass on its side, so the speedup
    is bounded by the model's throughput, not the client concurrency.
    """
    if not texts:
        return []
    # `pool.map` preserves input order in the output, so result[i] matches
    # texts[i] regardless of completion order.
    with ThreadPoolExecutor(max_workers=EMBED_CONCURRENCY) as pool:
        return list(pool.map(embed_one, texts))