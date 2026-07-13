import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { Button } from '../../shared/view/ui';
import { authenticatedFetch } from '../../utils/api';

type MinimaxHealth = {
  configured?: boolean;
  version?: string;
  error?: string;
};

type MinimaxAuth = {
  configured?: boolean;
  method?: string;
  source?: string;
  key?: string;
  error?: string;
  [key: string]: unknown;
};

type QuotaRow = {
  name: string;
  intervalPercent: number | null;
  weeklyPercent: number | null;
  resetText: string;
  // Extra raw fields shown only if the panel needs to surface them later.
  raw: Record<string, unknown>;
};

type ParsedQuota = {
  rows: QuotaRow[];
  raw: string;
  format: 'json' | 'table' | 'unknown';
};

// Formats a millisecond count as "Xh Ym" or "Xd Yh" or "Ym" or "Ys".
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Tries to parse `mmx quota show` output. Supports both the JSON envelope
// (`{ model_remains: [...] }`) and the bordered-table text format. If neither
// matches we hand back the raw text so the caller can still render it.
function parseQuotaOutput(raw: string): ParsedQuota {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { rows: [], raw, format: 'unknown' };
  }

  // 1) JSON path: starts with `{` and has a `model_remains` array (or any
  //    array under the top-level object whose entries expose a `model_name`).
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      const rows: QuotaRow[] = [];

      // Look for the canonical `model_remains` field first.
      const candidates: Array<{ key: string; value: unknown }> = [];
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) {
          candidates.push({ key: k, value: v });
        }
      }

      const extractRows = (entry: unknown): QuotaRow | null => {
        if (!entry || typeof entry !== 'object') return null;
        const obj = entry as Record<string, unknown>;
        const name = typeof obj.model_name === 'string' ? obj.model_name : null;
        if (!name) return null;
        const interval = typeof obj.current_interval_remaining_percent === 'number'
          ? obj.current_interval_remaining_percent : null;
        const weekly = typeof obj.current_weekly_remaining_percent === 'number'
          ? obj.current_weekly_remaining_percent : null;
        const resetMs = typeof obj.remains_time === 'number' ? obj.remains_time : null;
        const resetText = resetMs !== null ? formatMs(resetMs) : '—';
        return { name, intervalPercent: interval, weeklyPercent: weekly, resetText, raw: obj };
      };

      // Prefer `model_remains`; fall back to the first array of objects that
      // has a `model_name` field on at least one entry.
      const canonical = data.model_remains;
      if (Array.isArray(canonical)) {
        for (const entry of canonical) {
          const row = extractRows(entry);
          if (row) rows.push(row);
        }
      }
      if (rows.length === 0) {
        for (const cand of candidates) {
          for (const entry of cand.value as unknown[]) {
            const row = extractRows(entry);
            if (row) { rows.push(row); break; }
          }
          if (rows.length > 0) break;
        }
      }
      if (rows.length > 0) {
        return { rows, raw, format: 'json' };
      }
    } catch {
      // Fall through to table parser.
    }
  }

  // 2) Table path: pipe-delimited rows like
  //    │ <name>  Left  37%  Wk left  93%  Reset 2h 24m   │
  const rowRe = /│\s*([A-Za-z][\w-]*)\s+Left\s+(\d+)%\s+Wk\s+left\s+(\d+)%\s+Reset\s+(\S[^│]*?)\s*│/;
  const tableRows: QuotaRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = rowRe.exec(line);
    if (m) {
      tableRows.push({
        name: m[1],
        intervalPercent: Number(m[2]),
        weeklyPercent: Number(m[3]),
        resetText: m[4].trim(),
        raw: {},
      });
    }
  }
  if (tableRows.length > 0) {
    return { rows: tableRows, raw, format: 'table' };
  }

  return { rows: [], raw, format: 'unknown' };
}

