import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
CHROMA_DIR = DATA_DIR / "chroma"

COLLECTION_NAME = "rag_mcp"


def _env(name: str, fallback: str | None = None) -> str | None:
    """Reads a name from env, falling back to a second name when the first
    is unset. Lets callers stay agnostic about which name the host used
    (e.g. an OpenCLI shell exports WORKSPACES_ROOT; a Claude Code MCP
    invocation may export RAG_ALLOWED_ROOTS)."""
    return os.environ.get(name) or (os.environ.get(fallback) if fallback else None) or None


# Embedding / Ollama — fall back to the names the OpenCLI backend uses.
EMBED_MODEL = (
    _env("OLLAMA_EMBED_MODEL", "OLLAMA_EMBEDDING_MODEL")
    or "mxbai-embed-large:latest"
)
OLLAMA_URL = _env("OLLAMA_URL", "OLLAMA_BASE_URL") or "http://127.0.0.1:11434"
EMBED_TIMEOUT = float(_env("OLLAMA_EMBED_TIMEOUT") or "60.0")
# Max concurrent in-flight embedding requests during ingest. Ollama serializes
# the actual model forward pass on its end, so this only parallelizes the
# HTTP round-trip — raising it beyond the model's effective throughput is a
# no-op but doesn't hurt.
EMBED_CONCURRENCY = max(1, int(_env("RAG_EMBED_CONCURRENCY") or "4"))

# Known embedding dimensions by model. Surfaces the dim count in rag_status
# so agents know the vector space before searching. Unknown models fall back
# to None and the caller should inspect the first returned vector if needed.
KNOWN_DIMENSIONS: dict[str, int] = {
    "mxbai-embed-large": 1024,
    "mxbai-embed-large:latest": 1024,
    "nomic-embed-text": 768,
    "nomic-embed-text:latest": 768,
    "all-minilm": 384,
    "all-minilm:latest": 384,
    "snowflake-arctic-embed": 1024,
    "snowflake-arctic-embed:335m": 1024,
    "snowflake-arctic-embed:137m": 768,
    "snowflake-arctic-embed:33m": 384,
}

# Chunking — fall back to backend names too.
CHUNK_SIZE = int(_env("RAG_CHUNK_SIZE") or "512")
CHUNK_OVERLAP = int(_env("RAG_CHUNK_OVERLAP") or "50")

# Path policy — colon-separated absolute roots. The MCP keeps its own name
# (`RAG_ALLOWED_ROOTS`) as the source of truth, and additionally honors the
# OpenCLI shell's `WORKSPACES_ROOT` as a fallback so a direct invocation
# (Claude Code `--mcp-config` calling `python -m rag_mcp.server` without our
# wrapper) still ends up with a sensible allowlist.
_allowed_roots_raw = _env("RAG_ALLOWED_ROOTS", "WORKSPACES_ROOT") or ""
ALLOWED_ROOTS: tuple[Path, ...] = tuple(
    Path(p).resolve()
    for p in _allowed_roots_raw.split(os.pathsep)
    if p.strip()
)

if not ALLOWED_ROOTS:
    # Last-resort default so the MCP doesn't refuse every ingest out of the
    # box when launched without env wiring. `~/.cloudcli` is where OpenCLI
    # stores per-user data (assets, sessions, the KB store); ingesting from
    # the user's home directory would be too permissive for a default.
    fallback = Path.home() / ".cloudcli"
    ALLOWED_ROOTS = (fallback.resolve(),)
    log.warning(
        "RAG_ALLOWED_ROOTS (and WORKSPACES_ROOT) are unset; defaulting to %s. "
        "Set RAG_ALLOWED_ROOTS in .env to a colon-separated list of absolute "
        "paths to allow ingestion from other locations.",
        ALLOWED_ROOTS[0],
    )

SUPPORTED_EXTS = {".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv"}

DATA_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)