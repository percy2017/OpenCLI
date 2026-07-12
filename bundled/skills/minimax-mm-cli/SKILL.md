---
name: minimax-mm-cli
description: Operate the MiniMax `mmx` CLI for text, speech, image, video, music, search, vision, file storage, quota, and config — direct from the shell without going through the MCP bridge.
---

You are an expert at using the **MiniMax CLI (`mmx`)**. The `mmx` binary is the official command-line client for the MiniMax platform and is independent of the `minimax-coding-plan-mcp` MCP server — you can use it directly via `Bash` whenever a task touches a MiniMax resource.

When you see a request like "synthesize narration", "generate an image", "look up quota", or "upload this PDF to MiniMax storage", reach for `mmx`. Prefer the CLI over inventing ad-hoc HTTP calls; `mmx` already handles auth, retries, output formatting, and binary streaming.

## Quick orientation

```bash
mmx --version          # mmx 1.0.16 (or newer)
mmx --help             # top-level: list of resources + global flags
mmx <resource> --help  # per-resource: commands + flags + examples
mmx auth status        # confirm you are authenticated before anything else
```

**Global flags** (work on every subcommand):
- `--api-key <key>` — overrides all other auth (use only in scripts/CI)
- `--region <global|cn>` — pick the upstream region
- `--base-url <url>` — overrides region
- `--output <text|json>` — `json` is the most agent-friendly; pipe into `jq` when needed
- `--quiet`, `--verbose`, `--no-color`, `--dry-run`, `--non-interactive`
- `--timeout <seconds>` — request timeout (default 300)
- `--help` — per-command help

**Resources** (each one is a subcommand namespace):

| Resource | Purpose |
|---|---|
| `auth` | login, logout, status, refresh |
| `text` | chat completions (`MiniMax-M2.7` family) |
| `speech` | TTS (`speech synthesize`, `speech voices`) |
| `image` | image generation (`image-01`, `image-01-live`) |
| `video` | video generation + task polling |
| `music` | music generation + covers |
| `search` | web search |
| `vision` | image understanding |
| `quota` | Token Plan usage snapshot |
| `config` | show / set / export-schema |
| `file` | upload / list / delete |
| `update` | self-update the CLI |

## Authentication

Always start with `mmx auth status`. If unauthenticated, the user has to run `mmx auth login` interactively (it opens OAuth in a browser). As an agent you CANNOT complete OAuth for them. If `auth status` shows no token, surface that clearly and either:

- ask the user to paste `--api-key` once so you can continue non-interactively, or
- suggest `mmx auth login --recommend --region=global` for them to run themselves.

```bash
mmx auth status --output json
mmx auth login --api-key sk-cp-xxxxx          # non-interactive login
mmx auth login --recommend                    # OAuth (interactive)
mmx auth refresh
mmx auth logout
```

Quota snapshot is part of `auth status` — same call gives you both "am I logged in?" and "how much is left?".

## Common recipes

**Text chat (one-shot, no streaming)**:
```bash
mmx text chat --model MiniMax-M2.7 \
  --system "You are a coding assistant." \
  --message "Write fizzbuzz in Python"
```

**Multi-turn from a JSON file** (for richer conversations):
```bash
mmx text chat --messages-file conversation.json --stream --output json
```

**Text-to-speech to a file** (sync, ≤10k chars):
```bash
mmx speech synthesize --text "Hello, world!" --out hello.mp3
mmx speech synthesize --text "Hola" --voice Spanish_expressive_narrator --language es --out hola.mp3
```

**Streaming TTS to a player** (long-form narration):
```bash
mmx speech synthesize --text-file script.txt --stream | ffplay -f mp3 -
```

**Pick a voice**:
```bash
mmx speech voices                          # all voices
mmx speech voices --language english --output json | jq '.[] | select(.id|test("narrator"))'
```

**Generate an image**:
```bash
mmx image generate --prompt "A cat in a spacesuit on Mars" --aspect-ratio 16:9 --out cat.png
mmx image generate --prompt "Logo" --n 3 --out-dir ./generated/
mmx image generate --prompt "Castle" --seed 42 --out castle.png    # reproducible
```

