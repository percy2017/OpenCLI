import { useCallback, useMemo, useState } from 'react';
import type { FileTreeNode } from '../types/types';

export type UseFileTreeSelectionResult = {
  isSelectionMode: boolean;
  selectedPaths: Set<string>;
  selectedCount: number;
  setSelectionMode: (enabled: boolean) => void;
  toggleSelectionMode: () => void;
  isSelected: (path: string) => boolean;
  togglePath: (path: string) => void;
  toggleNode: (node: FileTreeNode) => void;
  selectAllVisible: (nodes: FileTreeNode[], expandedDirs: Set<string>) => void;
  clearSelection: () => void;
};

// Walk every node once; for a directory node we return its path AND every
// descendant path so selecting a folder is equivalent to selecting its whole
// tree (Finder/Explorer semantics).
function expandPaths(node: FileTreeNode, out: string[]): void {
  out.push(node.path);
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      expandPaths(child, out);
    }
  }
}

// Same recursion but only through children that pass `expandedDirs`,
// so `selectAllVisible` matches what the user actually sees.
function expandVisiblePaths(
  node: FileTreeNode,
  expandedDirs: Set<string>,
  out: string[],
): void {
  out.push(node.path);
  if (node.type === 'directory' && node.children && expandedDirs.has(node.path)) {
    for (const child of node.children) {
      expandVisiblePaths(child, expandedDirs, out);
    }
  }
}

/**
 * Owns the multi-select state for the file tree.
 *
 * Selection mode is opt-in (toggle). When disabled, all helper functions
 * become no-ops except for `isSelected`, so the UI can keep asking without
 * paying any cost.
 *
 * Selecting a directory is recursive — the directory path and every
 * descendant path are stored. This keeps deletion/ZIP/copy working from a
 * single path list without re-walking the tree at action time.
 */
export function useFileTreeSelection(): UseFileTreeSelectionResult {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), []);

  const setSelectionMode = useCallback(
    (enabled: boolean) => {
      setIsSelectionMode(enabled);
      if (!enabled) {
        setSelectedPaths(new Set());
      }
    },
    [],
  );

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        setSelectedPaths(new Set());
      }
      return !prev;
    });
  }, []);

  const isSelected = useCallback(
    (path: string) => selectedPaths.has(path),
    [selectedPaths],
  );

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleNode = useCallback((node: FileTreeNode) => {
    const paths: string[] = [];
    expandPaths(node, paths);

    setSelectedPaths((prev) => {
      const next = new Set(prev);
      const allSelected = paths.every((p) => next.has(p));
      if (allSelected) {
        for (const p of paths) {
          next.delete(p);
        }
      } else {
        for (const p of paths) {
          next.add(p);
        }
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(
    (nodes: FileTreeNode[], expandedDirs: Set<string>) => {
      const paths: string[] = [];
      for (const node of nodes) {
        expandVisiblePaths(node, expandedDirs, paths);
      }
      setSelectedPaths(new Set(paths));
    },
    [],
  );

  return useMemo(
    () => ({
      isSelectionMode,
      selectedPaths,
      selectedCount: selectedPaths.size,
      setSelectionMode,
      toggleSelectionMode,
      isSelected,
      togglePath,
      toggleNode,
      selectAllVisible,
      clearSelection,
    }),
    [
      isSelectionMode,
      selectedPaths,
      setSelectionMode,
      toggleSelectionMode,
      isSelected,
      togglePath,
      toggleNode,
      selectAllVisible,
      clearSelection,
    ],
  );
}
