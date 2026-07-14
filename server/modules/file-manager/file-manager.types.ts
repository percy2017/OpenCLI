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

export type FileManagerCreateInput = {
  parentPath: string;
  name: string;
  type: 'file' | 'directory';
};

export type FileManagerTransferInput = {
  sourcePath: string;
  targetDirectory: string;
  newName?: string;
};

export type FileManagerBatchResult = {
  entries: FileManagerEntry[];
  errors: { path: string; message: string }[];
};
