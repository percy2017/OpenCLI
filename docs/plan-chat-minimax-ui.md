# Plan — Integrar chat `mmx text repl` en el panel "Minimax MCP"

> Estado: **plan de implementación**. No ejecutado todavía.

---

## 1. Contexto y motivación

### Qué problema resolvemos

CloudCLI ya expone una pestaña **"Minimax MCP"** (`AppTab = 'minimax'`) en la barra superior, renderizada por `src/components/minimax-mcp/MinimaxPanel.tsx`. Esa vista **solo muestra estado pasivo**:

- Versión de la CLI `mmx` (`/api/minimax/health`)
- Cuotas General / Video del Token Plan (`/api/minimax/quota/text`)
- Método y origen de la autenticación (`/api/minimax/auth`)

**No permite conversar** con el modelo. Si el usuario quiere probar el CLI, hoy tiene que abrir una terminal aparte y ejecutar `mmx text repl` o `mmx text chat` a mano. Eso rompe el flujo: sale de la UI, pierde contexto, y al volver no tiene historial visible.

### Por qué ahora

- El CLI `mmx 1.0.16` ya instalado soporta el modo ideal para esto: `mmx text chat --stream --output json --messages-file -`. Lee el array de mensajes desde stdin y emite NDJSON token-por-token.
- `mmx text repl` es TUI-bound; descartado.
- El patrón SSE ya existe en `server/routes/agent.js:96-130` (`SSEStreamWriter`); no necesitamos inventar nada nuevo en el lado de transporte.
- `MinimaxPanel` ya hace polling de `/health` y `/auth` — el composer del chat puede reutilizar esas señales para degradar elegantemente cuando falta CLI o auth.

### Resultado esperado

Una sección **"Chat"** dentro de `MinimaxPanel.tsx` (entre "Authentication" y el final), con:

- Lista de mensajes scrollable, user/assistant diferenciados
- Composer inferior con textarea + Send/Stop
- Streaming de tokens en tiempo real vía SSE
- Historial persistido en `localStorage` por proyecto (sobrevive a recargas)
- Botón "Clear history" con confirmación
- Mensajes de fallback si falta `mmx` o la auth

No tocamos: el sistema de providers (`/ws`, `AppTab`, `LLMProvider`, SQLite sessions, model picker), ni el `ChatInterface` principal.

---

## 2. Decisiones de diseño

| Decisión | Elección | Razón |
|---|---|---|
| **Ubicación en la UI** | Sección dentro de `MinimaxPanel.tsx` | El usuario lo pidió. Mantiene el contexto minimax autocontenido. |
| **Persistencia del historial** | `localStorage` por `projectPath` (clave `minimax-chat-history:<projectPath>`) | Cero cambios de schema. Sobrevive a recargas. Privado del navegador. |
| **Modelo seleccionado** | `localStorage` (clave `minimax-chat-model`), default `MiniMax-M2.7` | Persistente, no requiere DB. |
| **Transporte cliente-servidor** | HTTP `POST /api/minimax/chat` con `Content-Type: text/event-stream` (SSE) | Patrón ya existente en `server/routes/agent.js:96-130`. No usa `/ws` (que está atado a runs con seq/replay/tool approval). |
| **Multi-turno** | El cliente envía el array completo de mensajes en cada turno | `mmx text chat` no tiene session id nativo. Historial completo = contexto. |
| **Abort/Stop** | `AbortController` en el cliente → cierra `req` → `req.on('close')` → `child.kill('SIGKILL')` | Estándar. Reusa el patrón de timeout de `runMmx()`. |
| **Cancelación por timeout** | `MMX_TIMEOUT_MS` pero elevado a 120 s para chat (default 30 s es muy corto para una respuesta) | Configurable por env. |
| **Detección de quota agotada** | `mmx text chat` devuelve exit code ≠ 0 cuando hay error de quota; traducir a mensaje UI | Sin necesidad de tocar el endpoint de cuotas. |
| **Reintentos** | Ninguno automático; el usuario pulsa Send de nuevo | Mantiene el control en el usuario y evita duplicación silenciosa. |

---

## 3. Arquitectura — vista a vista

