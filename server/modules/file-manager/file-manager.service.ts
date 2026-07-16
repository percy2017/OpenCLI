import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile as readFsFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile as writeFsFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';

import { AppError, WORKSPACES_ROOT } from '@/shared/utils.js';

import type {
  FileManagerBatchResult,
  FileManagerCreateInput,
  FileManagerEntry,
  FileManagerEntryType,
  FileManagerRootInfo,
  FileManagerTransferInput,
  FileManagerTrashEntry,
} from './file-manager.types.js';

type ResolveOptions = {
  mustExist?: boolean;
  followFinalSymlink?: boolean;
  allowRoot?: boolean;
};

type TrashManifest = {
  version: 1;
  entries: FileManagerTrashEntry[];
};

const EMPTY_TRASH_MANIFEST: TrashManifest = { version: 1, entries: [] };

function fileError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    return new AppError('File or directory not found', {
      code: 'FILE_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new AppError('Permission denied', {
      code: 'FILE_PERMISSION_DENIED',
      statusCode: 403,
    });
  }
  if (code === 'EEXIST' || code === 'ENOTEMPTY') {
    return new AppError('A file or directory already exists at the destination', {
      code: 'FILE_ALREADY_EXISTS',
      statusCode: 409,
    });
  }
  if (code === 'ENOTDIR' || code === 'EISDIR' || code === 'EINVAL') {
    return new AppError('Invalid file or directory operation', {
      code: 'INVALID_FILE_OPERATION',
      statusCode: 400,
    });
  }

  return new AppError(fallbackMessage, {
    code: 'FILE_MANAGER_OPERATION_FAILED',
    statusCode: 500,
    details: error instanceof Error ? error.message : String(error),
  });
}

