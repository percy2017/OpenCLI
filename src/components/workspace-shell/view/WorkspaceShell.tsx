import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

import '@xterm/xterm/css/xterm.css';

type Props = { isActive: boolean };

const WORKSPACES_ROOT =
  (import.meta.env.VITE_WORKSPACES_ROOT as string | undefined) || '/';

export default function WorkspaceShell({ isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#000000', foreground: '#ffffff' },
      allowProposedApi: true,
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // fall back to default canvas renderer
    }

    term.open(container);
    fit.fit();

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const sendResize = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }),
        );
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // container not yet sized
      }
      sendResize();
    });
    resizeObserver.observe(container);

    // Get auth token from existing auth storage
    const token = localStorage.getItem('auth-token') || '';

    // Build websocket URL the same way the existing Shell component does.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/shell?token=${encodeURIComponent(token)}`;

    let stopped = false;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'init',
          projectPath: WORKSPACES_ROOT,
          cwd: WORKSPACES_ROOT,
          sessionId: null,
          hasSession: false,
          provider: 'plain-shell',
          isPlainShell: true,
          initialCommand: null,
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'error' && typeof msg.message === 'string') {
          term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        // malformed frame — ignore
      }
    };

    socket.onerror = () => {
      if (!stopped) setError('WebSocket error (check auth / server)');
    };

    socket.onclose = () => {
      // nothing to do — user can refresh to reconnect
    };

    return () => {
      stopped = true;
      resizeObserver.disconnect();
      try {
        socket.close();
      } catch {
        // already closed
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Focus on tab activate.
  useEffect(() => {
    if (isActive) {
      termRef.current?.focus();
    }
  }, [isActive]);

  if (error) {
    return (
      <div className="h-full w-full bg-black p-4 font-mono text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-black p-2"
      style={{ minHeight: 0 }}
    />
  );
}