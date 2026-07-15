import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileManagerService } from '@/modules/file-manager/file-manager.service.js';
import { AppError } from '@/shared/utils.js';

const withTempService = async (
  run: (service: FileManagerService, rootPath: string) => Promise<void>,
) => {
  const tempPath = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-file-manager-'));
  const rootPath = path.join(tempPath, 'workspace');
  const homePath = path.join(tempPath, 'home');
  await mkdir(rootPath, { recursive: true });
  await mkdir(homePath, { recursive: true });

  const originalHome = os.homedir;
  os.homedir = () => homePath;
  try {
    await run(new FileManagerService(rootPath), rootPath);
  } finally {
    os.homedir = originalHome;
    await rm(tempPath, { recursive: true, force: true });
  }
};

test('lists hidden and normally ignored entries while containing traversal and symlinks', { concurrency: false }, async () => {
  await withTempService(async (service, rootPath) => {
    const outsidePath = path.join(path.dirname(rootPath), 'outside.txt');
    await mkdir(path.join(rootPath, '.hidden-directory'));
    await mkdir(path.join(rootPath, 'node_modules'));
    await writeFile(path.join(rootPath, '.hidden-file'), 'hidden', 'utf8');
    await writeFile(path.join(rootPath, 'node_modules', 'package.js'), 'ignored elsewhere', 'utf8');
    await writeFile(outsidePath, 'outside', 'utf8');
    await symlink(outsidePath, path.join(rootPath, 'outside-link'));

    const entries = await service.listEntries('');
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      ['.hidden-directory', '.hidden-file', 'node_modules', 'outside-link'].sort(),
    );
    assert.equal(entries.find((entry) => entry.name === '.hidden-file')?.hidden, true);
    assert.equal(entries.find((entry) => entry.name === 'outside-link')?.type, 'symlink');

    await assert.rejects(
      service.readFile('../outside.txt'),
      (error: unknown) => error instanceof AppError && error.code === 'FILE_PATH_OUTSIDE_ROOT',
    );
    await assert.rejects(
      service.readFile('outside-link'),
      (error: unknown) => error instanceof AppError && error.code === 'SYMLINK_OUTSIDE_ROOT',
    );
    await assert.rejects(
      service.trashEntry(''),
      (error: unknown) => error instanceof AppError && error.code === 'WORKSPACES_ROOT_IMMUTABLE',
    );
  });
});

test('supports create, edit, rename, copy, move, upload, download lookup, and trash lifecycle', { concurrency: false }, async () => {
  await withTempService(async (service, rootPath) => {
    await service.createEntry({ parentPath: '', name: 'src', type: 'directory' });
    await service.createEntry({ parentPath: 'src', name: '.env', type: 'file' });
    await service.writeFile('src/.env', 'TOKEN=test');
    assert.equal((await service.readFile('src/.env')).content, 'TOKEN=test');

    const renamed = await service.renameEntry('src/.env', '.env.local');
    assert.equal(renamed.path, 'src/.env.local');

    const copied = await service.copyEntry({
      sourcePath: 'src/.env.local',
      targetDirectory: '',
      newName: 'copy.txt',
    });
    assert.equal(copied.path, 'copy.txt');

    const moved = await service.moveEntry({
      sourcePath: 'copy.txt',
      targetDirectory: 'src',
      newName: 'moved.txt',
    });
    assert.equal(moved.path, 'src/moved.txt');

    const uploadSource = path.join(path.dirname(rootPath), 'upload.tmp');
    await writeFile(uploadSource, 'uploaded', 'utf8');
    const uploaded = await service.storeUploadedFile(uploadSource, 'src', 'upload.txt');
    assert.equal(uploaded.path, 'src/upload.txt');
    assert.equal(await readFile(path.join(rootPath, 'src', 'upload.txt'), 'utf8'), 'uploaded');

    const readable = await service.getReadableFile('src/moved.txt');
    assert.equal(readable.name, 'moved.txt');

    const trashed = await service.trashEntry('src/moved.txt');
    assert.equal(trashed.originalPath, 'src/moved.txt');
    assert.deepEqual((await service.listTrash()).map((entry) => entry.id), [trashed.id]);

    const restored = await service.restoreTrashEntry(trashed.id);
    assert.equal(restored.path, 'src/moved.txt');
    assert.equal((await service.readFile('src/moved.txt')).content, 'TOKEN=test');

    const trashedAgain = await service.trashEntry('src/moved.txt');
    await service.permanentlyDeleteTrashEntry(trashedAgain.id);
    assert.equal((await service.listTrash()).length, 0);

    await service.trashEntry('src/upload.txt');
    await service.emptyTrash();
    assert.equal((await service.listTrash()).length, 0);
  });
});

test('handles batch transfer, trash and archive creation', { concurrency: false }, async () => {
  await withTempService(async (service, rootPath) => {
    await service.createEntry({ parentPath: '', name: 'src', type: 'directory' });
    await service.createEntry({ parentPath: 'src', name: 'a.txt', type: 'file' });
    await service.createEntry({ parentPath: 'src', name: 'b.txt', type: 'file' });
    await service.writeFile('src/a.txt', 'a');
    await service.writeFile('src/b.txt', 'b');
    await service.createEntry({ parentPath: 'src', name: 'nested', type: 'directory' });
    await service.createEntry({ parentPath: 'src/nested', name: 'c.txt', type: 'file' });
    await service.writeFile('src/nested/c.txt', 'c');

    const copied = await service.transferEntries([
      { sourcePath: 'src/a.txt', targetDirectory: '' },
      { sourcePath: 'src/b.txt', targetDirectory: '' },
    ], 'copy');
    assert.equal(copied.entries.length, 2);
    assert.equal(copied.errors.length, 0);

    const moved = await service.transferEntries([
      { sourcePath: 'src/nested', targetDirectory: '' },
    ], 'move');
    assert.equal(moved.entries.length, 1);
    assert.equal(moved.entries[0].path, 'nested');
    assert.equal(await readFile(path.join(rootPath, 'nested', 'c.txt'), 'utf8'), 'c');

    const archive = await service.createArchive(['src/a.txt', 'nested/c.txt']);
    assert.ok(archive.buffer.length > 0);
    assert.match(archive.filename, /\.zip$/);

    const trashed = await service.trashEntries(['a.txt', 'b.txt']);
    assert.equal(trashed.entries.length, 2);
    assert.equal((await service.listTrash()).length, 2);
  });
});