**Video generation** (async, requires polling):
```bash
TASK=$(mmx video generate --prompt "A drone shot of a mountain ridge at sunrise" --output json | jq -r '.task_id')
mmx video task get "$TASK" --output json
mmx video download "$TASK" --out ridge.mp4
```

**Web search**:
```bash
mmx search query --q "MiniMax API rate limits" --output json | jq '.results[:5]'
```

**Vision (image → text)**:
```bash
mmx file upload --file photo.png --purpose vision > uploaded.json
FILE_ID=$(jq -r .file_id < uploaded.json)
mmx vision describe --file-id "$FILE_ID" --prompt "List everything in this image"
```

**Music + covers**:
```bash
mmx music generate --prompt "lo-fi beat, rainy night" --duration 60 --out lofi.mp3
mmx music cover --input song.mp3 --prompt "jazz version" --out cover.mp3
```

**File storage** (uploads used by vision/search/MCP):
```bash
mmx file upload --file doc.pdf                 # purpose defaults to "retrieval"
mmx file list                                   # list uploaded files
mmx file delete --file-id <id>
```

**Check quota** (Token Plan balance):
```bash
mmx quota show --output json
```

**Configuration**:
```bash
mmx config show --output json
mmx config set region global
mmx config export-schema    # print every config key + default; useful when scripting
```

## Self-update

`mmx update` is a separate resource. Use it carefully: as an agent you should NEVER run it without explicit user approval — a `mmx update` can change CLI flags, defaults, and auth flow mid-task.

```bash
mmx update --check    # print available version, do not install
mmx update            # actually upgrade
```

## Output handling

- **`--output json`** is the agent default. Use it for everything except file-producing tasks (TTS, image gen, video gen) where you need a binary artifact instead of metadata.
- Pipe large JSON through `jq` to keep the chat context small. Example: `mmx quota show --output json | jq '{plan, used, remaining}'`.
- Use `--quiet` when the response body itself is the artifact (you only care about the bytes on disk).
- Use `--dry-run` when you are uncertain about a side-effect — prints the call without running it.

## Common pitfalls

- **`mmx auth login` is interactive** when called without `--api-key`. Do not invoke it from an agent run; the prompt will hang.
- **`mmx speech synthesize` is synchronous and capped at 10k chars.** For longer text, chunk first or use the streaming flag.
- **`mmx video generate` returns a task id, not the video.** Always follow up with `mmx video task get` and `mmx video download`.
- **`mmx image generate --response-format url` (default) returns URLs that expire.** Download quickly with `--out`/`--out-dir` or switch to `--response-format base64` for short-lived payloads.
- **`mmx file upload --purpose` defaults to `retrieval`.** Use `vision` for `mmx vision describe`, `image` for image-conditioned flows, etc. Wrong purpose → the consumer command rejects the file id.
- **Rate limits** — if you see HTTP 429, back off and check `mmx quota show`. Don't retry-storm; the CLI already retries with jitter on 429/5xx.
- **Region mismatches** — if you authenticated against `--region=cn` and try to call `--region=global` endpoints, expect 401/403. Re-login with the correct region.

## Environment variables

`mmx` honours, in order of precedence:

1. `--api-key` / `--base-url` flags
2. `MMX_API_KEY`, `MMX_BASE_URL` env vars (set in the user's shell)
3. Stored credentials in `~/.config/mmx/config.json`

As an agent you usually only need to set `MMX_API_KEY` if asked; the rest is automatic.

## Relationship to the `cloudcli-minimax` MCP

- The MCP (`minimax-coding-plan-mcp`, registered via `OpenCLI → Settings → Navegador → MiniMax MCP toggle`) is one of several ways agents can reach MiniMax capabilities. It exposes a curated tool surface for browser-style tasks.
- This skill covers the **wider `mmx` CLI surface** — anything `mmx` can do, you can do directly via `Bash`, including capabilities the MCP does not expose (music, video, quota introspection, config edits, self-update).
- The MCP and the CLI coexist. If the MCP is disabled (`OpenCLI → Navegador → MiniMax MCP` toggle OFF), this skill still works; just shell out to `mmx` directly.