```
┌─────────────────────────────────────────────────────────────────┐
│ Navegador (React, src/components/minimax-mcp/MinimaxPanel.tsx)  │
│                                                                 │
│  ┌─ Subscription    (existente)                                 │
│  ├─ Authentication  (existente)                                 │
│  └─ Chat ◀── NUEVO                                               │
│      │                                                           │
│      │ fetch POST /api/minimax/chat  (SSE)                       │
│      │ body: { messages, model, system }                         │
│      │ signal: AbortController                                   │
│      ▼                                                           │
│  localStorage                                                    │
│   • minimax-chat-history:<projectPath>     (mensajes)            │
│   • minimax-chat-model                     (modelo seleccionado) │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                       text/event-stream
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│ Backend Express (server/minimax-proxy.js)                       │
│                                                                 │
│  POST /api/minimax/chat ◀── NUEVO                                │
│      │                                                           │
│      ├─ validar body (messages no vacío)                        │
│      ├─ res.setHeader(... SSE ...)                              │
│      ├─ spawn(MMX_BIN, [text, chat, --stream, --output, json,   │
│      │                    --messages-file, -, <flags>],         │
│      │             { stdio: ['pipe', 'pipe', 'pipe'] })          │
│      ├─ child.stdin.write(JSON.stringify({messages})) + close   │
│      ├─ readline sobre child.stdout → NDJSON                    │
│      │   cada línea: emit `event: delta\ndata: {text: chunk}\n\n`│
│      ├─ al cerrar: emit `event: done` + end                     │
│      ├─ on 'close' del request → child.kill('SIGKILL')          │
│      └─ on error → emit `event: error` + end                    │
│                                                                 │
│  Refactor: extraer runMmx() a server/utils/spawn-mmx.js con dos │
│   modos: runMmxBuffered (existente) y runMmxStream (nuevo).     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Cambios concretos

### 4.1 Backend

#### 4.1.1 Nuevo helper — `server/utils/spawn-mmx.js`

Extraer el `runMmx()` duplicado entre `server/minimax-proxy.js:29-62` y `server/voice-proxy.js:67-100`. Añadir un segundo modo:

```js
// server/utils/spawn-mmx.js
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export const MMX_BIN = (process.env.MMX_BIN || 'mmx').trim() || 'mmx';

const DEFAULT_TIMEOUT_MS = 30000;
const CHAT_TIMEOUT_MS = 120000; // más generoso para chat
const _envParsed = Number(process.env.MMX_TIMEOUT_MS);
export const MMX_TIMEOUT_MS =
  Number.isFinite(_envParsed) && _envParsed > 0 ? _envParsed : DEFAULT_TIMEOUT_MS;

export const MMX_CHAT_TIMEOUT_MS = Math.max(MMX_TIMEOUT_MS, CHAT_TIMEOUT_MS);

