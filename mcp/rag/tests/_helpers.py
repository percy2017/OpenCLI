"""Test helpers for reloading config under controlled env vars."""

import importlib
import os
from contextlib import contextmanager

# Snapshot env keys touched by config so each test starts from a clean slate.
_CONFIG_ENV_KEYS = (
    "OLLAMA_URL",
    "OLLAMA_BASE_URL",
    "OLLAMA_EMBED_MODEL",
    "OLLAMA_EMBEDDING_MODEL",
    "OLLAMA_EMBED_TIMEOUT",
    "RAG_CHUNK_SIZE",
    "RAG_CHUNK_OVERLAP",
    "RAG_ALLOWED_ROOTS",
    "WORKSPACES_ROOT",
)


@contextmanager
def reloaded_config(env: dict[str, str] | None = None):
    """Apply `env`, reload rag_mcp.config and the modules that captured it,
    and restore the previous env on exit."""
    saved = {k: os.environ.get(k) for k in _CONFIG_ENV_KEYS}
    for k in _CONFIG_ENV_KEYS:
        os.environ.pop(k, None)
    if env:
        os.environ.update(env)

    from rag_mcp import config as cfg
    import rag_mcp.rag.policy as policy
    import rag_mcp.rag.embeddings as embeddings
    import rag_mcp.rag.ingest as ingest
    import rag_mcp.rag.retrieve as retrieve

    importlib.reload(cfg)
    importlib.reload(policy)
    importlib.reload(embeddings)
    importlib.reload(ingest)
    importlib.reload(retrieve)

    try:
        yield cfg, policy, embeddings, ingest, retrieve
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(cfg)
        importlib.reload(policy)
        importlib.reload(embeddings)
        importlib.reload(ingest)
        importlib.reload(retrieve)