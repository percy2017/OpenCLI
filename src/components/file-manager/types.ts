export type FileManagerEntryType = 'file' | 'directory' | 'symlink';

export type FileManagerEntry = {
  name: string;
  path: string;
  type: FileManagerEntryType;
  size: number;
  modifiedAt: string;
  createdAt: string;
  permissions: string;
  hidden: boolean;
  isSymlink: boolean;
};

export type FileManagerRootInfo = {
  configuredPath: string;
  resolvedPath: string;
};

export type FileManagerTrashEntry = {
  id: string;
  name: string;
  originalPath: string;
  type: FileManagerEntryType;
  size: number;
  deletedAt: string;
};

export type FileManagerBatchResult = {
  entries: FileManagerEntry[];
  errors: { path: string; message: string }[];
};

export type FileManagerDialogState =
  | { kind: 'create-file' | 'create-directory' }
  | { kind: 'rename'; entry: FileManagerEntry }
  | { kind: 'copy' | 'move'; entries: FileManagerEntry[] }
  | { kind: 'trash'; entries: FileManagerEntry[] }
  | { kind: 'trash-view' }
  | null;