/** Modo buffered — bufferiza stdout/stderr y resuelve al cerrar. */
export function runMmxBuffered(args, { timeoutMs = MMX_TIMEOUT_MS, stdinPayload = null } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false;
    let child;
    try {
      child = spawn(MMX_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`Failed to spawn ${MMX_BIN}: ${e.message}`));
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`${MMX_BIN} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (stdinPayload != null) {
      try { child.stdin.end(stdinPayload); } catch { /* ignore */ }
    } else {
      try { child.stdin.end(); } catch { /* ignore */ }
    }
  });
}

/**
 * Modo stream — invoca `mmx` con NDJSON en stdout. Devuelve una Promise<{
 *   child, kill(), closePromise  }>. El caller es responsable de leer los
 *   eventos con readline.createInterface(child.stdout) y emitir SSE.
 */
export function runMmxStream(args, { timeoutMs = MMX_CHAT_TIMEOUT_MS, stdinPayload = null } = {}) {
  let child;
  try {
    child = spawn(MMX_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return Promise.reject(new Error(`Failed to spawn ${MMX_BIN}: ${e.message}`));
  }

  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  };

  const closePromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      kill();
      resolve({ code: -1, reason: 'timeout' });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1 });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, reason: 'spawn-error' });
    });
  });

  if (stdinPayload != null) {
    child.stdin.on('error', () => { /* ignore EPIPE on early kill */ });
    try { child.stdin.end(stdinPayload); } catch { /* ignore */ }
  } else {
    try { child.stdin.end(); } catch { /* ignore */ }
  }

  return Promise.resolve({ child, kill, closePromise });
}
```

#### 4.1.2 Modificaciones — `server/minimax-proxy.js`

```js
import readline from 'node:readline';
import { runMmxBuffered, MMX_BIN } from './utils/spawn-mmx.js';

// ... constantes existentes (router, _cache, etc.) ...

router.get('/health', ...); // sin cambios — usa runMmxBuffered por simplicidad
router.get('/auth', ...);   // sin cambios
router.get('/config', ...); // sin cambios
router.get('/quota', ...);  // sin cambios
router.get('/quota/text', ...); // sin cambios

/**
 * POST /api/minimax/chat
 * Body: { messages: [{role, content}], model?, system?, temperature?, maxTokens?, projectPath? }
 * Devuelve: text/event-stream
 *   event: delta  data: {"text":"<chunk>"}
 *   event: done   data: {"text":"<completo>"}
 *   event: error  data: {"message":"..."}
 */
router.post('/chat', async (req, res) => {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }
  // validación superficial de cada mensaje
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || !['user', 'assistant', 'system'].includes(m.role)) {
      return res.status(400).json({ error: 'invalid message shape' });
    }
  }

  const args = [
    'text', 'chat',
    '--stream',
    '--output', 'json',
    '--messages-file', '-',
    '--non-interactive',
    '--no-color',
  ];
  if (typeof body.model === 'string' && body.model.trim()) args.push('--model', body.model.trim());
  if (typeof body.system === 'string' && body.system.trim()) args.push('--system', body.system.trim());
  if (Number.isFinite(body.temperature)) args.push('--temperature', String(body.temperature));
  if (Number.isFinite(body.maxTokens)) args.push('--max-tokens', String(body.maxTokens));

  // Headers SSE ANTES de spawnear (no se pueden emitir después del primer byte)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const stdinPayload = JSON.stringify({ messages });

  let streamHandle;
  try {
    streamHandle = await runMmxStream(args, { stdinPayload });
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    return res.end();
  }

  const { child, kill, closePromise } = streamHandle;
  const sendEvent = (name, dataObj) => {
    if (res.writableEnded) return;
    res.write(`event: ${name}\ndata: ${JSON.stringify(dataObj)}\n\n`);
  };

  let accumulated = '';
  // NDJSON parser: cada línea es un objeto JSON. Si el formato real difiere,
  // esta función es el ÚNICO sitio a cambiar.
  const onLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed = null;
    try { parsed = JSON.parse(trimmed); } catch { return; }
    const chunk = extractTextChunk(parsed); // helper — ver §5.1 (verificación previa)
    if (chunk) {
      accumulated += chunk;
      sendEvent('delta', { text: chunk });
    }
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', onLine);
  child.stderr.on('data', (buf) => {
    const msg = buf.toString('utf8').trim();
    if (msg) {
      // stderr no es fatal, pero lo registramos. Mostrar solo la última línea.
      console.warn('[minimax chat] stderr:', msg.split('\n').slice(-3).join(' | '));
    }
  });

  // Si el cliente cierra la conexión (Stop del usuario), abortamos al child.
  const onClose = () => {
    kill();
  };
  req.on('close', onClose);

  const result = await closePromise;
  rl.close();

  if (!res.writableEnded) {
    if (result.reason === 'timeout') {
      sendEvent('error', { message: `${MMX_BIN} chat timed out` });
    } else if (result.code !== 0 && accumulated.length === 0) {
      sendEvent('error', { message: `${MMX_BIN} chat exited with code ${result.code}` });
    } else {
      sendEvent('done', { text: accumulated });
    }
    res.end();
  }
});

// Helper para extraer el chunk de texto de una línea NDJSON.
// Ajustar tras la verificación previa (§5.1).
function extractTextChunk(parsed) {
  // Variantes candidatas a probar (en orden de probabilidad):
  // Anthropic-style: {type:"content_block_delta", delta:{type:"text_delta", text:"…"}}
  // OpenAI-style:   {choices:[{delta:{content:"…"}}]}
  // Genérico:       {text:"…"} o {chunk:"…"}
  if (parsed?.delta?.text) return parsed.delta.text;
  if (parsed?.delta?.content) return parsed.delta.content;
  if (typeof parsed?.choices?.[0]?.delta?.content === 'string') {
    return parsed.choices[0].delta.content;
  }
  if (typeof parsed?.text === 'string') return parsed.text;
  if (typeof parsed?.chunk === 'string') return parsed.chunk;
  return '';
}
```

#### 4.1.3 Refactor de `server/voice-proxy.js`

Sustituir el `runMmx()` local por `runMmxBuffered` importado desde `./utils/spawn-mmx.js`. Sin cambio de comportamiento (mismo comportamiento, misma firma). Misma simplificación en `server/minimax-proxy.js` para sus rutas GET existentes.

#### 4.1.4 Montaje

El router ya está mounted en `server/index.js:221` (`app.use('/api/minimax', authenticateToken, minimaxRoutes)`). No requiere cambios.

### 4.2 Frontend

#### 4.2.1 Constantes y utilidades nuevas en `MinimaxPanel.tsx`

```tsx
// cerca del top, después de los types
import { useRef } from 'react';
import { Send, Square, Trash2, MessageSquare, Bot, User } from 'lucide-react';

const HISTORY_KEY = (projectKey) => `minimax-chat-history:${projectKey}`;
const MODEL_KEY = 'minimax-chat-model';
const MAX_HISTORY_MESSAGES = 200;

function readHistory(projectKey) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(projectKey));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(-MAX_HISTORY_MESSAGES);
  } catch { return []; }
}
function writeHistory(projectKey, messages) {
  try {
    localStorage.setItem(
      HISTORY_KEY(projectKey),
      JSON.stringify(messages.slice(-MAX_HISTORY_MESSAGES)),
    );
  } catch { /* quota exceeded — silent */ }
}
function readModel() {
  try {
    return localStorage.getItem(MODEL_KEY) || 'MiniMax-M2.7';
  } catch { return 'MiniMax-M2.7'; }
}
function writeModel(m) {
  try { localStorage.setItem(MODEL_KEY, m); } catch { /* ignore */ }
}
```

#### 4.2.2 Tipos TypeScript

```tsx
type ChatRole = 'user' | 'assistant';
type ChatMessage = {
  id: string;          // crypto.randomUUID()
  role: ChatRole;
  content: string;
  ts: number;
};
```

#### 4.2.3 Estado del componente

```tsx
// dentro de MinimaxPanel, después de los useState existentes
const [projectKey, setProjectKey] = useState('default'); // ← viene de prop
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [draft, setDraft] = useState('');
const [streamingText, setStreamingText] = useState('');
const [isStreaming, setIsStreaming] = useState(false);
const [chatError, setChatError] = useState<string | null>(null);
const [model, setModel] = useState(readModel);
const abortRef = useRef<AbortController | null>(null);
const scrollerRef = useRef<HTMLDivElement | null>(null);
```

#### 4.2.4 Efectos

```tsx
// cargar historial al montar o cambiar de proyecto
useEffect(() => {
  setMessages(readHistory(projectKey));
  setStreamingText('');
  setChatError(null);
}, [projectKey]);

// persistir historial cuando cambian los mensajes
useEffect(() => {
  if (projectKey) writeHistory(projectKey, messages);
}, [messages, projectKey]);

// persistir modelo
useEffect(() => { writeModel(model); }, [model]);

// auto-scroll al fondo si el usuario está cerca del fondo
useEffect(() => {
  const el = scrollerRef.current;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}, [messages, streamingText]);
```

#### 4.2.5 Función de envío

```tsx
const sendMessage = useCallback(async () => {
  const text = draft.trim();
  if (!text || isStreaming) return;

  const userMsg = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() };
  const historyForApi = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
  setMessages(prev => [...prev, userMsg]);
  setDraft('');
  setStreamingText('');
  setChatError(null);
  setIsStreaming(true);

  const ac = new AbortController();
  abortRef.current = ac;

  let acc = '';
  try {
    const res = await authenticatedFetch('/api/minimax/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: historyForApi, model }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      setChatError(`HTTP ${res.status}: ${errText || res.statusText}`);
      setIsStreaming(false);
      return;
    }
    if (!res.body) {
      setChatError('No response body (streaming unsupported)');
      setIsStreaming(false);
      return;
    }

    // SSE parser manual
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSSEBlock(block); // {event, data}
        if (!ev) continue;
        if (ev.event === 'delta' && ev.data?.text) {
          acc += ev.data.text;
          setStreamingText(acc);
        } else if (ev.event === 'done') {
          // se cierra abajo
        } else if (ev.event === 'error') {
          setChatError(ev.data?.message || 'mmx chat failed');
          acc = '';
        }
      }
    }
    if (acc) {
      const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: acc, ts: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);
    }
  } catch (e) {
    if (e?.name !== 'AbortError') {
      setChatError(e?.message || 'Network error');
    }
  } finally {
    setStreamingText('');
    setIsStreaming(false);
    abortRef.current = null;
  }
}, [draft, isStreaming, messages, model]);
```

#### 4.2.6 Helper `parseSSEBlock`

```tsx
function parseSSEBlock(block: string): { event: string; data: any } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: dataLines.join('\n') };
  }
}
```

#### 4.2.7 UI — sección "Chat"

```tsx
// dentro del return de MinimaxPanel, después del bloque "Authentication":

{auth && authLoggedIn && (
  <section className="rounded-xl border border-border bg-card/50 p-4">
    <header className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-medium text-foreground">Chat</h3>
      <div className="flex items-center gap-2">
        <input
          aria-label="Model"
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono"
          placeholder="MiniMax-M2.7"
          disabled={isStreaming}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm('Clear chat history for this project?')) {
              setMessages([]);
              setStreamingText('');
              setChatError(null);
            }
          }}
          disabled={isStreaming || messages.length === 0}
        >
          <Trash2 className="h-4 w-4" />
          <span className="ml-1.5">Clear</span>
        </Button>
      </div>
    </header>

    <div
      ref={scrollerRef}
      className="mb-3 h-80 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3"
    >
      {messages.length === 0 && !streamingText && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Ask the MiniMax-M2.7 model anything. History is saved in this browser.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {messages.map(m => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {isStreaming && (
          streamingText
            ? <ChatBubble role="assistant" content={streamingText} streaming />
            : <li className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking…
              </li>
        )}
      </ul>
    </div>

    {chatError && (
      <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        {chatError}
      </div>
    )}

    <div className="flex items-end gap-2">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void sendMessage();
          }
        }}
        rows={2}
        className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
        placeholder="Write a message… (Cmd/Ctrl + Enter to send)"
        disabled={isStreaming}
      />
      {isStreaming ? (
        <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
          <Square className="h-4 w-4" />
          <span className="ml-1.5">Stop</span>
        </Button>
      ) : (
        <Button size="sm" onClick={() => void sendMessage()} disabled={!draft.trim()}>
          <Send className="h-4 w-4" />
          <span className="ml-1.5">Send</span>
        </Button>
      )}
    </div>
  </section>
)}
```

#### 4.2.8 Sub-componente `ChatBubble`

```tsx
function ChatBubble({ role, content, streaming = false }) {
  const isUser = role === 'user';
  return (
    <li className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-purple-500">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-purple-500 text-white'
            : 'border border-border bg-card text-foreground'
        } ${streaming ? 'animate-pulse' : ''}`}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p        >
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </li>
  );
}
```

#### 4.2.9 Pasar `projectPath` (clave de namespace)

`MinimaxPanel.tsx` actualmente no recibe `projectPath`. En `src/components/main-content/view/MainContent.tsx:324-328`, pasar `selectedProject?.path ?? 'default'` como prop:

```tsx
{shouldShowMinimaxTab && activeTab === 'minimax' && (
  <div className="h-full overflow-hidden">
    <MinimaxPanel projectPath={selectedProject?.path ?? ''} />
  </div>
)}
```

Y en el componente:

```tsx
export default function MinimaxPanel({ projectPath = '' }: { projectPath?: string }) {
  // ...
  const projectKey = projectPath || 'default';
  // ...
}
```

#### 4.2.10 i18n — traducciones

Añadir las siguientes claves (estructura nueva: `minimax.chat.*`). Es ejemplo — los textos finales dependen del escaneo de lo ya presente en `common.json`:

`src/i18n/locales/en/common.json` (después de la línea 326, dentro del namespace `browserUse` o crear `minimax`):

```json
"minimax": {
  "chat": {
    "title": "Chat",
    "empty": "Ask the MiniMax-M2.7 model anything. History is saved in this browser.",
    "placeholder": "Write a message… (Cmd/Ctrl + Enter to send)",
    "send": "Send",
    "stop": "Stop",
    "clear": "Clear",
    "clearConfirm": "Clear chat history for this project?",
    "thinking": "Thinking…",
    "modelLabel": "Model",
    "errorAuth": "Sign in with `mmx auth login` to use the chat.",
    "errorCliMissing": "Install the `mmx` CLI to use the chat.",
    "errorGeneric": "Chat failed: {{message}}"
  }
}
```

`src/i18n/locales/es/common.json`: misma estructura en español.

---

## 5. Verificación previa obligatoria

### 5.1 Confirmar la forma del NDJSON

Antes de tocar nada, capturar el output real de `mmx text chat --stream --output json`:

```bash
mkdir -p /tmp/mmx-probe
printf '{"messages":[{"role":"user","content":"di ok en una palabra"}]}' \
  | mmx text chat --stream --output json --messages-file - --non-interactive --no-color \
    --timeout 30 \
    | tee /tmp/mmx-probe/chat.ndjson \
    | head -20
