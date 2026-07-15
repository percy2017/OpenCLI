// Hook that drives the RAG MCP install status card on the
// Settings → Agents → Claude → MCP page.
//
// Mirrors the plain-React-state pattern used by `useMcpServers` (no React
// Query / SWR in this codebase). Owns:
//   - the latest `InstallerSummary` from `GET /api/first-run/rag-status`
//   - an `isRetrying` flag for the spinner swap in the card button
//   - a transient error message surfaced from the most recent failed retry
//
// The retry POST hits `POST /api/first-run/rag-status/retry`, which clears
// the backend sentinel and re-runs `ensureRagMcpOnStartup`. Concurrent
// retries are deduped by the installer's `installPromise` singleton — we do
// NOT clear that here, because two installs racing against the same
// `.venv` would corrupt the editable install.

import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export type RagMcpInstallSummary =
  | {
      status: 'installed';
      manager: 'uv' | 'pip';
      commandPath: string;
      lastUpdated: string;
    }
  | {
      status: 'pending';
      reason: 'never-installed' | 'version-mismatch';
    }
  | {
      status: 'failed';
      reason:
        | 'health-check-failed'
        | 'install-failed'
        | 'no-package-manager'
        | 'pyproject-missing'
        | 'unsupported-platform';
      message?: string;
      platform?: string;
      ragDir?: string;
    };

type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: string };

const STATUS_ENDPOINT = '/api/first-run/rag-status';
const RETRY_ENDPOINT = '/api/first-run/rag-status/retry';

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success) {
    const message =
      !payload.success && typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload.data;
}

export type UseRagMcpInstallResult = {
  state: RagMcpInstallSummary | null;
  isRetrying: boolean;
  errorMessage: string | null;
  lastUpdated: string | null;
  refreshStatus: () => Promise<void>;
  retryInstall: () => Promise<void>;
};

export function useRagMcpInstall(): UseRagMcpInstallResult {
  const [state, setState] = useState<RagmcpInstallStatePlaceholder>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref tracks the in-flight refresh so we can cancel/ignore stale responses
  // if the component unmounts before the GET resolves.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await authenticatedFetch(STATUS_ENDPOINT);
      const data = await readEnvelope<RagMcpInstallSummary>(response);
      if (!mountedRef.current) return;
      setState(data);
      setErrorMessage(null);
    } catch (error) {
      if (!mountedRef.current) return;
      // Surface as a soft error — the card renders a Retry button either way.
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const retryInstall = useCallback(async () => {
    if (isRetrying) return; // belt-and-suspenders: the button is `disabled` too
    setIsRetrying(true);
    setErrorMessage(null);
    try {
      const response = await authenticatedFetch(RETRY_ENDPOINT, { method: 'POST' });
      const data = await readEnvelope<RagMcpInstallSummary>(response);
      if (!mountedRef.current) return;
      setState(data);
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (mountedRef.current) setIsRetrying(false);
    }
  }, [isRetrying]);

  // Initial load. Skipped when the platform mode or auth gating means the
  // endpoint will 401 — the caller (the card) hides itself in that case so
  // the empty initial state is acceptable.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const lastUpdated =
    state && state.status === 'installed' ? state.lastUpdated : null;

  return {
    state,
    isRetrying,
    errorMessage,
    lastUpdated,
    refreshStatus,
    retryInstall,
  };
}

// Local alias kept tiny so the import surface above stays readable.
type RagmcpInstallStatePlaceholder = RagMcpInstallSummary | null;
