import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, FolderInput, Loader2, Trash2, X, Folder } from 'lucide-react';

import { Button, Input } from '../../../shared/view/ui';
import type { FileTreeNode } from '../types/types';

type FileTreeSelectionToolbarProps = {
  selectedCount: number;
  selectedPaths: string[];
  isLoading: boolean;
  onCopyPaths: (paths: string[]) => void;
  onDownloadPaths: (paths: string[]) => void;
  onDeletePaths: (
    items: Array<{ path: string; type: 'file' | 'directory' }>,
  ) => void;
  onMovePaths: (
    items: Array<{ path: string; type: 'file' | 'directory' }>,
    targetDir: string,
  ) => void;
  onClearSelection: () => void;
  onConfirmDelete: () => void;
  onConfirmMove: () => void;
  // Tree so we can map selected paths back to {path,type} items.
  tree: FileTreeNode[];
  // Existing folders in the project, flattened for the move-to picker.
  folders: string[];
};

const MAX_NAMES_IN_CONFIRM = 8;

function pathsToItems(paths: string[], tree: FileTreeNode[]) {
  const map = new Map<string, FileTreeNode>();
  const walk = (node: FileTreeNode) => {
    map.set(node.path, node);
    if (node.children) node.children.forEach(walk);
  };
  tree.forEach(walk);

  return paths
    .map((path) => map.get(path))
    .filter((node): node is FileTreeNode => Boolean(node))
    .map((node) => ({ path: node.path, type: node.type }));
}

export default function FileTreeSelectionToolbar({
  selectedCount,
  selectedPaths,
  isLoading,
  onCopyPaths,
  onDownloadPaths,
  onDeletePaths,
  onMovePaths,
  onClearSelection,
  onConfirmDelete,
  onConfirmMove,
  tree,
  folders,
}: FileTreeSelectionToolbarProps) {
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');

  const items = pathsToItems(selectedPaths, tree);

  const handleCopy = useCallback(() => {
    onCopyPaths(selectedPaths);
  }, [onCopyPaths, selectedPaths]);

  const handleDownload = useCallback(() => {
    void onDownloadPaths(selectedPaths);
  }, [onDownloadPaths, selectedPaths]);

  const handleAskDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleAskMove = useCallback(() => {
    setMoveTarget('');
    setShowMovePicker(true);
  }, []);

  const handleConfirmDeleteClick = useCallback(() => {
    onDeletePaths(items);
    setShowDeleteConfirm(false);
    onConfirmDelete();
  }, [onDeletePaths, items, onConfirmDelete]);

  const handleConfirmMoveClick = useCallback(() => {
    onMovePaths(items, moveTarget);
    setShowMovePicker(false);
    onConfirmMove();
  }, [onMovePaths, items, moveTarget, onConfirmMove]);

  // Hide both confirm modals if the selection becomes empty.
  useEffect(() => {
    if (selectedCount === 0) {
      setShowDeleteConfirm(false);
      setShowMovePicker(false);
    }
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  const visibleNames = items.slice(0, MAX_NAMES_IN_CONFIRM).map((item) =>
    item.path.split('/').pop() || item.path,
  );
  const overflow = items.length - visibleNames.length;

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('fileTree.selection.toolbarLabel', 'Selection actions')}
        className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 text-sm"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {t('fileTree.selection.selectedCount', '{{count}} selected', {
              count: selectedCount,
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClearSelection}
            disabled={isLoading}
          >
            <X className="mr-1 h-3 w-3" />
            {t('fileTree.selection.clear', 'Clear')}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleCopy}
            disabled={isLoading}
            title={t('fileTree.selection.copyPaths', 'Copy paths')}
            aria-label={t('fileTree.selection.copyPaths', 'Copy paths')}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t('fileTree.selection.copy', 'Copy')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleDownload}
            disabled={isLoading}
            title={t('fileTree.selection.downloadZip', 'Download as ZIP')}
            aria-label={t('fileTree.selection.downloadZip', 'Download as ZIP')}
          >
            {isLoading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            {t('fileTree.selection.download', 'Download')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleAskMove}
            disabled={isLoading}
            title={t('fileTree.selection.moveTo', 'Move to...')}
            aria-label={t('fileTree.selection.moveTo', 'Move to...')}
          >
            <FolderInput className="mr-1 h-3.5 w-3.5" />
            {t('fileTree.selection.move', 'Move')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950"
            onClick={handleAskDelete}
            disabled={isLoading}
            title={t('fileTree.selection.delete', 'Delete selection')}
            aria-label={t('fileTree.selection.delete', 'Delete selection')}
          >
            {isLoading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            {t('fileTree.selection.deleteShort', 'Delete')}
          </Button>
        </div>
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">
                  {t('fileTree.selection.deleteTitle', 'Delete {{count}} items?', {
                    count: selectedCount,
                  })}
                </h3>
              </div>
            </div>
            <ul className="mb-4 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-sm text-muted-foreground">
              {visibleNames.map((name) => (
                <li key={name} className="truncate">
                  • {name}
                </li>
              ))}
              {overflow > 0 && (
                <li className="mt-1 italic">
                  {t('fileTree.selection.andMore', '...and {{count}} more', { count: overflow })}
                </li>
              )}
            </ul>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'fileTree.selection.deleteWarning',
                'These items will be permanently deleted.',
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isLoading}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={handleConfirmDeleteClick}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('fileTree.selection.deleteConfirmShort', 'Delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Move-to picker */}
      {showMovePicker && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                <Folder className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-medium text-foreground">
                {t('fileTree.selection.moveTitle', 'Move {{count}} items to...', {
                  count: selectedCount,
                })}
              </h3>
            </div>

            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('fileTree.selection.targetDirLabel', 'Target folder (project-relative)')}
            </label>
            <Input
              type="text"
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value)}
              placeholder={t('fileTree.selection.targetDirPlaceholder', 'e.g. src/utils or empty for root')}
              className="h-8 text-sm"
              autoFocus
            />

            {folders.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('fileTree.selection.recentFolders', 'Quick pick')}
                </p>
                <div className="max-h-32 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-sm">
                  {folders.slice(0, 12).map((folderPath) => (
                    <button
                      key={folderPath || '(root)'}
                      type="button"
                      className="block w-full truncate rounded px-2 py-1 text-left hover:bg-accent"
                      onClick={() => setMoveTarget(folderPath)}
                    >
                      {folderPath === '' ? '/ (project root)' : folderPath}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMovePicker(false)}
                disabled={isLoading}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmMoveClick}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('fileTree.selection.moveConfirm', 'Move')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