```

Pegar la salida en un comentario al inicio de `runMmxStream` en `server/utils/spawn-mmx.js`, por ejemplo:

```js
// Ejemplo de NDJSON real capturado 2026-07-13:
// {"type":"content_block_delta","delta":{"text":"ok"}}
// {"type":"message_stop"}
// (ajustar extractTextChunk según la forma real)
```

Ajustar `extractTextChunk()` en `server/minimax-proxy.js` para que matchee exactamente las claves devueltas. Si el output es vacío o no llega, capturar también stderr:

```bash
printf '{"messages":[{"role":"user","content":"ok"}]}' \
  | mmx text chat --stream --output json --messages-file - --non-interactive --no-color 2>&1 \
    | head -40
```

### 5.2 Comprobar que el modelo por defecto existe

```bash
mmx text chat --help | grep -i model
mmx config show --output json | jq '.default_model // empty'
```

---

## 6. Lista completa de archivos

| Archivo | Acción | Notas |
|---|---|---|
| `server/utils/spawn-mmx.js` | **crear** | `runMmxBuffered` + `runMmxStream` |
| `server/minimax-proxy.js` | **modificar** | Refactorizar para importar de `utils/spawn-mmx`; añadir `POST /chat` |
| `server/voice-proxy.js` | **modificar** | Reemplazar `runMmx` local por import desde `utils/spawn-mmx` |
| `src/components/main-content/view/MainContent.tsx` | **modificar** | Pasar `projectPath` a `<MinimaxPanel>` |
| `src/components/minimax-mcp/MinimaxPanel.tsx` | **modificar** | Añadir sección Chat completa (estado, efectos, UI, `ChatBubble`) |
| `src/i18n/locales/en/common.json` | **modificar** | Añadir `minimax.chat.*` |
| `src/i18n/locales/es/common.json` | **modificar** | Añadir `minimax.chat.*` en español |

**Archivos NO modificados (importante):**

- `server/index.js` — el router ya está mounted en `/api/minimax`.
- `src/types/app.ts`, `useProjectsState.ts`, `MainContentTabSwitcher.tsx` — no se añade `AppTab`.
- `src/components/chat/` (todo el módulo) — no se reusa; el chat mmx vive solo en MinimaxPanel.
- `server/modules/providers/` y `server/modules/database/` — no se introduce provider nuevo ni schema nuevo.
- `server/modules/websocket/` — no se usa `/ws`.
- `CLAUDE.md` — no requiere actualización: se siguen usando `MMX_BIN`, `MMX_TIMEOUT_MS` y ahora `MMX_CHAT_TIMEOUT_MS` (anotar si se quiere como variable de entorno opcional, pero no es bloqueante).

---

## 7. Funciones existentes reutilizadas

- `authenticatedFetch` (`src/utils/api.js`) — añade el header `Authorization`.
- `Button` (`src/shared/view/ui`) — variantes `outline` y `sm`.
- `Loader2`, `Sparkles`, `RefreshCw` (lucide-react) — ya importados. Se añaden `Send`, `Square`, `Trash2`, `MessageSquare`, `Bot`, `User`.
- Patrón SSE de `server/routes/agent.js:96-130` — inspiración; `runMmxStream` es nuestro equivalente stream-only.
- `MMX_BIN`, `MMX_TIMEOUT_MS` (`CLAUDE.md`) — centralizados en `spawn-mmx.js`.

**Lo que NO se reusa (y por qué):**

- `ChatComposer` (`src/components/chat/view/...`) — acoplado a provider system + websocket + sesiones. No vale reusarlo; se duplica la UI mínima (~20 líneas).
- `useChatRealtimeHandlers` — atado al envelope del WebSocket `/ws`. Su contraparte SSE es `parseSSEBlock` inline (~10 líneas).
- `queryClaudeSDK` / `queryCodex` — son SDK wrappers; para mmx podemos spawnear directo.

---

## 8. Cómo verificar end-to-end

### Pre-flight

```bash
# 1. Typecheck ambos paquetes
npm run typecheck

