---
name: python-mcp-server-env-bootstrap
description: Fix and prevent the "server rejects everything with an unhelpful error because env vars never reached the Python process" pattern. For Python MCP servers whose launcher script sources `.env` but the MCP client invokes `python -m <server>` directly, capture the canonical `.env` into os.environ in the server entrypoint before any package import, fall back to safe defaults with a loud warning, and make error messages actionable.
source: auto-skill
extracted_at: '2026-07-15T08:02:18.473Z'
---

# Bootstrap env vars in a Python MCP server entrypoint

Use this when a Python FastMCP / MCP server:
- reads `os.environ.get(...)` at module import time (constants captured into module globals)
- has a launcher script (`run-server.sh`, `start.sh`) that sources `.env` and translates names
- is sometimes invoked directly via `python -m <package>.server` from an MCP client config (Claude Code `--mcp-config`, etc.) that **does not** run the launcher
- surfaces a vague error like `"X is not configured"` for every request, even though the operator set `X` in `.env`

The root cause is always the same: env vars set in `.env` were never exported into the subprocess. The launcher script is bypassed. Module-level `os.environ.get(...)` reads from an empty environment.

## The pattern: defense in depth at the entrypoint

Apply three layers. Each catches a different failure mode. They're cheap; do all three.

### Layer 1 — auto-load `.env` in `server.py` before package imports

```python
# server.py  — entrypoint, runs as `python -m <package>.server`
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,
)


def _load_dotenv() -> None:
    """Best-effort .env loader so the MCP works regardless of how it was launched.

    When invoked via run-server.sh, .env is already in os.environ and this is a
    no-op. When invoked directly (python -m server from an MCP client config
    that doesn't run the wrapper), this finds the canonical .env and merges
    missing vars into os.environ without overriding caller-set values.
    """
    candidates = [
        os.environ.get("OPENCLI_ENV"),       # operator override
        "/opt/opencli/.env",                 # canonical install path
        str(Path.home() / ".cloudcli" / ".env"),  # per-user override
    ]
    for path in candidates:
        if not path or not os.path.isfile(path):
            continue
        loaded = 0
        try:
            with open(path, encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
                        loaded += 1
        except OSError as exc:
            logging.getLogger(__name__).warning("Could not read %s: %s", path, exc)
            continue
        if loaded:
            logging.getLogger(__name__).info(
                "Loaded %d env var(s) from %s (existing values kept)", loaded, path
            )
        return  # use only the first .env found


# MUST run before any package import that reads env-derived constants.
_load_dotenv()

# Imports come AFTER the bootstrap so module-level constants see the right env.
from mcp.server.fastmcp import FastMCP  # noqa: E402
from .tools import register_tools         # noqa: E402
# ...
```

Two non-negotiables:
- `os.environ.setdefault`-style merge: **caller-set vars win**. The launcher script's translations and explicit MCP-client env overrides must not be clobbered.
- `_load_dotenv()` runs **before** any `from .x import y` that captures env at import time. Module-level constants like `ALLOWED_ROOTS = (Path(p).resolve() for p in env.split(":"))` are evaluated once at import and never re-read.

### Layer 2 — fallback default with a loud warning in `config.py`

Even with `_load_dotenv`, the operator might have an empty `.env` or a malformed path. Add a last-resort default to the most security-relevant config (path allowlists, API keys, model names):

```python
# config.py
import logging
log = logging.getLogger(__name__)

_allowed_roots_raw = _env("RAG_ALLOWED_ROOTS", "WORKSPACES_ROOT") or ""
ALLOWED_ROOTS: tuple[Path, ...] = tuple(
    Path(p).resolve() for p in _allowed_roots_raw.split(os.pathsep) if p.strip()
)

if not ALLOWED_ROOTS:
    # Last-resort default so the MCP doesn't refuse every ingest out of the
    # box when launched without env wiring. ~/.cloudcli is the per-user data
    # dir for this product; falling back to $HOME would be too permissive.
    fallback = Path.home() / ".cloudcli"
    ALLOWED_ROOTS = (fallback.resolve(),)
    log.warning(
        "RAG_ALLOWED_ROOTS (and WORKSPACES_ROOT) are unset; defaulting to %s. "
        "Set RAG_ALLOWED_ROOTS in .env to a colon-separated list of absolute "
        "paths to allow ingestion from other locations.",
        ALLOWED_ROOTS[0],
    )
```

The warning is the point — operators see it in stderr and learn what to configure. Silent defaults are worse than loud ones for security-relevant config.

### Layer 3 — actionable error messages in the validator

The error must tell the operator **exactly what to set**, not just that something is wrong:

