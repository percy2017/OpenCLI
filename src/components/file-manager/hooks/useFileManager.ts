import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type {
  FileManagerBatchResult,
  FileManagerEntry,
  FileManagerRootInfo,
  FileManagerTrashEntry,
} from '../types';
import { parentPathOf } from '../utils/fileManagerPaths';

type EntriesResponse = {
  path: string;
  entries: FileManagerEntry[];
};

type EntryResponse = {
  entry: FileManagerEntry;
};

type TrashResponse = {
  entries: FileManagerTrashEntry[];
};

const parseResponse = async <T,>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    data?: T;
    error?: string | { message?: string };
  } | null;

  if (!response.ok || payload?.success === false || !payload?.data) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload.data;
};

const buildEventsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  const token = localStorage.getItem('auth-token');
  if (token) {
    params.set('token', token);
  }
  const query = params.toString();
  return `${protocol}//${window.location.host}/file-manager-events${query ? `?${query}` : ''}`;
};

export function useFileManager() {
  const { t } = useTranslation('common');
  const [rootInfo, setRootInfo] = useState<FileManagerRootInfo | null>(null);
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FileManagerEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']));
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trashEntries, setTrashEntries] = useState<FileManagerTrashEntry[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const currentPathRef = useRef(currentPath);

  expandedPathsRef.current = expandedPaths;
  currentPathRef.current = currentPath;

  const loadDirectory = useCallback(async (directoryPath: string) => {
    setLoadingPaths((previous) => new Set(previous).add(directoryPath));
    try {
      const data = await parseResponse<EntriesResponse>(await api.fileManager.entries(directoryPath));
      setEntriesByPath((previous) => ({ ...previous, [directoryPath]: data.entries }));
      setError(null);
      return data.entries;
    } catch (loadError) {
      setEntriesByPath((previous) => {
        const next = { ...previous };
        delete next[directoryPath];
        return next;
      });
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return [];
    } finally {
      setLoadingPaths((previous) => {
        const next = new Set(previous);
        next.delete(directoryPath);
        return next;
      });
    }
  }, []);

  const refreshVisibleDirectories = useCallback(async () => {
    const paths = new Set([...expandedPathsRef.current, currentPathRef.current]);
    await Promise.all([...paths].map((directoryPath) => loadDirectory(directoryPath)));
  }, [loadDirectory]);

  const sendSubscriptions = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({
      type: 'file-manager:subscribe',
      paths: [...new Set([...expandedPathsRef.current, currentPathRef.current])],
    }));
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(buildEventsUrl());
      socketRef.current = socket;

      socket.addEventListener('open', sendSubscriptions);
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; message?: string };
          if (message.type === 'file-manager:change') {
            if (refreshTimerRef.current) {
              clearTimeout(refreshTimerRef.current);
            }
            refreshTimerRef.current = setTimeout(() => {
              void refreshVisibleDirectories();
            }, 120);
          } else if (message.type === 'file-manager:error' && message.message) {
            setError(message.message);
          }
        } catch {
          setError('Invalid file-manager realtime event');
        }
      });
      socket.addEventListener('close', () => {
        if (!disposed) {
          reconnectTimerRef.current = setTimeout(connect, 1500);
        }
      });
      socket.addEventListener('error', () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [refreshVisibleDirectories, sendSubscriptions]);

  useEffect(() => {
    sendSubscriptions();
  }, [currentPath, expandedPaths, sendSubscriptions]);

  useEffect(() => {
    const initialize = async () => {
      try {
        const root = await parseResponse<FileManagerRootInfo>(await api.fileManager.root());
        setRootInfo(root);
        await loadDirectory('');
      } catch (initializationError) {
        setError(initializationError instanceof Error ? initializationError.message : String(initializationError));
      }
    };
    void initialize();
  }, [loadDirectory]);

  const toggleDirectory = useCallback((directoryPath: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
        void loadDirectory(directoryPath);
      }
      return next;
    });
  }, [loadDirectory]);

  const selectEntry = useCallback((
    entryPath: string,
    options: { additive?: boolean; rangePaths?: string[] } = {},
  ) => {
    setSelectedPaths((previous) => {
      if (options.rangePaths && selectionAnchorPath) {
        const anchorIndex = options.rangePaths.indexOf(selectionAnchorPath);
        const targetIndex = options.rangePaths.indexOf(entryPath);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          return new Set(options.rangePaths.slice(start, end + 1));
        }
      }

      if (options.additive) {
        const next = new Set(previous);
        if (next.has(entryPath)) {
          next.delete(entryPath);
        } else {
          next.add(entryPath);
        }
        return next;
      }

      return new Set([entryPath]);
    });
    setSelectionAnchorPath(entryPath);
  }, [selectionAnchorPath]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setSelectionAnchorPath(null);
  }, []);

  const navigateTo = useCallback((directoryPath: string) => {
    setCurrentPath(directoryPath);
    clearSelection();
    setExpandedPaths((previous) => new Set(previous).add(directoryPath));
    void loadDirectory(directoryPath);
  }, [clearSelection, loadDirectory]);

  const runMutation = useCallback(async <T,>(
    operation: () => Promise<Response>,
    pathsToRefresh: string[],
    successMessage: string,
  ): Promise<T> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await parseResponse<T>(await operation());
      await Promise.all([...new Set(pathsToRefresh)].map((directoryPath) => loadDirectory(directoryPath)));
      setNotice(successMessage);
      return data;
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      throw operationError;
    } finally {
      setBusy(false);
    }
  }, [loadDirectory]);

  const createEntry = useCallback(async (name: string, type: 'file' | 'directory') => {
    await runMutation<EntryResponse>(
      () => api.fileManager.createEntry(currentPathRef.current, name, type),
      [currentPathRef.current],
      type === 'directory'
        ? t('fileManager.directoryCreated')
        : t('fileManager.fileCreated'),
    );
  }, [runMutation, t]);

  const renameEntry = useCallback(async (entry: FileManagerEntry, newName: string) => {
    const parentPath = parentPathOf(entry.path);
    const data = await runMutation<EntryResponse>(
      () => api.fileManager.renameEntry(entry.path, newName),
      [parentPath],
      t('fileManager.renamed'),
    );
    setSelectedPaths(new Set([data.entry.path]));
    setSelectionAnchorPath(data.entry.path);
    return data.entry;
  }, [runMutation, t]);

  const copyEntry = useCallback(async (entry: FileManagerEntry, targetDirectory: string) => {
    const data = await runMutation<EntryResponse>(
      () => api.fileManager.copyEntry(entry.path, targetDirectory),
      [targetDirectory],
      t('fileManager.copied'),
    );
    return data.entry;
  }, [runMutation, t]);

  const moveEntry = useCallback(async (entry: FileManagerEntry, targetDirectory: string) => {
    const sourceParent = parentPathOf(entry.path);
    const data = await runMutation<EntryResponse>(
      () => api.fileManager.moveEntry(entry.path, targetDirectory),
      [sourceParent, targetDirectory],
      t('fileManager.moved'),
    );
    setSelectedPaths(new Set([data.entry.path]));
    setSelectionAnchorPath(data.entry.path);
    return data.entry;
  }, [runMutation, t]);

  const copySelectedEntries = useCallback(async (entries: FileManagerEntry[], targetDirectory: string) => {
    const data = await runMutation<FileManagerBatchResult>(
      () => api.fileManager.copyEntries(entries.map((entry) => entry.path), targetDirectory),
      [targetDirectory],
      t('fileManager.copied'),
    );
    if (data.errors.length > 0) {
      setError(t('fileManager.batchErrors', { count: data.errors.length }));
    }
    setSelectedPaths(new Set(data.entries.map((entry) => entry.path)));
    return data;
  }, [runMutation, t]);

  const moveSelectedEntries = useCallback(async (entries: FileManagerEntry[], targetDirectory: string) => {
    const sourceParents = entries.map((entry) => parentPathOf(entry.path));
    const data = await runMutation<FileManagerBatchResult>(
      () => api.fileManager.moveEntries(entries.map((entry) => entry.path), targetDirectory),
      [...sourceParents, targetDirectory],
      t('fileManager.moved'),
    );
    if (data.errors.length > 0) {
      setError(t('fileManager.batchErrors', { count: data.errors.length }));
    }
    setSelectedPaths(new Set(data.entries.map((entry) => entry.path)));
    return data;
  }, [runMutation, t]);

  const trashSelectedEntries = useCallback(async (entries: FileManagerEntry[]) => {
    const data = await runMutation<FileManagerBatchResult>(
      () => api.fileManager.trashEntries(entries.map((entry) => entry.path)),
      entries.map((entry) => parentPathOf(entry.path)),
      t('fileManager.trashed'),
    );
    if (data.errors.length > 0) {
      setError(t('fileManager.batchErrors', { count: data.errors.length }));
    }
    clearSelection();
    return data;
  }, [clearSelection, runMutation, t]);

  const trashEntry = useCallback(async (entry: FileManagerEntry) => {
    await runMutation<{ entry: FileManagerTrashEntry }>(
      () => api.fileManager.trashEntry(entry.path),
      [parentPathOf(entry.path)],
      t('fileManager.trashed'),
    );
    clearSelection();
  }, [clearSelection, runMutation, t]);

  const uploadFiles = useCallback(async (files: File[]) => {
    await runMutation<{ entries: FileManagerEntry[] }>(
      () => api.fileManager.upload(currentPathRef.current, files),
      [currentPathRef.current],
      t('fileManager.uploaded', { count: files.length }),
    );
  }, [runMutation, t]);

  const downloadEntry = useCallback(async (entry: FileManagerEntry) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.fileManager.download(entry.path);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = entry.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setBusy(false);
    }
  }, []);

  const downloadEntries = useCallback(async (entries: FileManagerEntry[]) => {
    if (entries.length === 0) return;
    if (entries.length === 1 && entries[0].type !== 'directory') {
      await downloadEntry(entries[0]);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await api.fileManager.downloadArchive(entries.map((entry) => entry.path));
      if (!response.ok) {
        throw new Error(`Archive download failed: ${response.status} ${response.statusText}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'cloudcli-files.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setBusy(false);
    }
  }, [downloadEntry]);

  const loadTrash = useCallback(async () => {
    setBusy(true);
    try {
      const data = await parseResponse<TrashResponse>(await api.fileManager.trash());
      setTrashEntries(data.entries);
      setError(null);
      return data.entries;
    } catch (trashError) {
      setError(trashError instanceof Error ? trashError.message : String(trashError));
      return [];
    } finally {
      setBusy(false);
    }
  }, []);

  const restoreTrashEntry = useCallback(async (entry: FileManagerTrashEntry) => {
    const data = await runMutation<EntryResponse>(
      () => api.fileManager.restoreTrash(entry.id),
      [parentPathOf(entry.originalPath)],
      t('fileManager.restored'),
    );
    await loadTrash();
    return data.entry;
  }, [loadTrash, runMutation, t]);

  const permanentlyDeleteTrashEntry = useCallback(async (entry: FileManagerTrashEntry) => {
    await runMutation<{ id: string }>(
      () => api.fileManager.deleteTrash(entry.id),
      [],
      t('fileManager.permanentlyDeleted'),
    );
    await loadTrash();
  }, [loadTrash, runMutation, t]);

  const emptyTrash = useCallback(async () => {
    await runMutation<{ emptied: boolean }>(
      () => api.fileManager.emptyTrash(),
      [],
      t('fileManager.trashEmptied'),
    );
    setTrashEntries([]);
  }, [runMutation, t]);

  const allEntries = Object.values(entriesByPath).flat();
  const selectedEntries = [...selectedPaths]
    .map((path) => allEntries.find((entry) => entry.path === path))
    .filter((entry): entry is FileManagerEntry => Boolean(entry));
  const selectedPath = selectedEntries.length === 1 ? selectedEntries[0].path : null;
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;

  return {
    rootInfo,
    entriesByPath,
    expandedPaths,
    currentPath,
    selectedPath,
    selectedPaths,
    selectedEntries,
    selectedEntry,
    loadingPaths,
    busy,
    error,
    notice,
    trashEntries,
    selectEntry,
    clearSelection,
    setSelectedPaths,
    setError,
    setNotice,
    loadDirectory,
    refreshVisibleDirectories,
    toggleDirectory,
    navigateTo,
    createEntry,
    renameEntry,
    copyEntry,
    moveEntry,
    copySelectedEntries,
    moveSelectedEntries,
    trashEntry,
    trashSelectedEntries,
    uploadFiles,
    downloadEntry,
    downloadEntries,
    loadTrash,
    restoreTrashEntry,
    permanentlyDeleteTrashEntry,
    emptyTrash,
  };
}
