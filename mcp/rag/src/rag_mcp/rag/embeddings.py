import httpx

from ..config import EMBED_MODEL, EMBED_TIMEOUT, OLLAMA_URL


def embed_one(text: str) -> list[float]:
    """Embed a single string via Ollama's /api/embeddings (legacy `prompt` field)."""
    resp = httpx.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=EMBED_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a list of strings sequentially. One POST per chunk keeps the legacy
    `prompt` contract; switch to a single batched POST only if/when the operator
    accepts that the Ollama version supports the modern `input: [...]` field."""
    return [embed_one(t) for t in texts]