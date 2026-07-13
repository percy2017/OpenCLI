# OpenCLI

UI web para Claude Code, OpenAI Codex y otros coding agents — ejecutalo como app local, en Docker, o como servidor self-hosted.

## ¿Qué hace?

OpenCLI te da una UI en el navegador para conversar con coding agents (Claude Code, OpenAI Codex, etc.) con sesiones persistentes, terminal integrado, file tree, editor de código, skills y MCP servers.
El backend es Node.js + Express + SQLite. El frontend es React + Vite. Se distribuye como un único paquete npm que se compila en un server bundle + un SPA y se publica como binario global `cloudcli` (nombre heredado; ver Prerrequisitos para los binarios externos reales).

## Prerrequisitos

El backend invoca tres binarios en `$PATH`. Si falta alguno, el panel correspondiente de la UI falla en silencio. Cada uno se configura **fuera** de OpenCLI.

### 1. Claude Code CLI — binario `claude`

Lo spawna el SDK de Anthropic en `server/claude-sdk.js` para correr sesiones de chat. Sin él, el provider `claude` aparece como "no instalado".

```bash
npm install -g @anthropic-ai/claude-code
claude --version   # verifica
```

Override de path: env var `CLAUDE_CLI_PATH` (default `claude`).

**Auth del LLM (vía `~/.bashrc`):** Claude Code toma el modelo default del provider que apunte `ANTHROPIC_BASE_URL`. Para usar **MiniMax** con tu plan token, agregá en `~/.bashrc`:

```bash
# MiniMax como backend LLM default para Claude Code
export ANTHROPIC_BASE_URL="https://api.minimax.io/v1"   # endpoint de MiniMax
export ANTHROPIC_API_KEY="<tu-token-de-MiniMax>"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="1000000"
ANTHROPIC_MODEL="MiniMax-M3[1m]"

# Recargá: source ~/.bashrc
```

OpenCLI no gestiona esta auth — Claude Code lee esas vars en cada llamada.

### 2. Codex CLI — binario `codex`

Lo usa `server/modules/providers/list/codex/codex-auth.provider.ts` para detectar instalación. Las sesiones reales corren sobre el SDK JS de OpenAI; el binario sólo se necesita para que el provider figure como instalado.

```bash
npm install -g @openai/codex
codex --version    # verifica
```

**Auth del LLM (vía `~/.codex/config.toml`):** Codex resuelve el provider default leyendo `config.toml`. Para apuntarlo a **MiniMax**:

```toml
# ~/.codex/config.toml

model = "MiniMax-M3"
model_provider = "minimax"
model_context_window = 1000000

[model_providers.minimax]
name = "MiniMax"
base_url = "https://api.minimax.io/v1"
api_key = "<tu-token-de-MiniMax>"
wire_api = "responses"

```

Codex por defecto intenta OAuth vía `~/.codex/auth.json` si no encuentra esto; con el bloque de arriba se usa el token de MiniMax directamente. OpenCLI tampoco gestiona esta config.

### 3. MiniMax CLI — binario `mmx`

Lo usan `server/voice-proxy.js` y `server/minimax-proxy.js` para:

- **TTS** de mensajes del chat (`mmx speech synthesize --model … --voice …`) — módulo de Voz.
- **Estado y quota** del CLI en la pestaña Settings (`mmx auth status`, `mmx config show`, `mmx quota show`).

Sin `mmx`, el botón "Leer en voz alta" devuelve error y la pestaña Voz queda vacía. Instalalo según la doc oficial de MiniMax y asegurate de que esté en `$PATH`. Modelo LLM por defecto bajo `mmx`: **`minimax-m3`**.

Override de path: env var `MMX_BIN` (default `mmx`). Defaults configurables en `.env`: `VOICE_DEFAULT_MODEL`, `VOICE_DEFAULT_VOICE`, `VOICE_TIMEOUT_MS`, `MMX_TIMEOUT_MS`.

### Verificación rápida

```bash
claude --version && codex --version && mmx --version
```

Si los tres imprimen versión, todo está listo.

## Voz (TTS)

OpenCLI incluye un módulo de **texto a voz** para escuchar los mensajes del chat en voz alta (botón "Leer en voz alta" en cada mensaje). Es 100% local: el backend **spawnea** la CLI `mmx`, no hace HTTP a ninguna API externa.

### Endpoints

