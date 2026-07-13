import type { Server as HttpServer } from 'node:http';

import { WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { terminalService } from '@/modules/terminal/terminal.service.js';
import { handleTerminalShellConnection } from '@/modules/terminal/terminal-websocket.service.js';
import { handleDesktopNotificationsConnection } from '@/modules/notifications/index.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketServerDependencies = {
  verifyClient: Parameters<typeof verifyWebSocketClient>[1];
  chat: Parameters<typeof handleChatConnection>[2];
  shell: Parameters<typeof handleShellConnection>[1];
};

/**
 * Creates and wires the server-wide websocket gateway used for chat, shell,
 * terminal-shell, and desktop-notifications paths.
 */
export function createWebSocketServer(
  server: HttpServer,
  dependencies: WebSocketServerDependencies
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    verifyClient: ((
      info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0]
    ) => verifyWebSocketClient(info, dependencies.verifyClient)),
  });

  wss.on('connection', (ws, request) => {
    // Keep WebSocket alive across reverse-proxy idle timeouts (Cloudflare ~100s,
    // AWS ALB 60s, nginx 60s, etc.). Without app-level pings these connections
    // are silently torn down even when the UI is active, causing repeated
    // reconnect cycles. ws library heartbeat is opt-in.
    const HEARTBEAT_INTERVAL_MS = 30_000;
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.ping();
        } catch {
          // socket may have been closed concurrently — interval will be cleared below
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    const stopHeartbeat = () => clearInterval(heartbeat);
    ws.on('close', stopHeartbeat);
    ws.on('error', stopHeartbeat);

    const incomingRequest = request as AuthenticatedWebSocketRequest;
    const url = incomingRequest.url ?? '/';
    const pathname = new URL(url, 'http://localhost').pathname;

    if (pathname === '/shell') {
      // Kill-switch: when the user disables Terminal in Settings, refuse new
      // WS upgrades. Already-open PTY sessions are NOT killed (they continue
      // until the client closes the socket or `ptySessionsMap` reaps them
      // after 30 minutes of inactivity).
      if (!terminalService.isEnabled()) {
        ws.close(4403, 'Terminal disabled');
        return;
      }
      handleShellConnection(ws, dependencies.shell);
      return;
    }

    if (pathname === '/terminal-shell') {
      // Plain bash PTY for the Terminal module — independent of the agent's
      // /shell session lifecycle. Subject to the same kill-switch above.
      if (!terminalService.isEnabled()) {
        ws.close(4403, 'Terminal disabled');
        return;
      }
      handleTerminalShellConnection(ws);
      return;
    }

    if (pathname === '/ws') {
      handleChatConnection(ws, incomingRequest, dependencies.chat);
      return;
    }

    if (pathname === '/desktop-notifications') {
      handleDesktopNotificationsConnection(ws, incomingRequest);
      return;
    }

    console.log('[WARN] Unknown WebSocket path:', pathname);
    ws.close();
  });

  return wss;
}