```python
# policy.py
def validate_path(p: Path) -> Path:
    resolved = _real(p)
    if not _RESOLVED_ROOTS:
        raise PathNotAllowedError(
            "RAG_ALLOWED_ROOTS is not configured and the fallback default "
            "could not be resolved. Set RAG_ALLOWED_ROOTS in .env (or in the "
            "MCP client env) to a colon-separated list of absolute paths, "
            "e.g. `RAG_ALLOWED_ROOTS=/root/.cloudcli/assets:/srv/docs`."
        )
    for root in _RESOLVED_ROOTS:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise PathNotAllowedError(
        f"Path {resolved} is not within any allowed root: "
        f"{[str(r) for r in _RESOLVED_ROOTS]}. "
        f"Add the parent directory to RAG_ALLOWED_ROOTS (colon-separated) "
        f"and restart the MCP to allow this file."
    )
```

Bad: `"Path not allowed"` — operator has to read code to find the config var.
Good: names the env var, shows the exact syntax, shows the current allowed roots so they can see what's missing.

## Reproduce the bug pattern before fixing

Always reproduce first. The shell snippet that simulates "MCP client invoked directly without wrapper":

```bash
# Strip every var the launcher would normally set, then run the server's
# import path directly.
unset RAG_ALLOWED_ROOTS WORKSPACES_ROOT OLLAMA_URL OLLAMA_EMBEDDING_MODEL
python -c "
import os
for k in ('RAG_ALLOWED_ROOTS','WORKSPACES_ROOT','OLLAMA_URL','OLLAMA_BASE_URL',
         'OLLAMA_EMBED_MODEL','OLLAMA_EMBEDDING_MODEL','OLLAMA_EMBED_TIMEOUT',
         'RAG_CHUNK_SIZE','RAG_CHUNK_OVERLAP'):
    os.environ.pop(k, None)
from rag_mcp.rag.policy import validate_path, PathNotAllowedError
from pathlib import Path
try:
    validate_path(Path('/root/.cloudcli/assets/test.pdf'))
    print('OK')
except PathNotAllowedError as e:
    print('REJECTED:', e)
"
```

If this prints `REJECTED: ... is not configured`, you've reproduced the bug. The fix above makes it print `OK`.

## Tests that need to change

Two existing tests will break after the fallback default lands:

1. **`test_defaults_when_no_env_set`** typically asserts `ALLOWED_ROOTS == ()`. After the fix, it should assert `len(ALLOWED_ROOTS) == 1` and `ALLOWED_ROOTS[0] == Path.home() / ".cloudcli"`.

2. **`test_unset_roots_rejects_all`** typically asserts the error message contains `"RAG_ALLOWED_ROOTS is not configured"`. That branch in `policy.py` is now unreachable (because the fallback guarantees `ALLOWED_ROOTS` is non-empty). Rename the test to `test_unset_roots_falls_back_to_<dir>` and assert that paths **outside** the fallback are rejected by the standard "not within any allowed root" check.

Add one new test that proves the fix:

```python
def test_server_module_loads_dotenv_at_import(self):
    """server.py must bootstrap .env before any package import reads env."""
    import importlib, os, sys
    # Strip every var the launcher would normally set
    for k in ("RAG_ALLOWED_ROOTS", "WORKSPACES_ROOT", "OLLAMA_URL",
             "OLLAMA_EMBEDDING_MODEL", "OPENCLI_ENV"):
        os.environ.pop(k, None)
    # Force a fresh import
    sys.modules.pop("rag_mcp.server", None)
    import rag_mcp.server  # noqa: F401
    from rag_mcp import config
    # After import, ALLOWED_ROOTS is non-empty (loaded from .env or fallback)
    assert config.ALLOWED_ROOTS, "server.py failed to bootstrap env"
```

## Verification

After the three layers:

```bash
# 1. Direct invocation works (the bug case)
unset RAG_ALLOWED_ROOTS WORKSPACES_ROOT
python -c "from rag_mcp.rag.policy import validate_path; \
           from pathlib import Path; \
           validate_path(Path('/root/.cloudcli/assets/test.pdf'))"

# 2. Wrapper invocation still works (no double-loading)
bash -x ./run-server.sh 2>&1 | grep -i "loaded"

# 3. Caller-set env wins over .env (no surprise overrides)
RAG_ALLOWED_ROOTS=/custom/path python -c "from rag_mcp import config; \
                                        print(config.ALLOWED_ROOTS)"
# expect: (PosixPath('/custom/path'),)  — not the .env value, not the fallback
```

## When NOT to use this skill

- The MCP server reads env on every call (not at import). Use `pydantic-settings` or a runtime config layer instead — module-level constants aren't the problem.
- The launcher script is the only documented invocation path and operators always use it. Layer 1+2 are still worth it for resilience, but you can skip if the deployment is single-tenant and tightly controlled.
- The failure mode is "wrong values" not "missing values". That's a configuration bug, not an env-loading bug — fix `.env`, don't add bootstrap code.

## Related

- **`python-mcp-module-tuneup`** — covers the orthogonal problem of enriching an existing module's tool surface (descriptions, status tools, parallel batch work, tests). Apply both skills to the same module; they don't conflict.