| Método | Path | Qué hace |
|---|---|---|
| `GET`  | `/api/voice/health`      | Verifica `mmx --version` + lista de voces (`mmx speech voices`) |
| `POST` | `/api/voice/tts`         | Genera audio con `mmx speech synthesize --model <m> --voice <v> --format mp3` (cachea hasta 64 audios por `model|voice|text`) |
| `GET`  | `/api/minimax/health`    | `mmx --version` |
| `GET`  | `/api/minimax/auth`      | `mmx auth status --output json` |
| `GET`  | `/api/minimax/config`    | `mmx config show --output json` |
| `GET`  | `/api/minimax/quota`     | `mmx quota show --output json` (cache 30s) |

### Configuración

| Env var | Default | Uso |
|---|---|---|
| `MMX_BIN`              | `mmx` | Path del binario |
| `VOICE_DEFAULT_MODEL`  | `speech-2.8-hd` | Modelo TTS default |
| `VOICE_DEFAULT_VOICE`  | `English_expressive_narrator` | Voz default |
| `VOICE_TIMEOUT_MS`     | `300000` (5 min) | Timeout de síntesis |
| `MMX_TIMEOUT_MS`       | `30000` (30 s)   | Timeout de los endpoints de status/quota |

La UI de Voz vive en **Settings → Voz**, donde se listan los modelos/voices que `mmx` ofrece y se puede alternar el TTS on/off.

## MCP servers por defecto

OpenCLI configura automáticamente **2 MCP servers** en los providers de Claude y Codex al instalarse (los escribe en `.mcp.json` para Claude y en `config.toml` para Codex, scope user). Ambos son **gestionados** por features de OpenCLI — aparecen en la UI con el prefijo `cloudcli-` (read-only, no se editan a mano, se borran solos al desactivar la feature).

### 1. `cloudcli-browser`

Habilita el tab **Browser** del sidebar: browser automation via MCP (Playwright). Se activa cuando encendés la feature de Browser en Settings → Navegador.

### 2. `cloudcli-minimax`

Conecta el plan de **MiniMax** al MCP de cada provider. Se activa si tenés `mmx` autenticado. Permite invocar skills/external tools del plan de MiniMax desde dentro de una sesión de Claude o Codex.

### 3. `cloudli-rag`

para gestionar RAG con minimax

Si querés listarlos manualmente:


```bash
# Claude
cat ~/.mcp.json

# Codex
cat ~/.codex/config.toml
```

Si tu instalacion no los creó (por ejemplo, dist viejo o feature desactivada), podés cargarlos manualmente desde **Settings → MCP Servers** → botón Agregar.

## Quickstart

```bash
git clone https://github.com/percy2017/OpenCLI.git
cd opencli
npm install
npm run dev
```

- Backend con HMR: `http://localhost:3001`
- Frontend Vite: `http://localhost:5173`

Copiá `.env.example` a `.env` y ajustá los puertos si hace falta.

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│  Browser (React + Vite)                         │
│  - Auth, Theme, WebSocket contexts     │
│  - Chat, FileTree, Shell, CodeEditor, Settings  │
└────────────────────┬────────────────────────────┘
                     │ HTTP REST + WebSocket
                     │ (3 endpoints: /ws, /shell, /terminal-shell)
┌────────────────────▼────────────────────────────┐
│  Express server (Node 22, TypeScript)           │
│                                                 │
│  - modules/database (SQLite repos)              │
│  - modules/projects (gestión de proyectos)      │
│  - modules/providers (auth/MCP/skills/sessions) │
│  - modules/websocket (gateway, run registry)    │
│  - modules/notifications (Web Push, desktop)    │
│  - modules/browser-use (MCP browser automation) │
│  - routes/*, middleware/auth.js                 │
└─────────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  Claude Agent   OpenAI Codex   Pluggable providers
```

### Stack
- **Node js:** Node js 22.*
- **Frontend:** React 18, Vite 7, Tailwind, CodeMirror, xterm.js, react-router-dom, i18next
- **Backend:** Express 4, better-sqlite3, node-pty, ws, chokidar
- **SDKs:** `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`
- **DB:** SQLite (better-sqlite3)

## Internacionalización

Locale por defecto: **español**. Soportados: `en`, `es`, `fr`, `de`, `it`, `ja`, `ko`, `ru`, `tr`, `zh-CN`, `zh-TW`.
Las traducciones viven en `src/i18n/locales/<lang>/{common,settings,auth,sidebar,chat,codeEditor}.json`.

## Seguridad

- **Auth:** usuario + password hasheado con bcrypt + JWT. WebSocket valida token en upgrade.
- **Workspace isolation:** paths de proyectos se validan contra `WORKSPACES_ROOT` antes de cualquier filesystem mutation. Ver `validateWorkspacePath` y `FORBIDDEN_WORKSPACE_PATHS` en `server/shared/utils.ts`.
