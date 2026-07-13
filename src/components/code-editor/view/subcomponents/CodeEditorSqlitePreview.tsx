import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Database, Loader2, RefreshCw, Search } from 'lucide-react';

import { Button, Input } from '../../../../shared/view/ui';
import { api } from '../../../../utils/api';
import type { CodeEditorFile } from '../../types/types';

type CodeEditorSqlitePreviewProps = {
  file: CodeEditorFile;
  projectId?: string;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  labels: {
    loading: string;
    error: string;
    fullscreen: string;
    exitFullscreen: string;
    close: string;
    tables: string;
    filterTables: string;
    noTables: string;
    selectTable: string;
    rows: string;
    columns: string;
    prev: string;
    next: string;
    emptyTable: string;
    refresh: string;
  };
};

type TableSummary = { name: string; rowCount: number | null; error?: string };
type ColumnInfo = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
};
type TablesResponse = {
  tables: TableSummary[];
  fileSize: number;
  pageSize: number;
  pageCount: number;
};
type TableResponse = {
  table: string;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 100;

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString();
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && value.length > 200) {
    return value.slice(0, 200) + '…';
  }
  return String(value);
};

export default function CodeEditorSqlitePreview({
  file,
  projectId,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  labels,
}: CodeEditorSqlitePreviewProps) {
  const [tablesData, setTablesData] = useState<TablesResponse | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tablesLoading, setTablesLoading] = useState(true);

  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const [tableData, setTableData] = useState<TableResponse | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // Source key — when the editor reuses this component instance across files
  // we must drop stale state, the same way CodeEditorMediaPreview does.
  const sourceKey = `${projectId ?? ''}:${file.path}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const loadTables = useCallback(async () => {
    if (!projectId) return;
    setTablesLoading(true);
    setTablesError(null);
    try {
      const response = await api.getSqliteTables(projectId, file.path);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to read database (${response.status})`);
      }
      const data: TablesResponse = await response.json();
      setTablesData(data);
      if (data.tables.length > 0) {
        setActiveTable((current) => current ?? data.tables[0].name);
      }
    } catch (err) {
      setTablesError((err as Error).message);
    } finally {
      setTablesLoading(false);
    }
  }, [projectId, file.path]);

  const loadTable = useCallback(async () => {
    if (!projectId || !activeTable) return;
    setTableLoading(true);
    setTableError(null);
    try {
      const response = await api.getSqliteTable(projectId, {
        path: file.path,
        table: activeTable,
        limit: PAGE_SIZE,
        offset,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to read table (${response.status})`);
      }
      const data: TableResponse = await response.json();
      setTableData(data);
    } catch (err) {
      setTableError((err as Error).message);
    } finally {
      setTableLoading(false);
    }
  }, [projectId, file.path, activeTable, offset]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    void loadTable();
  }, [loadTable]);

  useEffect(() => {
    setOffset(0);
  }, [activeTable]);

  // Commit the load key only after both fetches for this source are settled,
  // so a switch mid-flight never leaves a stale table painted.
  useEffect(() => {
    if (!tablesLoading && !tableLoading) {
      setLoadedKey(sourceKey);
    }
  }, [tablesLoading, tableLoading, sourceKey]);

  // If the source changes (different file), drop everything immediately.
  useEffect(() => {
    return () => setLoadedKey(null);
  }, [sourceKey]);

  const isCurrentSource = loadedKey === sourceKey;

  const filteredTables = useMemo(() => {
    if (!tablesData) return [];
    if (!tableFilter.trim()) return tablesData.tables;
    const needle = tableFilter.trim().toLowerCase();
    return tablesData.tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tablesData, tableFilter]);

  const total = tableData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const header = (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Database className="h-4 w-4 shrink-0 text-blue-500" />
        <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">
          {file.name}
        </h3>
        {tablesData && (
          <span className="truncate text-xs text-muted-foreground">
            · {formatBytes(tablesData.fileSize)} · {formatNumber(tablesData.tables.length)}{' '}
            {labels.tables}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => void loadTables()}
          className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label={labels.refresh}
          title={labels.refresh}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {!isSidebar && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isFullscreen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 9V4.5M9 9H4.5M9 9L3.5 3.5M9 15v4.5M9 15H4.5M9 15l-5.5 5.5M15 9h4.5M15 9V4.5M15 9l5.5-5.5M15 15h4.5M15 15v4.5m0-4.5l5.5 5.5"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              )}
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label={labels.close}
          title={labels.close}
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  const sidebarLayout = (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {header}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar — table list */}
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-muted/20">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
                placeholder={labels.filterTables}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-1 py-1">
            {tablesLoading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                {labels.loading}
              </div>
            ) : tablesError ? (
              <p className="px-2 py-3 text-xs text-red-600 dark:text-red-400">{tablesError}</p>
            ) : filteredTables.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{labels.noTables}</p>
            ) : (
              filteredTables.map((table) => {
                const isActive = table.name === activeTable;
                return (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => setActiveTable(table.name)}
                    className={
                      'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ' +
                      (isActive
                        ? 'bg-primary/15 text-foreground'
                        : 'text-foreground/90 hover:bg-accent')
                    }
                  >
                    <span className="truncate">{table.name}</span>
                    <span className="ml-2 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {table.rowCount == null ? '—' : formatNumber(table.rowCount)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Body — table contents */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!isCurrentSource ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              {labels.loading}
            </div>
          ) : !activeTable ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              {labels.selectTable}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <div className="min-w-0">
                  <h4 className="truncate text-xs font-medium text-foreground">{activeTable}</h4>
                  {tableData && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {formatNumber(total)} {labels.rows} · {tableData.columns.length} {labels.columns}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0 || tableLoading}
                    title={labels.prev}
                    aria-label={labels.prev}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="px-1 text-[10px] tabular-nums text-muted-foreground">
                    {formatNumber(currentPage)} / {formatNumber(pageCount)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={offset + PAGE_SIZE >= total || tableLoading}
                    title={labels.next}
                    aria-label={labels.next}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {tableLoading && !tableData ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    {labels.loading}
                  </div>
                ) : tableError ? (
                  <p className="m-3 text-xs text-red-600 dark:text-red-400">{tableError}</p>
                ) : tableData && tableData.rows.length === 0 ? (
                  <p className="m-3 text-xs text-muted-foreground">{labels.emptyTable}</p>
                ) : tableData ? (
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                      <tr>
                        {tableData.columns.map((col) => (
                          <th
                            key={col.name}
                            className="border-b border-border px-2 py-1.5 text-left align-bottom font-medium text-foreground"
                            title={`${col.type}${col.primaryKey ? ' · PRIMARY KEY' : ''}${col.notNull ? ' · NOT NULL' : ''}`}
                          >
                            <div className="flex flex-col gap-0">
                              <span>{col.name}</span>
                              <span className="font-mono text-[9px] font-normal text-muted-foreground">
                                {col.type || 'any'}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-border/60 transition-colors hover:bg-muted/40"
                        >
                          {tableData.columns.map((col) => (
                            <td
                              key={col.name}
                              className="whitespace-nowrap px-2 py-1 align-top font-mono text-[11px] text-foreground/90"
                            >
                              {formatCell(row[col.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );

  // Fullscreen layout (rare — only when the editor is popped out into a window).
  if (isSidebar) return sidebarLayout;

  const containerClassName = isFullscreen
    ? 'fixed inset-0 z-[9999] bg-background flex flex-col'
    : 'fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4';
  const innerClassName = isFullscreen
    ? 'bg-background flex flex-col w-full h-full'
    : 'bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]';

  return (
    <div className={containerClassName}>
      <div className={innerClassName}>
        {header}
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/20">
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={tableFilter}
                  onChange={(event) => setTableFilter(event.target.value)}
                  placeholder={labels.filterTables}
                  className="h-8 pl-8 text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-1 py-1">
              {filteredTables.map((table) => {
                const isActive = table.name === activeTable;
                return (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => setActiveTable(table.name)}
                    className={
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ' +
                      (isActive
                        ? 'bg-primary/15 text-foreground'
                        : 'text-foreground/90 hover:bg-accent')
                    }
                  >
                    <span className="truncate">{table.name}</span>
                    <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {table.rowCount == null ? '—' : formatNumber(table.rowCount)}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Simplified fullscreen body — same data, larger type */}
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <h4 className="truncate text-sm font-medium text-foreground">{activeTable ?? ''}</h4>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0 || tableLoading}
                >
                  {labels.prev}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total || tableLoading}
                >
                  {labels.next}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {tableData && (
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr>
                      {tableData.columns.map((col) => (
                        <th key={col.name} className="border-b border-border px-3 py-2 text-left text-foreground">
                          {col.name}
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">{col.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border/60">
                        {tableData.columns.map((col) => (
                          <td key={col.name} className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                            {formatCell(row[col.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
