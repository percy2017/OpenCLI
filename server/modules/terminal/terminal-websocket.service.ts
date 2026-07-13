/**
 * WebSocket handler for the new Terminal module.
 *
 * Unlike `/shell` (which is wired to a provider/session lifecycle for the
 * agent's shell), this endpoint spawns a plain `bash` PTY directly so the
 * user can interact with a clean Linux shell. There is no provider, no
 * session reuse, no Claude Code wrapper.
 *
 * The kill-switch is enforced by the WS router in `websocket-server.service.ts`
 * — if `terminal_enabled` is false in `app_config`, the connection is closed
 * with code 4403 before this handler is invoked.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pty, { type IPty } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

type TerminalIncomingMessage = {
  type?: string;
  data?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
};

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTerminalMessage(rawMessage: RawData): TerminalIncomingMessage | null {
  try {
    const text = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');
    if (!text) return null;
    return JSON.parse(text) as TerminalIncomingMessage;
  } catch {
    return null;
  }
}

export function handleTerminalShellConnection(ws: WebSocket): void {
  console.log('[INFO] Terminal module shell connected');

  let shellProcess: IPty | null = null;
  const livePtys = new Set<IPty>();

  ws.on('message', (rawMessage) => {
    const data = parseTerminalMessage(rawMessage);
    if (!data?.type) {
      ws.send(
        JSON.stringify({
          type: 'output',
          data: '\r\n\x1b[31m[error] invalid payload\x1b[0m\r\n',
        }),
      );
      return;
    }

    if (data.type === 'init') {
      const cwd = readString(data.cwd, process.cwd());
      const resolvedCwd = path.resolve(cwd);
      console.log(`[INFO] Terminal module: init cwd=${resolvedCwd}`);

      try {
        const stats = fs.statSync(resolvedCwd);
        if (!stats.isDirectory()) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid working directory' }));
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid working directory' }));
        return;
      }

      const cols = readNumber(data.cols, 80);
      const rows = readNumber(data.rows, 24);
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      // No startup args: bash reads from the PTY slave set up by node-pty.
      // We deliberately avoid `-i` (loads .bashrc which can call `return` and
      // immediately exit the non-interactive PTY) and `--login` (some configs
      // exec another shell that doesn't preserve the PTY).
      const shellArgs: string[] = os.platform() === 'win32' ? ['-NoLogo'] : [];

      try {
        shellProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: resolvedCwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '3',
          },
        });
        console.log(`[INFO] Terminal module: spawned bash pid=${shellProcess.pid} cwd=${resolvedCwd}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ws.send(JSON.stringify({ type: 'error', message: `Failed to spawn shell: ${message}` }));
        return;
      }

      livePtys.add(shellProcess);

      shellProcess.onData((chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: chunk }));
        }
      });

      shellProcess.onExit(({ exitCode, signal }) => {
        console.log(`[WARN] Terminal module: bash exited code=${exitCode} signal=${signal ?? 'none'}`);
        livePtys.delete(shellProcess as IPty);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'exit',
              exitCode,
              signal: signal ?? null,
            }),
          );
        }
        shellProcess = null;
      });

      ws.send(
        JSON.stringify({
          type: 'output',
          data: `\x1b[36m[terminal module] bash in ${resolvedCwd}\x1b[0m\r\n`,
        }),
      );
      return;
    }

    if (data.type === 'input') {
      if (shellProcess) {
        shellProcess.write(readString(data.data));
      }
      return;
    }

    if (data.type === 'resize') {
      if (shellProcess) {
        shellProcess.resize(readNumber(data.cols, 80), readNumber(data.rows, 24));
      }
    }
  });

  ws.on('close', () => {
    livePtys.forEach((proc) => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    });
    livePtys.clear();
    shellProcess = null;
  });

  ws.on('error', (error) => {
    console.error('[ERROR] Terminal module shell WebSocket error:', error);
  });
}