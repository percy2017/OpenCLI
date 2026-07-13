/**
 * Plain Linux shell view for the Terminal module.
 *
 * Mounts xterm.js + a dedicated WebSocket connection to `/terminal-shell`.
 * Unlike the agent-facing `/shell` endpoint (which is wired to Claude Code
 * via the `StandaloneShell` reuse), this endpoint just spawns a `bash` PTY
 * and pipes stdin/stdout. Mirrors what the legacy `cloudcli-plugin-terminal`
 * plugin did via its own subprocess.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Project } from '../../../types/app';

import '@xterm/xterm/css/xterm.css';

import { TERMINAL_OPTIONS } from '../../shell/constants/constants';

type TerminalShellViewProps = {
  project: Project | null;
  isActive: boolean;
};

function buildWebSocketUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = window.localStorage.getItem('auth-token');
  if (!token) return null;
  return `${proto}//${host}/terminal-shell?token=${encodeURIComponent(token)}`;
}

function debugLog(...args: unknown[]): void {
  // Surface in the browser console so we can see exactly what the client
  // is doing when the WS fails.
  // eslint-disable-next-line no-console
  console.log('[terminal-module]', ...args);
}

type SocketMessage = {
  type?: string;
  data?: string;
  exitCode?: number;
  signal?: string | null;
  message?: string;
};

export default function TerminalShellView({ project, isActive }: TerminalShellViewProps) {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const url = buildWebSocketUrl();
    if (!url) {
      debugLog('no auth token, aborting WS open');
      setStatus('error');
      setErrorMessage(t('terminal.overlayError'));
      return undefined;
    }

    debugLog('opening WS', url);

    const term = new XTerm(TERMINAL_OPTIONS);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // Track readiness — calling fit.fit() before xterm's renderer has real
    // dimensions throws "Cannot read properties of undefined (reading
    // 'dimensions')" inside RenderService. Defer every fit() until the
    // container has a measured size and xterm has had a frame to initialize.
    let rendererReady = false;
    const safeFit = () => {
      if (
        !rendererReady ||
        container.clientWidth <= 0 ||
        container.clientHeight <= 0
      ) {
        return;
      }
      try {
        fit.fit();
      } catch {
        // Renderer not ready yet — the next ResizeObserver tick will retry.
      }
    };

    terminalRef.current = term;
    fitAddonRef.current = fit;

    // Initial fit + focus on the next frame so xterm can finish laying out.
    window.requestAnimationFrame(() => {
      rendererReady = true;
      safeFit();
      try {
        term.focus();
      } catch {
        // ignore
      }
    });

    term.writeln('\x1b[36mConnecting to terminal module...\x1b[0m');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      debugLog('WS open');
      setStatus('connected');
      setErrorMessage(null);
      const sendInit = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Make sure xterm has dimensions before we report them to the server.
        safeFit();
        const cols = term.cols || 80;
        const rows = term.rows || 24;
        ws.send(
          JSON.stringify({
            type: 'init',
            cwd: project?.fullPath || project?.path || '',
            cols,
            rows,
          }),
        );
      };
      // Wait one frame so terminal has dimensions before sending init.
      setTimeout(sendInit, 100);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SocketMessage;
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'error') {
          term.writeln(`\r\n\x1b[31m[error] ${msg.message ?? 'unknown'}\x1b[0m`);
          setErrorMessage(msg.message ?? 'unknown error');
          setStatus('error');
        } else if (msg.type === 'exit') {
          term.writeln(
            `\r\n\x1b[33m[shell exited code=${msg.exitCode ?? '?'}${
              msg.signal ? ` signal=${msg.signal}` : ''
            }]\x1b[0m\r\n`,
          );
          setStatus('closed');
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = (event) => {
      debugLog('WS error event', event);
      setStatus('error');
      setErrorMessage(t('terminal.overlayError'));
    };

    ws.onclose = (event) => {
      debugLog('WS close', { code: event.code, reason: event.reason, wasClean: event.wasClean });
      if (event.code === 4403) {
        setStatus('error');
        setErrorMessage(t('terminal.disabledTitle'));
      } else if (event.code !== 1000) {
        setStatus('error');
        setErrorMessage(t('terminal.overlayError'));
      } else {
        setStatus('closed');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      safeFit();
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }),
          );
        } catch {
          // ignore resize errors during teardown
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // We intentionally do NOT re-run on project changes — closing/reopening
    // the WS mid-session would kill the user's running shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus management when the tab becomes active.
  useEffect(() => {
    if (isActive && terminalRef.current) {
      try {
        terminalRef.current.focus();
      } catch {
        // renderer may not be ready yet — safe to ignore
      }
    }
  }, [isActive]);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#1e1e1e]">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
      {(status === 'connecting' || status === 'error' || status === 'closed') && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <div className="pointer-events-auto rounded-md border border-border bg-background/95 px-3 py-2 text-xs text-foreground shadow-md">
            {status === 'connecting' && (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('terminal.overlayConnecting')}
              </span>
            )}
            {status === 'error' && (
              <span className="flex items-center gap-2 text-red-500">
                {errorMessage ?? t('terminal.overlayError')}
              </span>
            )}
            {status === 'closed' && (
              <span className="flex items-center gap-2 text-muted-foreground">
                {t('terminal.overlayClosed')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}