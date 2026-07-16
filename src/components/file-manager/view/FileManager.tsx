import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  MoreHorizontal,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';

import {
  ActionMenu,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
} from '../../../shared/view/ui';
import { cn } from '../../../lib/utils';
import { useFileManager } from '../hooks/useFileManager';
import type {
  FileManagerDialogState,
  FileManagerEntry,
  FileManagerTrashEntry,
} from '../types';
import { getFileIcon } from '../utils/fileManagerIcons';
import { formatFileSize } from '../utils/fileManagerPaths';

type FileManagerProps = {
  onFileOpen: (filePath: string) => void;
};

type TreeNodeProps = {
  entry: FileManagerEntry;
  depth: number;
  entriesByPath: Record<string, FileManagerEntry[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  selectedPaths: Set<string>;
  onSelect: (path: string, options?: { additive?: boolean }) => void;
  onOpen: (entry: FileManagerEntry) => void;
  onToggle: (path: string) => void;
  onMove: (sourcePath: string, targetDirectory: string) => void;
};

const FILE_DRAG_TYPE = 'application/x-opencli-file-path';

const EntryIcon = ({ entry, open = false }: { entry: FileManagerEntry; open?: boolean }) => {
  if (entry.isSymlink && entry.type === 'symlink') {
    return <Link2 className="h-4 w-4 flex-shrink-0 text-purple-500" />;
  }
  if (entry.type === 'directory') {
    const Icon = open ? FolderOpen : Folder;
    return <Icon className="h-4 w-4 flex-shrink-0 text-amber-500" />;
  }
  const Icon = getFileIcon(entry.name);
  return <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />;
};

function TreeNode({
  entry,
  depth,
  entriesByPath,
  expandedPaths,
  loadingPaths,
  selectedPaths,
  onSelect,
  onOpen,
  onToggle,
  onMove,
}: TreeNodeProps) {
  const isDirectory = entry.type === 'directory';
  const isExpanded = isDirectory && expandedPaths.has(entry.path);
  const children = entriesByPath[entry.path] ?? [];

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (!isDirectory) return;
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = event.dataTransfer.getData(FILE_DRAG_TYPE);
    if (sourcePath && sourcePath !== entry.path) {
      onMove(sourcePath, entry.path);
    }
  };

  return (
    <div>
      <button
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(FILE_DRAG_TYPE, entry.path);
        }}
        onDragOver={(event) => {
          if (isDirectory) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={handleDrop}
        onClick={() => onSelect(entry.path)}
        onDoubleClick={() => onOpen(entry)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent',
          selectedPaths.has(entry.path) && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        title={entry.path}
      >
        {isDirectory ? (
          <span
            role="button"
            tabIndex={0}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(entry.path);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onToggle(entry.path);
              }
            }}
          >
            {loadingPaths.has(entry.path) ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="h-4 w-4 flex-shrink-0" />
        )}
        <input
          type="checkbox"
          checked={selectedPaths.has(entry.path)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onSelect(entry.path, { additive: true })}
          aria-label={`Select ${entry.name}`}
          className="h-3.5 w-3.5 flex-shrink-0 accent-primary"
        />
        <EntryIcon entry={entry} open={isExpanded} />
        <span className={cn('truncate', entry.hidden && 'opacity-75')}>{entry.name}</span>
      </button>

      {isExpanded && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          entriesByPath={entriesByPath}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          selectedPaths={selectedPaths}
          onSelect={onSelect}
          onOpen={onOpen}
          onToggle={onToggle}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

export default function FileManager({ onFileOpen }: FileManagerProps) {
  const { t } = useTranslation('common');
  const manager = useFileManager();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<FileManagerDialogState>(null);
  const [dialogValue, setDialogValue] = useState('');
  const currentPath = manager.currentPath;
  const loadTrash = manager.loadTrash;
  const selectedEntries = manager.selectedEntries;
  const selectedEntry = manager.selectedEntry;

  const visibleEntries = useMemo(() => {
    const currentEntries = manager.entriesByPath[currentPath] ?? [];
    const query = search.trim().toLocaleLowerCase();
    if (!query) return currentEntries;
    return currentEntries.filter((entry) => entry.name.toLocaleLowerCase().includes(query));
  }, [currentPath, manager.entriesByPath, search]);

  const currentEntryPaths = visibleEntries.map((entry) => entry.path);
  const entryByPath = useMemo(() => {
    const entries = Object.values(manager.entriesByPath).flat();
    return new Map(entries.map((entry) => [entry.path, entry]));
  }, [manager.entriesByPath]);

  const { getInputProps, open: openUploadPicker } = useDropzone({
    noClick: true,
    noKeyboard: true,
    noDrag: true,
    multiple: true,
    onDropAccepted: (files) => {
      void manager.uploadFiles(files);
    },
  });

  useEffect(() => {
    if (!dialog) {
      setDialogValue('');
      return;
    }
    if (dialog.kind === 'rename') {
      setDialogValue(dialog.entry.name);
    } else if (dialog.kind === 'copy' || dialog.kind === 'move') {
      setDialogValue(currentPath);
    } else {
      setDialogValue('');
    }
    if (dialog.kind === 'trash-view') {
      void loadTrash();
    }
  }, [dialog, currentPath, loadTrash]);

  const openEntry = (entry: FileManagerEntry) => {
    if (entry.type === 'directory') {
      manager.navigateTo(entry.path);
      return;
    }
    onFileOpen(entry.path);
  };

  const moveByDrop = (sourcePath: string, targetDirectory: string) => {
    const sourceEntry = entryByPath.get(sourcePath);
    if (!sourceEntry) return;
    const selectedForMove = manager.selectedEntries.some((entry) => entry.path === sourcePath)
      ? manager.selectedEntries
      : [sourceEntry];
    if (selectedForMove.length > 1) {
      void manager.moveSelectedEntries(selectedForMove, targetDirectory);
    } else {
      void manager.moveEntry(sourceEntry, targetDirectory);
    }
  };

  const selectListEntry = (entry: FileManagerEntry, event: MouseEvent) => {
    manager.selectEntry(entry.path, {
      additive: event.metaKey || event.ctrlKey,
      rangePaths: event.shiftKey ? currentEntryPaths : undefined,
    });
  };

  const runDialogAction = async () => {
    if (!dialog) return;
    try {
      if (dialog.kind === 'create-file') {
        await manager.createEntry(dialogValue, 'file');
      } else if (dialog.kind === 'create-directory') {
        await manager.createEntry(dialogValue, 'directory');
      } else if (dialog.kind === 'rename') {
        await manager.renameEntry(dialog.entry, dialogValue);
      } else if (dialog.kind === 'copy') {
        await manager.copySelectedEntries(dialog.entries, dialogValue);
      } else if (dialog.kind === 'move') {
        await manager.moveSelectedEntries(dialog.entries, dialogValue);
      } else if (dialog.kind === 'trash') {
        await manager.trashSelectedEntries(dialog.entries);
      }
      setDialog(null);
    } catch {
      // The hook exposes the actionable server error in the panel.
    }
  };

  const actionItems = selectedEntries.length > 1
    ? [
      {
        key: 'copy-many',
        label: t('fileManager.copy', 'Copy'),
        icon: Copy,
        onSelect: () => setDialog({ kind: 'copy', entries: selectedEntries }),
      },
      {
        key: 'move-many',
        label: t('fileManager.move', 'Move'),
        icon: Move,
        onSelect: () => setDialog({ kind: 'move', entries: selectedEntries }),
      },
      {
        key: 'download-many',
        label: t('buttons.download'),
        icon: Download,
        onSelect: () => void manager.downloadEntries(selectedEntries),
      },
      {
        key: 'trash-many',
        label: t('fileManager.moveToTrash', 'Move to trash'),
        icon: Trash2,
        isDanger: true,
        showDividerBefore: true,
        onSelect: () => setDialog({ kind: 'trash', entries: selectedEntries }),
      },
    ]
    : selectedEntry
      ? [
        {
          key: 'open',
          label: selectedEntry.type === 'directory'
            ? t('fileManager.openDirectory', 'Open directory')
            : t('fileManager.openFile', 'Open file'),
          icon: selectedEntry.type === 'directory' ? FolderOpen : File,
          onSelect: () => openEntry(selectedEntry),
        },
        {
          key: 'rename',
          label: t('fileManager.rename', 'Rename'),
          icon: Pencil,
          onSelect: () => setDialog({ kind: 'rename', entry: selectedEntry }),
        },
        {
          key: 'copy',
          label: t('fileManager.copy', 'Copy'),
          icon: Copy,
          onSelect: () => setDialog({ kind: 'copy', entries: [selectedEntry] }),
        },
        {
          key: 'move',
          label: t('fileManager.move', 'Move'),
          icon: Move,
          onSelect: () => setDialog({ kind: 'move', entries: [selectedEntry] }),
        },
        {
          key: 'download',
          label: t('buttons.download'),
          icon: Download,
          onSelect: () => void manager.downloadEntries([selectedEntry]),
        },
        {
          key: 'trash',
          label: t('fileManager.moveToTrash', 'Move to trash'),
          icon: Trash2,
          isDanger: true,
          showDividerBefore: true,
          onSelect: () => setDialog({ kind: 'trash', entries: [selectedEntry] }),
        },
      ]
      : [];

  const dialogTitle = (() => {
    if (!dialog) return '';
    if (dialog.kind === 'create-file') return t('fileManager.createFile', 'Create file');
    if (dialog.kind === 'create-directory') return t('fileManager.createDirectory', 'Create directory');
    if (dialog.kind === 'rename') return t('fileManager.rename', 'Rename');
    if (dialog.kind === 'copy') return t('fileManager.copy', 'Copy');
    if (dialog.kind === 'move') return t('fileManager.move', 'Move');
    if (dialog.kind === 'trash') return t('fileManager.moveToTrash', 'Move to trash');
    return t('fileManager.trash', 'Trash');
  })();

  const dialogNeedsInput = dialog && dialog.kind !== 'trash' && dialog.kind !== 'trash-view';
  const pathSegments = manager.currentPath ? manager.currentPath.split('/') : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <input {...getInputProps()} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'create-file' })}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('fileManager.newFile', 'New file')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'create-directory' })}>
          <FolderPlus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('fileManager.newDirectory', 'New directory')}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={openUploadPicker} disabled={manager.busy}>
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">{t('buttons.upload')}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void manager.refreshVisibleDirectories()}
          disabled={manager.busy}
          aria-label={t('buttons.refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', manager.busy && 'animate-spin')} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'trash-view' })}>
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">{t('fileManager.trash', 'Trash')}</span>
        </Button>

        {selectedEntries.length > 0 && (
          <ActionMenu
            label={selectedEntries.length > 1
              ? t('fileManager.selectedCount', { count: selectedEntries.length })
              : t('fileManager.actions', 'Actions')}
            icon={MoreHorizontal}
            items={actionItems}
          />
        )}

        <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('fileManager.search', 'Search current directory')}
            className="h-8 pl-8"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 flex-shrink-0 flex-col border-r border-border md:flex">
          <button
            type="button"
            onClick={() => manager.navigateTo('')}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              moveByDrop(event.dataTransfer.getData(FILE_DRAG_TYPE), '');
            }}
            className="flex items-center gap-2 border-b border-border px-3 py-2 text-left text-xs font-medium hover:bg-accent"
            title={manager.rootInfo?.resolvedPath}
          >
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" />
            <span className="truncate">{manager.rootInfo?.resolvedPath || 'WORKSPACES_ROOT'}</span>
          </button>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {manager.loadingPaths.has('') && !manager.entriesByPath[''] ? (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('status.loading')}
              </div>
            ) : (
              (manager.entriesByPath[''] ?? []).map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  entriesByPath={manager.entriesByPath}
                  expandedPaths={manager.expandedPaths}
                  loadingPaths={manager.loadingPaths}
                  selectedPaths={manager.selectedPaths}
                  onSelect={(path, options) => manager.selectEntry(path, options)}
                  onOpen={openEntry}
                  onToggle={manager.toggleDirectory}
                  onMove={moveByDrop}
                />
              ))
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-9 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1 font-mono text-xs">
            <button type="button" onClick={() => manager.navigateTo('')} className="rounded px-1.5 py-1 hover:bg-accent">
              {manager.rootInfo?.resolvedPath || '/'}
            </button>
            {pathSegments.map((segment, index) => {
              const segmentPath = pathSegments.slice(0, index + 1).join('/');
              return (
                <span key={segmentPath} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button type="button" onClick={() => manager.navigateTo(segmentPath)} className="rounded px-1.5 py-1 hover:bg-accent">
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>

          {manager.error && (
            <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
              {manager.error}
            </div>
          )}
          {manager.notice && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              {manager.notice}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid min-w-[620px] grid-cols-[minmax(240px,1fr)_110px_170px_80px] border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t('fileManager.name', 'Name')}</span>
              <span>{t('fileManager.size', 'Size')}</span>
              <span>{t('fileManager.modified', 'Modified')}</span>
              <span>{t('fileManager.mode', 'Mode')}</span>
            </div>

            {manager.loadingPaths.has(manager.currentPath) && !manager.entriesByPath[manager.currentPath] ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('status.loading')}
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {search ? t('fileManager.noMatches', 'No matching entries') : t('fileManager.emptyDirectory', 'This directory is empty')}
              </div>
            ) : (
              visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(FILE_DRAG_TYPE, entry.path);
                  }}
                  onDragOver={(event) => {
                    if (entry.type === 'directory') {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDrop={(event) => {
                    if (entry.type !== 'directory') return;
                    event.preventDefault();
                    moveByDrop(event.dataTransfer.getData(FILE_DRAG_TYPE), entry.path);
                  }}
                  onClick={(event) => selectListEntry(entry, event)}
                  onDoubleClick={() => openEntry(entry)}
                  className={cn(
                    'grid min-w-[620px] grid-cols-[minmax(240px,1fr)_110px_170px_80px] items-center border-b border-border/60 px-3 py-2 text-left text-xs hover:bg-accent/70',
                    manager.selectedPaths.has(entry.path) && 'bg-accent text-accent-foreground',
                  )}
                  title={entry.path}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={manager.selectedPaths.has(entry.path)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => manager.selectEntry(entry.path, { additive: true })}
                      aria-label={`Select ${entry.name}`}
                      className="h-3.5 w-3.5 flex-shrink-0 accent-primary"
                    />
                    <EntryIcon entry={entry} />
                    <span className={cn('truncate', entry.hidden && 'opacity-75')}>{entry.name}</span>
                    {entry.isSymlink && <Link2 className="h-3 w-3 flex-shrink-0 text-purple-500" />}
                  </span>
                  <span className="text-muted-foreground">{entry.type === 'directory' ? '—' : formatFileSize(entry.size)}</span>
                  <span className="text-muted-foreground">{new Date(entry.modifiedAt).toLocaleString()}</span>
                  <span className="font-mono text-muted-foreground">{entry.permissions}</span>
                </button>
              ))
            )}
          </div>
        </main>
      </div>

      <Dialog open={Boolean(dialog && dialog.kind !== 'trash-view')} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="p-5">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <h2 className="mb-4 text-base font-semibold">{dialogTitle}</h2>
          {dialog?.kind === 'trash' ? (
            <p className="text-sm text-muted-foreground">
              {t('fileManager.trashConfirmation', 'This entry will be moved to the recoverable trash.')}
              <span className="mt-2 block break-all font-mono text-xs">
                {dialog.entries.length === 1
                  ? dialog.entries[0].path
                  : t('fileManager.selectedCount', { count: dialog.entries.length })}
              </span>
            </p>
          ) : dialogNeedsInput ? (
            <div className="space-y-2">
              <label htmlFor="file-manager-dialog-value" className="text-sm font-medium">
                {dialog?.kind === 'copy' || dialog?.kind === 'move'
                  ? t('fileManager.destination', 'Destination directory')
                  : t('fileManager.name', 'Name')}
              </label>
              <Input
                id="file-manager-dialog-value"
                value={dialogValue}
                onChange={(event) => setDialogValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dialogValue) void runDialogAction();
                }}
                placeholder={dialog?.kind === 'copy' || dialog?.kind === 'move' ? '' : t('fileManager.name', 'Name')}
              />
              {(dialog?.kind === 'copy' || dialog?.kind === 'move') && (
                <p className="text-xs text-muted-foreground">
                  {t('fileManager.relativeDestinationHelp', 'Use a path relative to WORKSPACES_ROOT. Leave empty for the root.')}
                </p>
              )}
            </div>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>{t('buttons.cancel')}</Button>
            <Button
              variant={dialog?.kind === 'trash' ? 'destructive' : 'default'}
              disabled={manager.busy || (Boolean(dialogNeedsInput) && !dialogValue && dialog?.kind !== 'copy' && dialog?.kind !== 'move')}
              onClick={() => void runDialogAction()}
            >
              {manager.busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {dialog?.kind === 'trash' ? t('fileManager.moveToTrash', 'Move to trash') : t('buttons.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'trash-view'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-2xl">
          <DialogTitle>{t('fileManager.trash', 'Trash')}</DialogTitle>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{t('fileManager.trash', 'Trash')}</h2>
            <Button
              size="sm"
              variant="destructive"
              disabled={manager.busy || manager.trashEntries.length === 0}
              onClick={() => {
                if (window.confirm(t('fileManager.emptyTrashConfirmation', 'Permanently delete every item in trash?'))) {
                  void manager.emptyTrash();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t('fileManager.emptyTrash', 'Empty trash')}
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto p-2">
            {manager.busy && manager.trashEntries.length === 0 ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('status.loading')}
              </div>
            ) : manager.trashEntries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{t('fileManager.trashEmpty', 'Trash is empty')}</div>
            ) : (
              manager.trashEntries.map((entry: FileManagerTrashEntry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent">
                  <EntryIcon entry={{ ...entry, path: entry.originalPath, modifiedAt: entry.deletedAt, createdAt: entry.deletedAt, permissions: '', hidden: entry.name.startsWith('.'), isSymlink: entry.type === 'symlink' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{entry.originalPath}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(entry.deletedAt).toLocaleString()}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void manager.restoreTrashEntry(entry)} disabled={manager.busy}>
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('fileManager.restore', 'Restore')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 dark:text-red-400"
                    disabled={manager.busy}
                    onClick={() => {
                      if (window.confirm(t('fileManager.permanentDeleteConfirmation', 'Permanently delete this item? This cannot be undone.'))) {
                        void manager.permanentlyDeleteTrashEntry(entry);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
