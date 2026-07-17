#!/usr/bin/env bash
# Setup helper for the OpenCLI voice transcription (whisper.cpp) feature.
#
# - Builds whisper.cpp if no binary is found.
# - Downloads a ggml-*.bin model into server/whisper/models/.
#
# Usage:
#   bash server/whisper/setup.sh                # default ggml-base.bin
#   bash server/whisper/setup.sh ggml-small.bin # download a specific model
#
# Override WHISPER_REPO or MODELS_DIR to relocate the install.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${MODELS_DIR:-${SCRIPT_DIR}/models}"
WHISPER_REPO="${WHISPER_REPO:-${SCRIPT_DIR}/build}"
MODEL="${1:-ggml-base.bin}"

mkdir -p "${MODELS_DIR}"

# 1. Binary
if command -v whisper-cli >/dev/null 2>&1; then
  echo "[whisper] found whisper-cli on PATH: $(command -v whisper-cli)"
elif command -v main >/dev/null 2>&1 && [ -x "$(command -v main)" ]; then
  echo "[whisper] found 'main' binary on PATH (legacy whisper.cpp)"
elif [ -x "${WHISPER_REPO}/build/bin/whisper-cli" ] || [ -x "${WHISPER_REPO}/build/bin/main" ]; then
  echo "[whisper] using built binary in ${WHISPER_REPO}/build/bin/"
else
  echo "[whisper] no binary found. Building whisper.cpp..."
  if ! command -v cmake >/dev/null 2>&1; then
    echo "[error] cmake is required to build whisper.cpp. Install it (apt install cmake / brew install cmake) and rerun." >&2
    exit 1
  fi
  if [ ! -d "${WHISPER_REPO}/.git" ] && [ ! -f "${WHISPER_REPO}/CMakeLists.txt" ]; then
    echo "[whisper] cloning whisper.cpp repository..."
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_REPO}"
  fi
  ( cd "${WHISPER_REPO}" && cmake -B build && cmake --build build --config Release -j )
fi

# 2. Model
if [ ! -f "${MODELS_DIR}/${MODEL}" ]; then
  echo "[whisper] downloading model ${MODEL}..."
  # Mirror URLs the whisper.cpp project publishes.
  BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --output "${MODELS_DIR}/${MODEL}" "${BASE_URL}/${MODEL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "${MODELS_DIR}/${MODEL}" "${BASE_URL}/${MODEL}"
  else
    echo "[error] curl or wget is required to download the model." >&2
    exit 1
  fi
fi

echo "[whisper] ready. Model at: ${MODELS_DIR}/${MODEL}"
echo "[whisper] Add this to your .env:"
echo "    WHISPER_BINARY=\$(command -v whisper-cli || echo ${WHISPER_REPO}/build/bin/whisper-cli)"
echo "    WHISPER_MODEL=${MODELS_DIR}/${MODEL}"
echo "    WHISPER_LANGUAGE=auto"
echo "    WHISPER_ENABLED=true"