async function readJsonOrNull<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    const data = await response.json();
    if (data && typeof data === 'object' && 'success' in data && data.success === false) {
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

export default function MinimaxPanel() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<MinimaxHealth | null>(null);
  const [auth, setAuth] = useState<MinimaxAuth | null>(null);
  const [quotaRaw, setQuotaRaw] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setQuotaError(null);
    try {
      const [healthRes, authRes, quotaRes] = await Promise.all([
        authenticatedFetch('/api/minimax/health'),
        authenticatedFetch('/api/minimax/auth'),
        authenticatedFetch('/api/minimax/quota/text'),
      ]);
      const [healthData, authData] = await Promise.all([
        readJsonOrNull<MinimaxHealth>(healthRes),
        readJsonOrNull<MinimaxAuth>(authRes),
      ]);
      setHealth(healthData);
      setAuth(authData);
      if (quotaRes.ok) {
        setQuotaRaw(await quotaRes.text());
      } else {
        const errText = await quotaRes.text();
        setQuotaRaw(null);
        setQuotaError(errText || `HTTP ${quotaRes.status}`);
      }
    } catch (err) {
      setQuotaError(err instanceof Error ? err.message : 'Failed to load MiniMax MCP data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const cliInstalled = health?.configured === true;
  const authLoggedIn = auth?.configured === true;
  const quota = useMemo(() => (quotaRaw ? parseQuotaOutput(quotaRaw) : null), [quotaRaw]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">{t('tabs.minimax')}</h2>
              <p className="text-sm text-muted-foreground">
                {health?.version ? `mmx ${health.version}` : 'MiniMax MCP subscription'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </header>

        {!cliInstalled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            The <code>mmx</code> CLI was not found on PATH. Install it to populate subscription data here.
          </div>
        )}

        {cliInstalled && !authLoggedIn && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Sign in with <code>mmx auth login</code> to authenticate the MCP subscription.
          </div>
        )}

        <section className="rounded-xl border border-border bg-card/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">Subscription</h3>

          {quotaError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {quotaError}
            </div>
          )}

          {!quota && !quotaError && isLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading quota…
            </div>
          )}

          {quota && quota.rows.length === 0 && (
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-foreground">
              {quota.raw || 'No quota output returned by mmx.'}
            </pre>
          )}

          {quota && quota.rows.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quota.rows.map((row) => (
                <QuotaCard key={row.name} row={row} />
              ))}
            </div>
          )}
        </section>

        {auth && authLoggedIn && (
          <section className="rounded-xl border border-border bg-card/50 p-4">
            <h3 className="mb-2 text-sm font-medium text-foreground">Authentication</h3>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Method</dt>
                <dd className="text-sm font-medium text-foreground">{auth.method || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source</dt>
                <dd className="truncate text-sm font-medium text-foreground">{auth.source || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Key</dt>
                <dd className="truncate text-sm font-medium text-foreground">{auth.key || '—'}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function QuotaCard({ row }: { row: QuotaRow }) {
  const label = row.name.charAt(0).toUpperCase() + row.name.slice(1);
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">Resets in {row.resetText}</span>
      </div>
      <Meter label="This interval" percent={row.intervalPercent} />
      <Meter label="This week" percent={row.weeklyPercent} subtle />
    </div>
  );
}

function Meter({ label, percent, subtle }: { label: string; percent: number | null; subtle?: boolean }) {
  if (percent === null) {
    return (
      <div className={`mb-1.5 last:mb-0 ${subtle ? 'opacity-80' : ''}`}>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className={subtle ? 'text-muted-foreground' : 'font-medium text-foreground'}>{label}</span>
          <span className="text-muted-foreground">—</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" />
      </div>
    );
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 60 ? 'bg-emerald-500' : clamped >= 25 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={`mb-1.5 last:mb-0 ${subtle ? 'opacity-80' : ''}`}>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className={subtle ? 'text-muted-foreground' : 'font-medium text-foreground'}>{label}</span>
        <span className="font-mono text-foreground">{clamped}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
