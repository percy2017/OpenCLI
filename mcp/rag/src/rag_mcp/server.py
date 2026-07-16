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
    """Best-effort .env loader so the MCP works regardless of how it was
    launched.

    When invoked via `run-server.sh`, .env is already in os.environ and this
    is a no-op. When invoked directly (`python -m rag_mcp.server` from a
    Claude Code / other MCP client config that doesn't run the wrapper), this
    finds the canonical OpenCLI .env and merges any missing vars into
    os.environ without overriding what the caller already set.

    Search order:
      1. `$OPENCLI_ENV` (lets operators point at a different .env)
      2. `/opt/opencli/.env` (the default OpenCLI install)
      3. `~/.opencli/.env` (per-user override)
    """
    candidates = [
        os.environ.get("OPENCLI_ENV"),
        "/opt/opencli/.env",
        str(Path.home() / ".opencli" / ".env"),
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
            logging.getLogger(__name__).warning(
                "Could not read %s for env loading: %s", path, exc
            )
            continue
        if loaded:
            logging.getLogger(__name__).info(
                "Loaded %d env var(s) from %s (existing values kept)", loaded, path
            )
        return  # use only the first .env found


# MUST run before any package import that reads env-derived constants.
_load_dotenv()

from mcp.server.fastmcp import FastMCP  # noqa: E402

from .tools import register_tools  # noqa: E402

mcp = FastMCP("rag_mcp")
register_tools(mcp)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()