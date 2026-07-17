#!/usr/bin/env bash
# Setup helper for the OpenCLI voice transcription (whisper.cpp) feature.
#
# - Builds whisper.cpp if no binary is found.
# - Downloads a ggml-*.bin model into server/whisper/models/.
#
# This script is normally spawned automatically on first backend boot by
# server/modules/first-run/whisper-installer.ts (fire-and-forget). Run it
# manually only when you want to relocate the install, retry after a
# failed auto-install, or pin a specific model.
#
# The script emits `[stage: <name>] <optional payload>` lines on stdout so
# the Node wrapper can mirror progress to the chat composer UI. Do not
# change those markers without updating whisper-installer.ts.
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

echo "[stage: detecting-binary] probing for an existing whisper.cpp install..."

# 1. Binary
if command -v whisper-cli >/dev/null 2>&1; then
  echo "[stage: detecting-binary] found whisper-cli on PATH: $(command -v whisper-cli)"
elif command -v main >/dev/null 2>&1 && [ -x "$(command -v main)" ]; then
  echo "[stage: detecting-binary] found legacy 'main' on PATH: $(command -v main)"
elif [ -x "${WHISPER_REPO}/build/bin/whisper-cli" ] || [ -x "${WHISPER_REPO}/build/bin/main" ]; then
  echo "[stage: detecting-binary] using built binary in ${WHISPER_REPO}/build/bin/"
else
  echo "[stage: detecting-binary] no binary found. Building whisper.cpp..."
  if ! command -v cmake >/dev/null 2>&1; then
    echo "[error] cmake is required to build whisper.cpp. Install it (apt install cmake / brew install cmake) and rerun." >&2
    exit 1
  fi
  if [ ! -d "${WHISPER_REPO}/.git" ] && [ ! -f "${WHISPER_REPO}/CMakeLists.txt" ]; then
    echo "[stage: cloning] cloning whisper.cpp from github.com/ggerganov/whisper.cpp (this can take ~15 s)…"
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_REPO}"
  fi
  echo "[stage: building] compiling whisper.cpp with cmake --build build -j (1-3 min on first run)…"
  ( cd "${WHISPER_REPO}" && cmake -B build >/dev/null && cmake --build build --config Release -j )
  echo "[stage: detecting-binary] whisper-cli built at ${WHISPER_REPO}/build/bin/whisper-cli"
fi

# 2. Model — atomic .tmp + mv download protects against torn downloads if
# the server crashes / network drops mid-transfer.
if [ ! -f "${MODELS_DIR}/${MODEL}" ]; then
  echo "[stage: downloading-model] Downloading ${MODEL} (~140 MB) from huggingface.co/ggerganov/whisper.cpp…"
  BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
  TMP_FILE="${MODELS_DIR}/${MODEL}.tmp"
  if command -v curl >/dev/null 2>&1; then
    if ! curl -L --fail --output "${TMP_FILE}" "${BASE_URL}/${MODEL}"; then
      echo "[stage: failed] curl download failed (network? DNS?). Run \\`bash server/whisper/setup.sh\\` to retry." >&2
      rm -f "${TMP_FILE}"
      exit 1
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget -O "${TMP_FILE}" "${BASE_URL}/${MODEL}"; then
      echo "[stage: failed] wget download failed (network? DNS?). Run \\`bash server/whisper/setup.sh\\` to retry." >&2
      rm -f "${TMP_FILE}"
      exit 1
    fi
  else
    echo "[error] curl or wget is required to download the model." >&2
    exit 1
  fi
  mv "${TMP_FILE}" "${MODELS_DIR}/${MODEL}"
  echo "[stage: verifying-model] Model saved at ${MODELS_DIR}/${MODEL}."
fi

echo "[stage: done] Whisper ready. Model at: ${MODELS_DIR}/${MODEL}"
echo "[whisper] To override the auto-detected binary path, set WHISPER_BINARY in your .env:"
echo "    WHISPER_BINARY=$(command -v whisper-cli || echo ${WHISPER_REPO}/build/bin/whisper-cli)"
echo "    WHISPER_MODEL=${MODELS_DIR}/${MODEL}"
echo "    WHISPER_LANGUAGE=auto"
echo "    WHISPER_ENABLED=true"
