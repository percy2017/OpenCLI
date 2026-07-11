import { useCallback, useEffect, useState } from 'react';
import { FILE_TREE_SHOW_IGNORED_STORAGE_KEY } from '../constants/constants';

type UseFileTreeShowIgnoredResult = {
  showIgnored: boolean;
  changeShowIgnored: (value: boolean) => void;
};

export function useFileTreeShowIgnored(): UseFileTreeShowIgnoredResult {
  const [showIgnored, setShowIgnored] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(FILE_TREE_SHOW_IGNORED_STORAGE_KEY);
      if (saved === 'true') {
        setShowIgnored(true);
      }
    } catch {
      // Keep default when storage is unavailable.
    }
  }, []);

  const changeShowIgnored = useCallback((value: boolean) => {
    setShowIgnored(value);

    try {
      localStorage.setItem(FILE_TREE_SHOW_IGNORED_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      // Keep runtime state even when persistence fails.
    }
  }, []);

  return {
    showIgnored,
    changeShowIgnored,
  };
}