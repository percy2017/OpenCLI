import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import type { DocumentAction, KnowledgeDocument } from '../types';
import DocumentListItem from './DocumentListItem';

type DocumentListProps = {
  documents: KnowledgeDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAction: (id: string, action: DocumentAction['id']) => void;
};

export default function DocumentList({ documents, selectedId, onSelect, onAction }: DocumentListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return documents;
    const needle = query.toLowerCase();
    return documents.filter((doc) => doc.name.toLowerCase().includes(needle));
  }, [documents, query]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-border/60 bg-muted/10">
      <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('knowledgeBase.list.title', { count: documents.length })}
          </h3>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('knowledgeBase.list.searchPlaceholder')}
            aria-label={t('knowledgeBase.list.searchAria')}
            className={cn(
              'h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm',
              'placeholder:text-muted-foreground/70',
              'focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30',
            )}
          />
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query ? t('knowledgeBase.list.noResults') : t('knowledgeBase.list.empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((doc) => (
              <li key={doc.id}>
                <DocumentListItem
                  document={doc}
                  isActive={selectedId === doc.id}
                  onSelect={() => onSelect(doc.id)}
                  onAction={(action) => onAction(doc.id, action)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