function validateEntryName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new AppError('Name is required', {
      code: 'INVALID_FILE_NAME',
      statusCode: 400,
    });
  }

  if (
    name === '.' ||
    name === '..' ||
    name.includes('\0') ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new AppError('Name must be a single file or directory name', {
      code: 'INVALID_FILE_NAME',
      statusCode: 400,
    });
  }

  return name;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export class FileManagerService {
  readonly configuredRoot: string;

  private rootPathPromise: Promise<string> | null = null;
  private trashLock: Promise<unknown> = Promise.resolve();

  constructor(configuredRoot = WORKSPACES_ROOT) {
    this.configuredRoot = path.resolve(configuredRoot);
  }

  private async resolveRootPath(): Promise<string> {
    try {
      const resolvedRoot = await realpath(this.configuredRoot);
      const rootStats = await stat(resolvedRoot);
      if (!rootStats.isDirectory()) {
        throw new AppError('WORKSPACES_ROOT must point to a directory', {
          code: 'INVALID_WORKSPACES_ROOT',
          statusCode: 500,
        });
      }
      return resolvedRoot;
    } catch (error) {
      throw fileError(error, 'Unable to access WORKSPACES_ROOT');
    }
  }

  private async getRootPath(): Promise<string> {
    this.rootPathPromise ??= this.resolveRootPath();
    return this.rootPathPromise;
  }

  private async resolvePath(relativePath: unknown, options: ResolveOptions = {}): Promise<string> {
    const {
      mustExist = true,
      followFinalSymlink = true,
      allowRoot = true,
    } = options;
    const rootPath = await this.getRootPath();

    if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
      throw new AppError('Path must be a valid string', {
        code: 'INVALID_FILE_PATH',
        statusCode: 400,
      });
    }

    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
      throw new AppError('Paths must be relative to WORKSPACES_ROOT', {
        code: 'ABSOLUTE_FILE_PATH_REJECTED',
        statusCode: 400,
      });
    }

    const platformRelativePath = relativePath.split('/').join(path.sep);
    const lexicalPath = path.resolve(rootPath, platformRelativePath || '.');
    if (!isPathInside(rootPath, lexicalPath)) {
      throw new AppError('Path must stay inside WORKSPACES_ROOT', {
        code: 'FILE_PATH_OUTSIDE_ROOT',
        statusCode: 403,
      });
    }

    if (!allowRoot && lexicalPath === rootPath) {
      throw new AppError('WORKSPACES_ROOT cannot be modified', {
        code: 'WORKSPACES_ROOT_IMMUTABLE',
        statusCode: 403,
      });
    }

    try {
      if (lexicalPath === rootPath) {
        return rootPath;
      }

      if (followFinalSymlink && mustExist) {
        const resolvedPath = await realpath(lexicalPath);
        if (!isPathInside(rootPath, resolvedPath)) {
          throw new AppError('Symlink target is outside WORKSPACES_ROOT', {
            code: 'SYMLINK_OUTSIDE_ROOT',
            statusCode: 403,
          });
        }
        return resolvedPath;
      }

      const resolvedParent = await realpath(path.dirname(lexicalPath));
      if (!isPathInside(rootPath, resolvedParent)) {
        throw new AppError('Path parent is outside WORKSPACES_ROOT', {
          code: 'FILE_PATH_OUTSIDE_ROOT',
          statusCode: 403,
        });
      }

      const resolvedPath = path.join(resolvedParent, path.basename(lexicalPath));
      if (mustExist) {
        await lstat(resolvedPath);
      }
      return resolvedPath;
    } catch (error) {
      throw fileError(error, 'Unable to resolve file path');
    }
  }

  private async toRelativePath(absolutePath: string): Promise<string> {
    const rootPath = await this.getRootPath();
    if (!isPathInside(rootPath, absolutePath)) {
      throw new AppError('Path must stay inside WORKSPACES_ROOT', {
        code: 'FILE_PATH_OUTSIDE_ROOT',
        statusCode: 403,
      });
    }
    return path.relative(rootPath, absolutePath).split(path.sep).join('/');
  }

  private async getEntry(absolutePath: string): Promise<FileManagerEntry> {
    const entryStats = await lstat(absolutePath);
    const isSymlink = entryStats.isSymbolicLink();
    let type: FileManagerEntryType = entryStats.isDirectory() ? 'directory' : 'file';

    if (isSymlink) {
      type = 'symlink';
      try {
        const rootPath = await this.getRootPath();
        const resolvedTarget = await realpath(absolutePath);
        if (isPathInside(rootPath, resolvedTarget)) {
          const targetStats = await stat(resolvedTarget);
          type = targetStats.isDirectory() ? 'directory' : 'file';
        }
      } catch {
        type = 'symlink';
      }
    }

    return {
      name: path.basename(absolutePath),
      path: await this.toRelativePath(absolutePath),
      type,
      size: entryStats.size,
      modifiedAt: entryStats.mtime.toISOString(),
      createdAt: entryStats.birthtime.toISOString(),
      permissions: (entryStats.mode & 0o777).toString(8).padStart(3, '0'),
      hidden: path.basename(absolutePath).startsWith('.'),
      isSymlink,
    };
  }

  private async assertDestinationAvailable(destinationPath: string): Promise<void> {
    if (await pathExists(destinationPath)) {
      throw new AppError('A file or directory already exists at the destination', {
        code: 'FILE_ALREADY_EXISTS',
        statusCode: 409,
      });
    }
  }

  private async copyPath(sourcePath: string, destinationPath: string): Promise<void> {
    const sourceStats = await lstat(sourcePath);
    if (sourceStats.isSymbolicLink()) {
      await symlink(await readlink(sourcePath), destinationPath);
      return;
    }
    if (sourceStats.isDirectory()) {
      await cp(sourcePath, destinationPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
      return;
    }
    await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
  }

  private async removePath(targetPath: string): Promise<void> {
    const targetStats = await lstat(targetPath);
    if (targetStats.isDirectory() && !targetStats.isSymbolicLink()) {
      await rm(targetPath, { recursive: true, force: false });
      return;
    }
    await unlink(targetPath);
  }

  private async movePath(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await rename(sourcePath, destinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }
      await this.copyPath(sourcePath, destinationPath);
      await this.removePath(sourcePath);
    }
  }

  private async getTrashPaths(): Promise<{
    basePath: string;
    itemsPath: string;
    manifestPath: string;
  }> {
    const rootPath = await this.getRootPath();
    const rootId = createHash('sha256').update(rootPath).digest('hex').slice(0, 16);
    const basePath = path.join(os.homedir(), '.opencli', 'file-manager-trash', rootId);
    return {
      basePath,
      itemsPath: path.join(basePath, 'items'),
      manifestPath: path.join(basePath, 'manifest.json'),
    };
  }

  private async readTrashManifest(): Promise<TrashManifest> {
    const { manifestPath } = await this.getTrashPaths();
    try {
      const parsed = JSON.parse(await readFsFile(manifestPath, 'utf8')) as Partial<TrashManifest>;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_TRASH_MANIFEST, entries: [] };
      }
      throw fileError(error, 'Unable to read file-manager trash');
    }
  }

  private async writeTrashManifest(manifest: TrashManifest): Promise<void> {
    const { basePath, itemsPath, manifestPath } = await this.getTrashPaths();
    await mkdir(itemsPath, { recursive: true });
    const temporaryPath = path.join(basePath, `manifest-${randomUUID()}.tmp`);
    await writeFsFile(temporaryPath, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(temporaryPath, manifestPath);
  }

  private withTrashLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.trashLock.then(operation, operation);
    this.trashLock = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async getRootInfo(): Promise<FileManagerRootInfo> {
    return {
      configuredPath: this.configuredRoot,
      resolvedPath: await this.getRootPath(),
    };
  }

  async listEntries(relativePath = ''): Promise<FileManagerEntry[]> {
    try {
      const directoryPath = await this.resolvePath(relativePath);
      const directoryStats = await stat(directoryPath);
      if (!directoryStats.isDirectory()) {
        throw new AppError('Path is not a directory', {
          code: 'PATH_NOT_DIRECTORY',
          statusCode: 400,
        });
      }

      const entries = await readdir(directoryPath, { withFileTypes: true });
      const metadata = await Promise.all(entries.map((entry) => this.getEntry(path.join(directoryPath, entry.name))));
      return metadata.sort((left, right) => {
        if (left.type !== right.type) {
          if (left.type === 'directory') return -1;
          if (right.type === 'directory') return 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
    } catch (error) {
      throw fileError(error, 'Unable to list directory');
    }
  }

  async readFile(relativePath: string): Promise<{ content: string; path: string }> {
    try {
      const filePath = await this.resolvePath(relativePath);
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        throw new AppError('Path is not a file', {
          code: 'PATH_NOT_FILE',
          statusCode: 400,
        });
      }
      return {
        content: await readFsFile(filePath, 'utf8'),
        path: await this.toRelativePath(filePath),
      };
    } catch (error) {
      throw fileError(error, 'Unable to read file');
    }
  }

  async getReadableFile(relativePath: string): Promise<{ absolutePath: string; name: string }> {
    try {
      const absolutePath = await this.resolvePath(relativePath);
      const fileStats = await stat(absolutePath);
      if (!fileStats.isFile()) {
        throw new AppError('Path is not a file', {
          code: 'PATH_NOT_FILE',
          statusCode: 400,
        });
      }
      return { absolutePath, name: path.basename(absolutePath) };
    } catch (error) {
      throw fileError(error, 'Unable to access file');
    }
  }

  async writeFile(relativePath: string, content: unknown): Promise<FileManagerEntry> {
    if (typeof content !== 'string') {
      throw new AppError('File content must be a string', {
        code: 'INVALID_FILE_CONTENT',
        statusCode: 400,
      });
    }

    try {
      const filePath = await this.resolvePath(relativePath);
      let fileExists = true;
      try {
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) {
          throw new AppError('Path is not a file', {
            code: 'PATH_NOT_FILE',
            statusCode: 400,
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          fileExists = false;
        } else {
          throw error;
        }
      }
      if (fileExists) {
        await writeFsFile(filePath, content, 'utf8');
      } else {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFsFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
      }
      return this.getEntry(filePath);
    } catch (error) {
      throw fileError(error, 'Unable to save file');
    }
  }

  async createEntry(input: FileManagerCreateInput): Promise<FileManagerEntry> {
    const name = validateEntryName(input.name);
    if (input.type !== 'file' && input.type !== 'directory') {
      throw new AppError('Type must be file or directory', {
        code: 'INVALID_ENTRY_TYPE',
        statusCode: 400,
      });
    }

    try {
      const parentPath = await this.resolvePath(input.parentPath || '');
      const parentStats = await stat(parentPath);
      if (!parentStats.isDirectory()) {
        throw new AppError('Parent path is not a directory', {
          code: 'PATH_NOT_DIRECTORY',
          statusCode: 400,
        });
      }

      const relativeTarget = [input.parentPath, name].filter(Boolean).join('/');
      const targetPath = await this.resolvePath(relativeTarget, { mustExist: false });
      await this.assertDestinationAvailable(targetPath);

      if (input.type === 'directory') {
        await mkdir(targetPath);
      } else {
        await writeFsFile(targetPath, '', { encoding: 'utf8', flag: 'wx' });
      }
      return this.getEntry(targetPath);
    } catch (error) {
      throw fileError(error, 'Unable to create file or directory');
    }
  }

  async renameEntry(relativePath: string, newName: unknown): Promise<FileManagerEntry> {
    const validatedName = validateEntryName(newName);
    try {
      const sourcePath = await this.resolvePath(relativePath, {
        followFinalSymlink: false,
        allowRoot: false,
      });
      const destinationPath = await this.resolvePath(
        [path.posix.dirname(relativePath), validatedName]
          .filter((part) => part && part !== '.')
          .join('/'),
        { mustExist: false },
      );

      if (sourcePath === destinationPath) {
        return this.getEntry(sourcePath);
      }
      await this.assertDestinationAvailable(destinationPath);
      await rename(sourcePath, destinationPath);
      return this.getEntry(destinationPath);
    } catch (error) {
      throw fileError(error, 'Unable to rename file or directory');
    }
  }

  private async transferEntry(
    input: FileManagerTransferInput,
    operation: 'copy' | 'move',
  ): Promise<FileManagerEntry> {
    const destinationName = input.newName === undefined
      ? path.posix.basename(input.sourcePath)
      : validateEntryName(input.newName);

    try {
      const sourcePath = await this.resolvePath(input.sourcePath, {
        followFinalSymlink: false,
        allowRoot: false,
      });
      const targetDirectory = await this.resolvePath(input.targetDirectory || '');
      const targetStats = await stat(targetDirectory);
      if (!targetStats.isDirectory()) {
        throw new AppError('Target path is not a directory', {
          code: 'PATH_NOT_DIRECTORY',
          statusCode: 400,
        });
      }

      const destinationRelativePath = [input.targetDirectory, destinationName].filter(Boolean).join('/');
      const destinationPath = await this.resolvePath(destinationRelativePath, { mustExist: false });
      if (sourcePath === destinationPath) {
        if (operation === 'move') {
          return this.getEntry(sourcePath);
        }
        throw new AppError('Source and destination are the same', {
          code: 'SAME_FILE_DESTINATION',
          statusCode: 409,
        });
      }

      const sourceStats = await lstat(sourcePath);
      const relativeDestination = path.relative(sourcePath, destinationPath);
      if (
        sourceStats.isDirectory() &&
        !sourceStats.isSymbolicLink() &&
        relativeDestination !== '' &&
        !relativeDestination.startsWith(`..${path.sep}`) &&
        relativeDestination !== '..' &&
        !path.isAbsolute(relativeDestination)
      ) {
        throw new AppError('A directory cannot be copied or moved into itself', {
          code: 'DIRECTORY_TRANSFER_CYCLE',
          statusCode: 400,
        });
      }

      await this.assertDestinationAvailable(destinationPath);
      if (operation === 'copy') {
        await this.copyPath(sourcePath, destinationPath);
      } else {
        await this.movePath(sourcePath, destinationPath);
      }
      return this.getEntry(destinationPath);
    } catch (error) {
      throw fileError(error, `Unable to ${operation} file or directory`);
    }
  }

  async copyEntry(input: FileManagerTransferInput): Promise<FileManagerEntry> {
    return this.transferEntry(input, 'copy');
  }

  async moveEntry(input: FileManagerTransferInput): Promise<FileManagerEntry> {
    return this.transferEntry(input, 'move');
  }

  async transferEntries(
    inputs: FileManagerTransferInput[],
    operation: 'copy' | 'move',
  ): Promise<FileManagerBatchResult> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new AppError('At least one entry is required', {
        code: 'EMPTY_FILE_SELECTION',
        statusCode: 400,
      });
    }

    const entries: FileManagerEntry[] = [];
    const errors: { path: string; message: string }[] = [];
    for (const input of inputs) {
      try {
        const entry = operation === 'copy'
          ? await this.copyEntry(input)
          : await this.moveEntry(input);
        entries.push(entry);
      } catch (error) {
        errors.push({
          path: input.sourcePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { entries, errors };
  }

  async trashEntries(relativePaths: string[]): Promise<FileManagerBatchResult> {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw new AppError('At least one entry is required', {
        code: 'EMPTY_FILE_SELECTION',
        statusCode: 400,
      });
    }

    const entries: FileManagerEntry[] = [];
    const errors: { path: string; message: string }[] = [];
    for (const relativePath of relativePaths) {
      try {
        const trashed = await this.trashEntry(relativePath);
        entries.push({
          name: trashed.name,
          path: trashed.originalPath,
          type: trashed.type,
          size: trashed.size,
          modifiedAt: trashed.deletedAt,
          createdAt: trashed.deletedAt,
          permissions: '',
          hidden: trashed.name.startsWith('.'),
          isSymlink: trashed.type === 'symlink',
        });
      } catch (error) {
        errors.push({
          path: relativePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { entries, errors };
  }

  private async addToArchive(
    absolutePath: string,
    archivePath: string,
    zip: JSZip,
    seenFiles: Set<string>,
  ): Promise<void> {
    const entryStats = await lstat(absolutePath);
    if (entryStats.isSymbolicLink()) {
      return;
    }
    if (entryStats.isDirectory()) {
      const children = await readdir(absolutePath, { withFileTypes: true });
      if (children.length === 0) {
        zip.folder(archivePath);
        return;
      }
      for (const child of children) {
        await this.addToArchive(
          path.join(absolutePath, child.name),
          path.posix.join(archivePath, child.name),
          zip,
          seenFiles,
        );
      }
      return;
    }
    if (!entryStats.isFile() || seenFiles.has(archivePath)) {
      return;
    }
    zip.file(archivePath, await readFsFile(absolutePath));
    seenFiles.add(archivePath);
  }

  async createArchive(relativePaths: string[]): Promise<{ buffer: Buffer; filename: string }> {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw new AppError('At least one entry is required', {
        code: 'EMPTY_FILE_SELECTION',
        statusCode: 400,
      });
    }

    try {
      const rootPath = await this.getRootPath();
      const zip = new JSZip();
      const seenFiles = new Set<string>();
      for (const relativePath of relativePaths) {
        const absolutePath = await this.resolvePath(relativePath);
        const archivePath = path.relative(rootPath, absolutePath).split(path.sep).join('/') || path.basename(rootPath);
        await this.addToArchive(absolutePath, archivePath, zip, seenFiles);
      }
      return {
        buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
        filename: `opencli-files-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
      };
    } catch (error) {
      throw fileError(error, 'Unable to create archive');
    }
  }

  async storeUploadedFile(
    temporaryPath: string,
    targetDirectoryPath: string,
    originalName: unknown,
  ): Promise<FileManagerEntry> {
    const name = validateEntryName(originalName);
    try {
      const targetDirectory = await this.resolvePath(targetDirectoryPath || '');
      const targetStats = await stat(targetDirectory);
      if (!targetStats.isDirectory()) {
        throw new AppError('Upload target is not a directory', {
          code: 'PATH_NOT_DIRECTORY',
          statusCode: 400,
        });
      }
      const targetRelativePath = [targetDirectoryPath, name].filter(Boolean).join('/');
      const targetPath = await this.resolvePath(targetRelativePath, { mustExist: false });
      await this.assertDestinationAvailable(targetPath);
      await copyFile(temporaryPath, targetPath, fsConstants.COPYFILE_EXCL);
      return this.getEntry(targetPath);
    } catch (error) {
      throw fileError(error, 'Unable to upload file');
    }
  }

  async trashEntry(relativePath: string): Promise<FileManagerTrashEntry> {
    return this.withTrashLock(async () => {
      try {
        const sourcePath = await this.resolvePath(relativePath, {
          followFinalSymlink: false,
          allowRoot: false,
        });
        const { basePath, itemsPath } = await this.getTrashPaths();
        if (isPathInside(basePath, sourcePath)) {
          throw new AppError('The internal trash store cannot be moved to trash', {
            code: 'TRASH_STORE_IMMUTABLE',
            statusCode: 403,
          });
        }

        const sourceStats = await lstat(sourcePath);
        const id = randomUUID();
        const trashPath = path.join(itemsPath, id);
        await mkdir(itemsPath, { recursive: true });
        await this.movePath(sourcePath, trashPath);

        const entry: FileManagerTrashEntry = {
          id,
          name: path.basename(sourcePath),
          originalPath: await this.toRelativePath(sourcePath),
          type: sourceStats.isSymbolicLink()
            ? 'symlink'
            : sourceStats.isDirectory()
              ? 'directory'
              : 'file',
          size: sourceStats.size,
          deletedAt: new Date().toISOString(),
        };
        const manifest = await this.readTrashManifest();
        manifest.entries.push(entry);
        await this.writeTrashManifest(manifest);
        return entry;
      } catch (error) {
        throw fileError(error, 'Unable to move entry to trash');
      }
    });
  }

  async listTrash(): Promise<FileManagerTrashEntry[]> {
    const manifest = await this.readTrashManifest();
    const { itemsPath } = await this.getTrashPaths();
    const existingEntries = await Promise.all(
      manifest.entries.map(async (entry) => (
        (await pathExists(path.join(itemsPath, entry.id))) ? entry : null
      )),
    );
    return existingEntries
      .filter((entry): entry is FileManagerTrashEntry => entry !== null)
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
  }

  async restoreTrashEntry(id: string): Promise<FileManagerEntry> {
    return this.withTrashLock(async () => {
      if (!id) {
        throw new AppError('Trash entry id is required', {
          code: 'INVALID_TRASH_ID',
          statusCode: 400,
        });
      }

      try {
        const manifest = await this.readTrashManifest();
        const entry = manifest.entries.find((candidate) => candidate.id === id);
        if (!entry) {
          throw new AppError('Trash entry not found', {
            code: 'TRASH_ENTRY_NOT_FOUND',
            statusCode: 404,
          });
        }

        const { itemsPath } = await this.getTrashPaths();
        const trashPath = path.join(itemsPath, entry.id);
        const destinationPath = await this.resolvePath(entry.originalPath, { mustExist: false });
        await this.assertDestinationAvailable(destinationPath);
        await this.movePath(trashPath, destinationPath);

        manifest.entries = manifest.entries.filter((candidate) => candidate.id !== id);
        await this.writeTrashManifest(manifest);
        return this.getEntry(destinationPath);
      } catch (error) {
        throw fileError(error, 'Unable to restore trash entry');
      }
    });
  }

  async permanentlyDeleteTrashEntry(id: string): Promise<void> {
    return this.withTrashLock(async () => {
      if (!id) {
        throw new AppError('Trash entry id is required', {
          code: 'INVALID_TRASH_ID',
          statusCode: 400,
        });
      }

      try {
        const manifest = await this.readTrashManifest();
        const entry = manifest.entries.find((candidate) => candidate.id === id);
        if (!entry) {
          throw new AppError('Trash entry not found', {
            code: 'TRASH_ENTRY_NOT_FOUND',
            statusCode: 404,
          });
        }
        const { itemsPath } = await this.getTrashPaths();
        const trashPath = path.join(itemsPath, entry.id);
        if (await pathExists(trashPath)) {
          await this.removePath(trashPath);
        }
        manifest.entries = manifest.entries.filter((candidate) => candidate.id !== id);
        await this.writeTrashManifest(manifest);
      } catch (error) {
        throw fileError(error, 'Unable to permanently delete trash entry');
      }
    });
  }

  async emptyTrash(): Promise<void> {
    return this.withTrashLock(async () => {
      try {
        const { itemsPath } = await this.getTrashPaths();
        await rm(itemsPath, { recursive: true, force: true });
        await this.writeTrashManifest({ version: 1, entries: [] });
      } catch (error) {
        throw fileError(error, 'Unable to empty trash');
      }
    });
  }

  async resolveWatchDirectory(relativePath: string): Promise<{ absolutePath: string; relativePath: string }> {
    const absolutePath = await this.resolvePath(relativePath || '');
    const directoryStats = await stat(absolutePath);
    if (!directoryStats.isDirectory()) {
      throw new AppError('Watch path is not a directory', {
        code: 'PATH_NOT_DIRECTORY',
        statusCode: 400,
      });
    }
    return {
      absolutePath,
      relativePath: await this.toRelativePath(absolutePath),
    };
  }

  async getRelativePathForEvent(absolutePath: string): Promise<string | null> {
    const rootPath = await this.getRootPath();
    const normalizedPath = path.resolve(absolutePath);
    if (!isPathInside(rootPath, normalizedPath)) {
      return null;
    }
    return path.relative(rootPath, normalizedPath).split(path.sep).join('/');
  }
}

export const fileManagerService = new FileManagerService();