# 2. Lint
npm run lint
```

### Backend

```bash
# 3. Probe NDJSON (de §5.1) — confirmar la forma exacta
mkdir -p /tmp/mmx-probe
printf '{"messages":[{"role":"user","content":"resume el repo en 5 palabras"}]}' \
  | mmx text chat --stream --output json --messages-file - --non-interactive --no-color \
    --timeout 30 > /tmp/mmx-probe/out.ndjson 2> /tmp/mmx-probe/err.log
echo "--- stdout ---"; cat /tmp/mmx-probe/out.ndjson | head -10
echo "--- stderr ---"; cat /tmp/mmx-probe/err.log | head -10
```

Esperado: varias líneas JSON válidas, sin texto vacío.

```bash
# 4. Arrancar backend en modo watch
npm run server:dev-watch
```

En otra terminal:

```bash
# 5. Probar el endpoint manualmente
TOKEN=$(...)  # tu Bearer token de /api/auth/login

curl -N -X POST http://localhost:3001/api/minimax/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"resume opencli en 5 palabras"}],"model":"MiniMax-M2.7"}' \
  --max-time 60
```

Esperado:
```
event: delta
data: {"text":"..."}

event: delta
data: {"text":"..."}

event: done
data: {"text":"...completo..."}
```

Verificar:

- Sin header `Content-Type: application/json` (debe ser `text/event-stream`).
- No se imprime stack trace en el log del servidor.
- Cancelar con `Ctrl+C` durante la respuesta → no quedan procesos `mmx` huérfanos (`pgrep -af mmx`).

### Frontend

```bash
# 6. Arrancar todo
npm run dev
```

Login → abrir cualquier proyecto → tab **Minimax MCP**.

| # | Acción | Resultado esperado |
|---|---|---|
| 1 | Scroll abajo hasta "Chat" | Aparece la sección con textarea vacío y mensaje "Ask the MiniMax-M2.7 model anything…" |
| 2 | Escribir "hola" y pulsar Send | Respuesta del modelo streamea token por token. Botón Send → Stop. |
| 3 | Recargar (F5) | Historial sigue ahí (mensajes en localStorage). |
| 4 | Cambiar proyecto activo | El historial cambia al namespace del otro proyecto. |
| 5 | Click "Clear" → confirmar | Lista vacía, `localStorage` borrado, composer listo. |
| 6 | Click Stop mid-stream | Aborta, último mensaje parcial queda en la lista. |
| 7 | `mmx auth logout` + recargar | Composer deshabilitado y mensaje de fallback. |
| 8 | Renombrar `/usr/local/bin/mmx` a `mmx.bak` + recargar | Mensaje "Install the `mmx` CLI". |
| 9 | Devolver `mmx` y `mmx auth login --api-key sk-...` + recargar | Composer vuelve a estar usable. |
| 10 | Cambiar modelo en el input a `MiniMax-M2.7-highspeed` y enviar | Modelo alternativo responde. Persiste tras recargar. |
| 11 | `Ctrl+Enter` en el textarea | Envía sin pulsar Send. |

### Regresiones a revisar

- Las secciones "Subscription" y "Authentication" siguen funcionando idéntico a antes (no se rompieron al añadir el state de chat).
- El polling de 60 s (`setInterval`) sigue activo.
- Los banners de fallback ("mmx not found", "not signed in") siguen apareciendo en las mismas condiciones.
- Las traducciones (al cambiar idioma) funcionan en toda la sección Chat.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El formato NDJSON real difiere de `extractTextChunk` | Verificación previa §5.1 obligatoria. Único punto a tocar: `extractTextChunk()` y el comentario al inicio de `runMmxStream`. |
| El usuario abandona la pestaña durante un stream → proceso `mmx` huérfano | `req.on('close')` llama a `child.kill('SIGKILL')`. Log de "client disconnected" para auditoría. |
| `localStorage` excede quota (5–10 MB) | Cap `MAX_HISTORY_MESSAGES = 200`. Try/catch silencioso en `writeHistory`. UI muestra toast si quisiéramos en el futuro. |
| El usuario pegua código con caracteres Unicode raros (p.ej. emoji, RTL) | Codificación del frontend: `TextDecoder('utf-8')`. Backend: lee como `'utf8'`. Sin BOM ni problemas binarios esperados. |
| Respuestas muy largas ralentizan el scroll | Auto-scroll solo si el usuario está cerca del fondo. Si el usuario scrolleó arriba, no se le molesta. |
| Concurrencia: dos pestañas abiertas del mismo proyecto | Cada pestaña tiene su propio `AbortController` y su propio historial en memoria. La última en escribir "gana" en localStorage. No es un bug — comportamiento esperado para localStorage. |
| El usuario usa el chat en paralelo con `/shell` o `/ws` | Los sockets son independientes. Sin interferencia. |
| `runMmx()` duplicado causa drift entre `voice-proxy` y `minimax-proxy` | Resolvemos extrayendo a `utils/spawn-mmx.js`. Verificación: `git grep "function runMmx"` solo debe mostrar la definición nueva. |

---

## 10. Out of scope explícito

Lo siguiente **no** se implementa en este PR y queda para iteraciones futuras:

1. **Adjuntar imágenes o archivos al chat.** `mmx text chat` v1 no soporta `--image`; el multimodal está en `mmx vision describe`. Lo natural sería: subir el archivo vía `mmx file upload --purpose vision`, obtener `file_id`, y enviar como parte del mensaje. Requiere:
   - Endpoint para subir (`POST /api/minimax/files`)
   - UI para arrastrar/soltar
   - Cambio en el formato de mensajes para incluir `file_id`s
2. **Tool calling.** `mmx text chat` soporta `--tool` (repeatable) pero esto implica definir herramientas, manejar `tool_use` / `tool_result` en el envelope, y reescribir partes del flujo. Otro PR.
3. **Conteo de tokens y precio.** `mmx text chat --output json` no expone usage en v1. Alternativa barata: contador de caracteres + estimación por longitud media de palabra (~1.3 tokens/palabra).
4. **Provider completo estilo Claude/Codex** (sesiones en SQLite, sync de archivos, history pagination desde el frontend). Eso implicaría crear `server/modules/providers/list/mmx/` y todos los adaptadores (`-auth`, `-sessions`, etc.). Mucho más invasivo — solo tiene sentido si el uso del chat lo justifica.
5. **Soporte para varios chats por proyecto** (no solo un único historial). Requeriría selector de "conversación" y migración a SQLite.
6. **`mmx text repl` (PTY).** Descartado. Si en el futuro alguien quiere REPL de verdad (con slash-commands, colores), tendría que añadirse soporte de `node-pty` y otro endpoint dedicado.

---

## 11. Checklist de PR

- [ ] Smoke test NDJSON capturado y comentado
- [ ] `runMmxStream` implementado y probado con `extractTextChunk` adecuado
- [ ] `runMmxBuffered` extraído a `spawn-mmx.js`, `voice-proxy.js` y `minimax-proxy.js` migrados sin regresión
- [ ] `POST /api/minimax/chat` añadido al router; responde SSE correcto
- [ ] Cliente aborta child al cerrar conexión
- [ ] `MinimaxPanel` extendido con sección Chat funcional
- [ ] `projectPath` thread de `MainContent` al panel
- [ ] Persistencia en localStorage por proyecto, con cap de 200 mensajes
- [ ] i18n añadida en `en` y `es`
- [ ] `npm run typecheck` y `npm run lint` pasan
- [ ] Verificación manual end-to-end (tabla §8) pasada
- [ ] PR con descripción, screenshots del panel antes/después, y snippet de un stream de curl
