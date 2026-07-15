#!/usr/bin/env bash
# Launcher for the RAG MCP server.
#
# Reads /opt/opencli/.env so the MCP picks up the same Ollama config the rest
# of OpenCLI uses, then translates the names the backend uses into the names
# rag_mcp.config.py expects. Avoids touching the MCP source.
#
# Env overrides: any value already set in the caller's environment wins.
#
# Usage:
#   ./run-server.sh                  # uses /opt/opencli/.env
#   OPENCLI_ENV=/path/to/.env ./run-server.sh
#
# Exit codes follow set -e: any failed source / python -m aborts the launch.

set -euo pipefail

# Locate the .env file the backend uses.
OPENCLI_ENV="${OPENCLI_ENV:-/opt/opencli/.env}"
if [[ ! -f "$OPENCLI_ENV" ]]; then
  echo "run-server.sh: $OPENCLI_ENV not found" >&2
  exit 1
fi

# Source the backend's .env in a subshell-friendly way. Lines like
#   KEY=value
# become exported; comments and blank lines are skipped.
set -a
# shellcheck disable=SC1090
source "$OPENCLI_ENV"
set +a

# Translate backend names -> MCP names. Defaults match rag_mcp.config.py.
export OLLAMA_URL="${OLLAMA_URL:-${OLLAMA_BASE_URL:-http://127.0.0.1:11434}}"
export OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-${OLLAMA_EMBEDDING_MODEL:-mxbai-embed-large}}"
export RAG_CHUNK_SIZE="${RAG_CHUNK_SIZE:-512}"
export RAG_CHUNK_OVERLAP="${RAG_CHUNK_OVERLAP:-50}"

# WORKSPACES_ROOT lives in /opt/opencli/.env. If RAG_ALLOWED_ROOTS is not
# already set in the caller's environment, default it to that value so the
# MCP inherits the same security boundary as the rest of OpenCLI.
#
# WARNING: WORKSPACES_ROOT=/ pins the MCP to the filesystem root — every
# path is "allowed" and the policy check becomes a no-op. To re-enable
# containment, set RAG_ALLOWED_ROOTS explicitly in the MCP client config
# or pin WORKSPACES_ROOT to a non-system path in .env.
if [[ -z "${RAG_ALLOWED_ROOTS:-}" && -n "${WORKSPACES_ROOT:-}" ]]; then
  export RAG_ALLOWED_ROOTS="$WORKSPACES_ROOT"
fi

# Stay in the MCP dir so the `src/` layout resolves.
cd "$(dirname "$0")"

# `rag_mcp` lives under src/, which is the configured package layout
# (pyproject.toml [tool.hatch.build.targets.wheel] packages = ["src/rag_mcp"]).
# Add src/ to PYTHONPATH so `python -m rag_mcp.server` resolves without
# needing an editable install.
export PYTHONPATH="${PYTHONPATH:-}:$(pwd)/src"

exec ./.venv/bin/python -m rag_mcp.server