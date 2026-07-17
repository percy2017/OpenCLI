# server/whisper — Voice → Whisper.cpp transcription

Backs the chat-composer microphone button. Records audio in the browser via
`MediaRecorder`, uploads it to `POST /api/whisper/transcribe`, and returns
plain text that the composer then sends to the LLM via the existing
`chat.send` flow.

## Endpoints (mounted under `/api/whisper`, authenticated like `/api/tts`)

* `GET /api/whisper/config` — `{ enabled, available, language, model, timeoutMs }`.
  Used by the client to hide the mic button when whisper is disabled or missing.
* `POST /api/whisper/transcribe` — `multipart/form-data` with `audio` field.
  Returns `{ success: true, text: "..." }`. Errors map to 503 / 422 / 413 / 502.

## Pipeline per request

```
audio/webm (or mp4) → ffmpeg → 16 kHz mono PCM WAV → whisper.cpp → .txt
```

whisper.cpp is invoked with `--no-timestamps --print-progress false` and an
`-of <prefix>` so its plain-text output lands at `<prefix>.txt`, which we
read back. `whisper-cli` is preferred; `main` (legacy) and `whisper` are also
probed.

## Requirements

* **ffmpeg** on PATH — used for audio conversion.
* **whisper.cpp** binary (≥1.5) — `whisper-cli`, `whisper`, or legacy `main`.
* A **ggml-*.bin** model file. `ggml-base.bin` (~140 MB) is the
  recommended starting point.

Run `bash server/whisper/setup.sh` to build whisper.cpp from source and
download a model. It will print the exact `.env` lines you need to add.

## Environment variables

| Variable                 | Default                | Notes                                                            |
|--------------------------|------------------------|------------------------------------------------------------------|
| `WHISPER_ENABLED`        | `true`                 | Set `false` to disable the mic button entirely.                  |
| `WHISPER_BINARY`         | auto-detect            | Absolute path to `whisper-cli`. If unset, common names are tried. |
| `WHISPER_MODEL`          | `server/whisper/models/ggml-base.bin` | Path or filename inside `models/`.             |
| `WHISPER_LANGUAGE`       | `auto`                 | `auto`, `es`, `en`, … — passed via `-l` to whisper.cpp.           |
| `WHISPER_TIMEOUT_MS`     | `60000`                | Hard timeout for the whisper.cpp call.                          |
| `WHISPER_MAX_FILE_SIZE_MB` | `25`                 | Multer limit on the upload size.                                 |

## Quick smoke test

```bash
# From the OpenCLI root:
bash server/whisper/setup.sh
WHISPER_ENABLED=true npm run server:dev

# In the UI: open a chat, click the mic icon, speak, click again. The
# transcript replaces the textarea and the message is sent to the LLM.
```
