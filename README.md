# OpenCLI (`opencli`)

A full-stack, browser-based UI for [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). OpenCLI pairs an authenticated React frontend with an Express backend that manages chat sessions, projects, files, shell access, MCP configuration, skills, RAG / knowledge base, browser automation, notifications, and provider session synchronization — all from a single PWA you can install on desktop or mobile.

> **Heads up:** this is a fork / rebrand of [OpenCLI](https://opencli.ai). The package was formerly published as `claudecodeui` and then as `@opencli-ai/opencli`; the canonical npm name is now `opencli`.

---

## ✨ Features

- **Chat** — streaming responses from Claude Code with full session history, file attachments, image paste, slash commands, and CLI prompt detection (numbered menus render as tap-friendly buttons on mobile).
- **Projects** — create / rename / star / archive / hard-delete projects. Per-project session list with resume, soft-archive, hard-delete, and rename.
- **Files tab** — project-independent file manager rooted at `WORKSPACES_ROOT`. Browse, read, edit, create, rename, copy, move, trash, ZIP download, with click / Ctrl|Cmd / Shift selection semantics.
- **Terminal tab** — per-project PTY-backed bash with the Claude CLI running inside. URL detection, auth-link auto-open, xterm.js renderer, mobile-friendly.
- **Consola tab** — project-independent interactive bash at `WORKSPACES_ROOT`. Run `qwen`, `htop`, `vim`, or anything else with a real PTY. No project required.
- **Knowledge Base (RAG)** — vectorize local documents with Ollama / OpenAI / MiniMax embeddings, index them, and ask Claude about them.
- **Skills** — manage Claude skills locally; fetch skills directly from GitHub URLs.
- **Read aloud (TTS)** — Reproducir button on assistant messages, voiced via `mmx speech synthesize` (configurable voice / speed / language / auto-play).
- **Voice input (STT)** — Mic button in the chat composer; one click records, the next transcribes via `whisper.cpp` (`audio/webm` → `ffmpeg` → 16 kHz mono PCM WAV), and the resulting text flows through the same `chat.send` path as typed input.
- **MCP** — configure Model Context Protocol servers per session.
- **Browser Use** — opt-in browser automation panel.
- **Notifications** — desktop push via Web Push (VAPID), with provider toggles.
- **Command Palette** — fuzzy launcher for actions across the app.
- **PWA** — installable on desktop / mobile, offline-friendly static shell.
- **i18n** — multi-locale UI strings (English / Spanish + extendable).
- **JWT auth + optional API key** — local users table with bcrypt, optional `?token=` query param for the API.

---

## 🧱 Stack

- **Frontend** — React 18, React Router, Vite, Tailwind, xterm.js, CodeMirror 6, i18next, lucide-react.
- **Backend** — Node.js 22 (see `.nvmrc`), Express 4, ws, better-sqlite3, node-pty, chokidar, jszip, multer.
- **Persistence** — SQLite (`better-sqlite3`) for auth / app config / projects / sessions.
- **Providers** — extensible provider registry. `claude` ships by default (`server/modules/providers/list/claude/`).

---

## 🚀 Quick start

### Prerequisites

- **Node.js 22** (use `nvm use` — see `.nvmrc`)
- **npm 10+**
- **Claude Code CLI** installed and authenticated (`npm i -g @anthropic-ai/claude-code && claude auth login`)
- **Python 3.12+** for the RAG MCP (auto-installed on first boot — see below)
- Optional: **Ollama** running locally for the RAG embeddings default
- Optional: **`mmx` CLI** for the read-aloud TTS button — `mmx` must be on `PATH`; without it the button shows a "TTS no disponible" tooltip and stays disabled
- Optional: **ffmpeg** and **whisper.cpp** for the voice input button — run `bash server/whisper/setup.sh` to build whisper.cpp from source and download `ggml-base.bin`. Without them the mic icon stays visible but disabled, with a tooltip pointing at `setup.sh`.

### Install

```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
nvm use          # or: nvm install
npm install
cp .env.example .env
```

`npm install` also runs `scripts/fix-node-pty.js` which rebuilds `node-pty` against the active Node toolchain so the Terminal / Consola tabs work.

#### RAG MCP

OpenCLI ships a Python-based RAG MCP that lets Claude search through your
local office documents (PDF, DOCX, XLSX, PPTX, TXT, MD, CSV). The package
lives under `mcp/rag/` with its own `pyproject.toml`.

##### Auto-install (default)

On the **first backend boot** the server auto-installs the RAG MCP and
registers it in `~/.claude.json` under the `rag` name. You only need one
of these Python package managers:

- **`uv`** (preferred, 10-100× faster) — https://docs.astral.sh/uv/getting-started/installation/
- **`python3 -m pip`** — `apt install python3-pip` (or your OS equivalent)

The installer:

1. Detects `uv` first, falls back to `pip` if absent.
2. Creates `mcp/rag/.venv/` if missing and runs `pip install -e .`
   (editable, so changes in `src/rag_mcp/` are picked up on the next launch).
3. Runs a health check: `<venv>/bin/python -c "import rag_mcp.server"`.
4. Writes `mcpServers.rag` into `~/.claude.json` at user scope using the
   absolute path resolved from `findAppRoot(import.meta.url)` — so the
   same flow works no matter where you cloned the project.
5. Persists a sentinel in `app_config` (key `rag_mcp_installed_v1`) so
   subsequent boots short-circuit.

If neither `uv` nor `pip` is available, the server logs a multi-line
warning and continues to boot — only the RAG tab stays unavailable.
The rest of OpenCLI keeps working.

##### Manual install

If you'd rather install by hand, or want to skip the auto-installer
entirely:

```bash
cd mcp/rag

# With uv:
uv venv .venv
uv pip install -e .

# Or with pip only:
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

Then add this entry to `~/.claude.json` (merge with existing content):

```json
{
  "mcpServers": {
    "rag": {
      "type": "stdio",
      "command": "<repo>/mcp/rag/run-server.sh",
      "args": [],
      "env": {
        "OPENCLI_ENV": "<repo>/.env"
      }
    }
  }
}
```

Replace `<repo>` with the absolute path where you cloned OpenCLI
(e.g. `/opt/opencli`, `/home/cmt/web/chat.cmt.gob.bo/public_html`,
etc.). The same block can also be pasted into the **Settings → MCP**
form via the "Importar JSON" mode.

Verify the install:

```bash
# 1. venv resolves the package:
<repo>/mcp/rag/.venv/bin/python -c "import rag_mcp.server; print('OK')"

# 2. Claude sees it:
cat ~/.claude.json | python3 -m json.tool | grep -A6 '"rag"'
```

##### Re-install / reset

To force the auto-installer to re-run from scratch (for example after
bumping dependencies in `mcp/rag/pyproject.toml`):

```bash
# Reset just the sentinel — installer re-detects, re-uses the existing venv
sqlite3 database/auth.db "DELETE FROM app_config WHERE key='rag_mcp_installed_v1';"

# Or wipe the venv too — full re-install
rm -rf mcp/rag/.venv
sqlite3 database/auth.db "DELETE FROM app_config WHERE key='rag_mcp_installed_v1';"

# Then restart the backend.
```

To invalidate the install for **every** deployment at once (e.g. when
shipping a new dependency version), bump `SENTINEL_VERSION` in
`server/modules/first-run/rag-mcp-installer.ts` and rebuild the server.

##### Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| Backend log: `Neither uv nor python3 -m pip is available` | Install one of them and restart the server. |
| Backend log: `Health check failed (exit N)` | `pyproject.toml` may be broken. Run `<repo>/mcp/rag/.venv/bin/python -c "import rag_mcp.server"` manually to see the traceback. |
| Backend log: `Install with uv failed: …` | Network/cache issue. Re-run with `DEBUG=rag-mcp` env var for full stdout. |
| Claude shows `rag` as `failed` / `disconnected` | The launcher couldn't run. Inspect the Claude MCP error log; verify `run-server.sh` is executable (`chmod +x mcp/rag/run-server.sh`). |
| `mcpServers.rag` is missing from `~/.claude.json` | The auto-installer may have skipped (no manager available, or pyproject missing). Re-run the manual steps above. |

### Configure

Edit `.env`. The most important variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_PORT` | `3001` | Express + WebSocket port |
| `VITE_PORT` | `5173` | Vite dev server port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for localhost-only) |
| `PROXY_HOST` | derived | Public backend URL for LAN / reverse-proxy dev — required when `HOST=0.0.0.0` and you reach the app via a public IP / hostname, otherwise WebSocket upgrades silently fail |
| `DATABASE_PATH` | `./database/auth.db` | Auth DB location |
| `WORKSPACES_ROOT` | `$HOME` | Root for the Files tab and the Consola tab's bash PTY |
| `VITE_SHOW_SHELL_TAB` | `true` | Toggle the per-project Terminal tab |
| `VITE_SHOW_CONSOLE_TAB` | `true` | Toggle the project-independent Consola tab |
| `CONTEXT_WINDOW` / `VITE_CONTEXT_WINDOW` | `1000000` | Server / client context-window cap |
| `CLAUDE_CLI_PATH` | `claude` | Non-default Claude CLI executable |
| `RAG_*` / `OLLAMA_*` | — | Embedding provider / model / batching / retry / chunking |
| `TTS_*` | `Spanish_Narrator` / `1.0` / `es` / `speech-2.8-hd` / `false` / `30000` | TTS voice / speed / language / model / auto-play / timeout (see [Read-aloud](#read-aloud-tts)) |
| `WHISPER_*` | `true` / auto / `ggml-base.bin` / `auto` / `60000` / `25` | STT enable / binary / model / language / timeout / upload cap (see [Voice input](#voice-input-stt)) |

`npm run dev` (the dev proxy uses `PROXY_HOST` for `/api`, `/ws`, `/shell`, `/file-manager-events`, and `/plugin-ws`).

### Develop

```bash
npm run dev                  # backend (tsx watch) + frontend (Vite) concurrently
npm run client               # Vite only
npm run server:dev           # backend only (tsx, no watch)
npm run server:dev-watch     # backend with watch
```

### Build & run in production

```bash
npm run build                # vite build + tsc + tsc-alias
npm run server               # node dist-server/server/index.js
npm start                    # build + server
```

The compiled output lives in `dist/` (client) and `dist-server/` (server). Do **not** hand-edit either.

### Install as a system service

The `opencli` CLI (exposed via the `bin` entry) can manage the install:

```bash
npm run build
npx opencli install         # writes a systemd / launchd unit
npx opencli status          # prints resolved runtime / data locations
```

---

## 🗂️ Architecture

### Top-level

```
src/                  React frontend (Vite)
  components/
    chat/             Chat UI, composer, slash commands
    shell/            xterm.js PTY shell used by Terminal tab
    standalone-shell/ Wrapper around shell/ for project / Consola mounting
    workspace-shell/  Project-independent Consola tab
    file-manager/     Files tab
    main-content/     Header / tabs / content area
    ...
server/               Express + WebSocket backend
  index.js            Composition root (loads .env, mounts routes, starts WS)
  modules/
    projects/         CRUD + soft-archive + hard-delete
    file-manager/     Files tab REST API
    workspace-shell/  (removed — Consola now uses the /shell PTY)
    websocket/        Shared WebSocket gateway (chat, shell, file-manager, notifications)
    providers/        Provider registry (auth, mcp, skills, sessions)
    skills-github/    Fetch / extract skills from GitHub URLs
    rag/              Vectorize + index local documents
    browser-use/      Browser automation panel
    notifications/    Web Push (VAPID)
    tts/              mmx-backed read-aloud for assistant messages
    feature-flags/    Runtime feature toggles
    database/         better-sqlite3 connection + repositories
    first-run/        Seed bundled skills / content on first launch
    assets/           Image / logo asset routes
  shared/             Cross-module type contracts + utilities
  middleware/         JWT auth, API key auth
public/               Static assets served by Express
bundled/              First-run seeded content (skills, etc.)
dist/                 Built client (gitignored)
dist-server/          Built server (gitignored)
```

### Composition order (frontend)

`src/main.jsx` → `I18nextProvider` → `ThemeProvider` → `AuthProvider` → `WebSocketProvider` → `ProtectedRoute` → React Router.

### Composition order (backend)

`server/index.js` is the composition root. It must `import './load-env.js'` before anything else reads env vars. It then mounts:
- public `/health` + auth routes
- optional API-key validation on `/api`
- JWT-protected project / asset / Git / settings / notification / browser-use / feature-flag / RAG / provider / MiniMax routes
- the shared WebSocket server (`/ws`, `/shell`, `/file-manager-events`, `/plugin-ws`)
- static serving from `public/` and `dist/`, with SPA fallback to `dist/index.html` (or a redirect to Vite in dev)

### File-manager and Consola are independent of the selected project

Both the **Files** tab (`src/components/file-manager` + `server/modules/file-manager`) and the **Consola** tab (`src/components/workspace-shell` + the `/shell` WebSocket) ignore the selected project and are rooted at `WORKSPACES_ROOT`. They mount on first visit and stay alive across tab switches so navigation, selection, scrollback, and WebSocket connections persist.

### Consola = a plain interactive bash PTY

The Consola tab mounts a project-independent xterm.js terminal and connects to the existing `/shell` WebSocket with `isPlainShell: true`, no `initialCommand`, and `cwd: WORKSPACES_ROOT`. The server recognizes that combination and spawns `bash -i` (interactive) instead of `bash -c ''` (which would exit immediately). This means `qwen`, `vim`, `htop`, `ssh`, `tmux`, or anything else that needs a real TTY Just Works.

### Providers

The provider registry lives at `server/modules/providers/provider.registry.ts`. Only the `claude` provider is currently registered. Adding a provider requires coordinated changes in:
- backend: `server/modules/providers/list/<provider>/` (auth, mcp, skills, sessions, sessionSynchronizer)
- backend: `server/shared/types.ts` and `server/shared/interfaces.ts`
- frontend: provider types / constants / selection UI / model fallbacks / MCP UI constants
- shared: `opencli status` enum updates

See `server/modules/providers/README.md` for design guidance (verify against the registry — the README's examples reference providers that may not be present).

### Skills and RAG

- `server/modules/skills-github` fetches and extracts skills from GitHub URLs (`github-url.ts`, `github-fetcher.ts`, `github-extract-walker.ts`).
- `server/modules/rag` is the Node-side RAG indexing service; startup repairs interrupted index jobs.
- `mcp/rag/` is a separate Python-based RAG helper (uv-managed; `pyproject.toml`, `src/`, `data/`, `.venv/`).
- Frontend skills UI in `src/components/skills`. Provider-scoped skills surface through `useProviderSkills` / `ProviderSkills`.

### Read-aloud (TTS)

Assistant messages expose a **Reproducir / Play** button next to **Copy**. Clicking it
streams a synthesized voice version of the answer through the browser's `<audio>`
element. The voice, speed, language, and auto-play behavior are configured in
`.env`.

The backend uses the [`mmx` CLI](https://github.com/MiniMax-AI/cli) (`mmx speech synthesize`)
rather than the browser's Web Speech API — server-side voices are consistent
across OS / browser combos, and the API key already lives in `MiniMax_API_KEY`.

**Audio text cleaning.** TTS engines mangle code blocks, JSON, URLs, file
paths, shell commands, and markdown emphasis. Before each request the backend
runs the text through a 17-stage pipeline in
[`server/modules/tts/text-cleaner.ts`](server/modules/tts/text-cleaner.ts)
that strips:

- fenced code blocks (` ``` ... ``` `) and indented code
- inline code (`` `foo` ``) when the content looks like code
- inline JSON / JSON-shaped runs and code-only lines
- shell prompts (`npm`, `git`, `curl`, `pip`, `docker`, etc.)
- URLs (`https?://...`), file paths (`/opt/...`), and stack traces
- markdown decorations (headings, blockquotes, list bullets, tables)
- HTML tags and emojis

If the cleaner removes everything, the request returns `422 text-empty-after-clean`
and the UI shows a tooltip — no audio element is created.

**Env vars** (all optional, with sensible defaults):

| Variable | Default | Purpose |
| --- | --- | --- |
| `TTS_ENABLED` | `true` | Master toggle for the feature; `false` hides the Play button |
| `TTS_VOICE` | `Spanish_Narrator` | Voice id — see `mmx speech voices --output json` |
| `TTS_SPEED` | `1.0` | Speech speed multiplier (`0.5` - `2.0`) |
| `TTS_LANGUAGE` | `es` | Language boost for the model (`es`, `en`, `zh`, ...) |
| `TTS_MODEL` | `speech-2.8-hd` | `speech-2.8-hd` for highest quality, `speech-02` for cheapest |
| `TTS_AUTO_PLAY` | `false` | Auto-play assistant replies when streaming finishes |
| `TTS_TIMEOUT_MS` | `30000` | Per-request synthesis timeout |

**Endpoints** (all JWT-protected):

- `POST /api/tts/synthesize` — body `{ text, voice?, speed?, language? }`, returns `audio/mpeg`
- `GET  /api/tts/config` — returns the effective defaults so the UI can show "Default voice: …"
- `GET  /api/tts/voices?language=<lang>` — proxies `mmx speech voices` for a future voice picker

If `mmx` is not on `PATH` the synthesize endpoint returns `503 tts-unavailable`
and the UI shows a tooltip instead of crashing.

### Voice input (STT)

A **Mic** button lives next to the image-attach button in the chat composer.
Click once to start recording, click again to stop; the transcript is inserted
into the textarea and **automatically sent** to the LLM via the existing
`chat.send` flow. The button is always visible — when whisper.cpp is missing
or disabled by the server admin it renders dimmed with a tooltip explaining
what's needed; it never disappears silently.

The backend uses **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)**
(the `whisper-cli` binary) rather than a hosted STT API — runs locally,
no per-request cost, and language detection is controllable per session.

**Pipeline per request**

```
audio/webm (Chromium/Firefox) ─┐
audio/mp4   (Safari)          ─┼─▶ ffmpeg ─▶ 16 kHz mono PCM WAV ─▶ whisper-cli ─▶ .txt
                               │                ├─ -l <auto|es|en|…>
                               │                └─ --no-timestamps
                               ▼
              /api/whisper/transcribe  (POST multipart, 25 MB cap)
```

**Setup.** Run the bundled script — it builds whisper.cpp from source if no
binary is on `PATH`, then downloads `ggml-base.bin` (~140 MB) into
`server/whisper/models/`. At the end it prints the exact `.env` lines to add:

```bash
bash server/whisper/setup.sh
# or pick a different model:
bash server/whisper/setup.sh ggml-small.bin
```

Then add the printed lines to `.env` and restart the backend:

```env
WHISPER_ENABLED=true
WHISPER_BINARY=$(command -v whisper-cli)  # or absolute path
WHISPER_MODEL=server/whisper/models/ggml-base.bin
WHISPER_LANGUAGE=auto
```

**Env vars** (all optional, with sensible defaults — full reference in
[`server/whisper/README.md`](server/whisper/README.md)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHISPER_ENABLED` | `true` | Master toggle; `false` hides the mic button entirely |
| `WHISPER_BINARY` | auto-detect | Absolute path to `whisper-cli` (also tries `whisper` and legacy `main`) |
| `WHISPER_MODEL` | `ggml-base.bin` | Bare filename matching `ggml-*.bin`, resolved against `server/whisper/models/`; absolute paths also accepted |
| `WHISPER_LANGUAGE` | `auto` | BCP-47 (`en-US`, `es-MX`, …) — server strips the region when calling whisper.cpp |
| `WHISPER_TIMEOUT_MS` | `60000` | Hard timeout for a single transcription |
| `WHISPER_MAX_FILE_SIZE_MB` | `25` | Multer upload cap; `413` on excess |

**Endpoints** (JWT-protected, mounted under `/api/whisper`):

- `POST /api/whisper/transcribe` — `multipart/form-data` with `audio` field
  (the `language` form field overrides `WHISPER_LANGUAGE` for the request).
  Returns `{ success: true, text: "..." }`.
- `GET  /api/whisper/config` — `{ enabled, available, language, model, timeoutMs }`
  so the UI can show the dim state correctly.

If the backend can't reach whisper.cpp the endpoint returns
`503 whisper-unavailable` and the UI shows the tooltip pointing at
`server/whisper/setup.sh`. Empty recordings decode as `422 transcript-empty`;
crashes inside whisper.cpp map to `502 whisper-failed`; uploads above the
configured cap return `413 audio-too-large`.

For the full env-var reference and endpoints see
[`server/whisper/README.md`](server/whisper/README.md) — the source of
truth that this summary stays in sync with.

### Vite dev proxy

`vite.config.js` proxies `/api`, `/ws`, `/shell`, `/file-manager-events`, and `/plugin-ws` to the backend. WebSocket upgrades need the proxy target to be reachable from the browser — set `PROXY_HOST` when binding `HOST=0.0.0.0` but reaching the app via a public IP / hostname, otherwise WS upgrades silently fail.

---

## ⚙️ Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run server (tsx) + client (Vite) concurrently |
| `npm run client` | Vite frontend only |
| `npm run server:dev` | Backend once via tsx |
| `npm run server:dev-watch` | Backend with watch mode |
| `npm run build` | Build client + server |
| `npm run build:client` | Vite build |
| `npm run build:server` | tsc + tsc-alias |
| `npm run server` | Run compiled server (requires `dist-server/`) |
| `npm start` | build + server |
| `npm run preview` | vite preview of built client |
| `npm run typecheck` | tsc --noEmit for both frontend and backend tsconfigs |
| `npm run lint` | ESLint over `src/` and `server/` |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm run release` | release-it (reads `GITHUB_TOKEN` from `.env`) |
| `npm run update:platform` | Refresh platform-mode assets |

---

## ✅ Quality

Run these before opening a PR:

```bash
npm run typecheck
npm run lint
npm run build
```

Tests use Node's built-in `node:test` runner — there is no `npm test` script. Run them explicitly:

```bash
npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/slice-tail-page.test.ts
# multiple files:
npx tsx --tsconfig server/tsconfig.json --test server/modules/foo/tests/foo.test.ts server/modules/bar/tests/bar.test.ts
```

Conventions: backend uses `NodeNext` (include `.js` on runtime imports); use `import type` for type-only contracts from `server/shared/types.ts` and `server/shared/interfaces.ts`; ESLint enforces the `eslint-plugin-boundaries` module rules (no deep cross-module imports — always go through the barrel).

---

## 🔒 Security notes

- Auth: JWT in `Authorization: Bearer <token>` for REST, `?token=` query param for WebSockets (since browsers can't set headers on `new WebSocket`).
- File-manager and Consola enforce a lexical + realpath + symlink containment check around `WORKSPACES_ROOT` so neither can escape it.
- Permanent delete is opt-in (`?force=true` on the relevant routes) — the default is soft-archive.
- Never commit `.env`, credentials, API keys, tokens, provider configs, or runtime DB files.
- Set `HOST=127.0.0.1` if you don't need LAN access.

---

## 🛠️ Troubleshooting

- **WebSocket upgrades hang on "loading…"** — set `PROXY_HOST` to the URL the browser actually uses.
- **`better-sqlite3` fails with `ERR_DLOPEN_FAILED`** — `npm rebuild better-sqlite3` with the Node version you'll actually run (see `.nvmrc`).
- **`node-pty` fails to spawn** — `npm rebuild node-pty` against the active Node toolchain; `npm install` does this automatically via `scripts/fix-node-pty.js`.
- **Port 3031 / 3001 in use** — change `SERVER_PORT` (and `PROXY_HOST` if needed).
- **`claude` CLI not found** — install and authenticate Claude Code (`npm i -g @anthropic-ai/claude-code && claude auth login`), or set `CLAUDE_CLI_PATH` to the absolute path of a custom executable.

---

## 📦 Releasing

```bash
npm run release
```

`release-it` reads `GITHUB_TOKEN` from `.env` to open the GitHub release. Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, …) are enforced by commitlint + Husky pre-commit hooks.

---

## 📄 License

This project is released under the terms of the license in the repository root. Anthropic's Claude Code CLI itself is governed by Anthropic's own terms.

---

## 🤝 Contributing

Issues and PRs welcome on [GitHub](https://github.com/siteboon/claudecodeui). Before opening a PR, please read `CLAUDE.md` for project-specific conventions, run `npm run typecheck && npm run lint && npm run build`, and add focused tests for any new behavior.