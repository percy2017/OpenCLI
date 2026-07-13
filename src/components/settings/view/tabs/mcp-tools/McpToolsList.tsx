import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsRow from '../../SettingsRow';

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpServerCatalog = {
  id: 'browser' | 'minimax' | 'rag';
  name: string;
  label: string;
  available: boolean;
  source: 'static' | 'external-or-static-fallback';
  tools: McpTool[];
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as { success?: boolean; error?: string; data?: T };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

type McpToolsListProps = {
  serverId: 'browser' | 'minimax' | 'rag';
};

export default function McpToolsList({ serverId }: McpToolsListProps) {
  const { t } = useTranslation('settings');
  const [servers, setServers] = useState<McpServerCatalog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/mcp-tools');
      const data = await readJson<{ data: { servers: McpServerCatalog[] } }>(response);
      setServers(data.data.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcpTools.tools.empty'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const server = servers?.find((s) => s.id === serverId) ?? null;
  const toolCount = server?.tools.length ?? 0;

  return (
    <SettingsCard divided>
      <SettingsRow
        label={t('mcpTools.tools.title')}
        description={
          isLoading || !server
            ? t('mcpTools.tools.loading')
            : t('mcpTools.tools.count', { count: toolCount })
        }
      >
        {isLoading && !server ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </SettingsRow>

      <div className="space-y-2 px-4 pb-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {!isLoading && server && !server.available && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            {server.error || t('mcpTools.tools.unavailable')}
          </div>
        )}

        {!isLoading && server && server.available && server.tools.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mcpTools.tools.empty')}</p>
        )}

        {server && server.tools.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {server.tools.map((tool) => (
              <li key={tool.name} className="bg-background p-3 text-sm">
                <div className="flex flex-col gap-1">
                  <code className="break-all font-mono text-xs font-semibold text-foreground">{tool.name}</code>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground">{tool.description}</p>
                  )}
                  {tool.inputSchema && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                        {t('mcpTools.tools.schemaToggle')}
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                      <span className="sr-only">{t('mcpTools.tools.schemaHide')}</span>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}
