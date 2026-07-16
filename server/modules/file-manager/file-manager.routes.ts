import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express, { type RequestHandler } from 'express';
import multer from 'multer';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { fileManagerService } from './file-manager.service.js';

const router = express.Router();
const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_FILES = 20;

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, callback) => callback(null, `opencli-upload-${randomUUID()}`),
  }),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: MAX_UPLOAD_FILES,
  },
});

const uploadFiles: RequestHandler = (req, res, next) => {
  upload.array('files', MAX_UPLOAD_FILES)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const multerError = error as multer.MulterError;
    const message = multerError.code === 'LIMIT_FILE_SIZE'
      ? 'A file exceeds the 200 MB upload limit'
      : multerError.code === 'LIMIT_FILE_COUNT'
        ? `A maximum of ${MAX_UPLOAD_FILES} files can be uploaded at once`
        : multerError.message;
    next(new AppError(message, {
      code: 'FILE_UPLOAD_REJECTED',
      statusCode: 400,
    }));
  });
};

function readQueryPath(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new AppError('Path query parameter is required', {
    code: 'INVALID_FILE_PATH',
    statusCode: 400,
  });
}

function readBodyString(body: unknown, key: string, fallback?: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value === 'string') {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new AppError(`${key} must be a string`, {
    code: 'INVALID_FILE_MANAGER_INPUT',
    statusCode: 400,
  });
}

function readRouteParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === 'string' && value) {
    return value;
  }
  throw new AppError(`${name} route parameter is required`, {
    code: 'INVALID_FILE_MANAGER_INPUT',
    statusCode: 400,
  });
}

function readBodyPaths(body: unknown): string[] {
  const paths = (body as Record<string, unknown> | null)?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((value) => typeof value !== 'string')) {
    throw new AppError('paths must be a non-empty array of strings', {
      code: 'EMPTY_FILE_SELECTION',
      statusCode: 400,
    });
  }
  return paths;
}

router.get(
  '/root',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await fileManagerService.getRootInfo()));
  }),
);

router.get(
  '/entries',
  asyncHandler(async (req, res) => {
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
    const entries = await fileManagerService.listEntries(requestedPath);
    res.json(createApiSuccessResponse({ path: requestedPath, entries }));
  }),
);

router.get(
  '/file',
  asyncHandler(async (req, res) => {
    const file = await fileManagerService.readFile(readQueryPath(req.query.path));
    res.json(createApiSuccessResponse(file));
  }),
);

router.put(
  '/file',
  asyncHandler(async (req, res) => {
    const entry = await fileManagerService.writeFile(
      readBodyString(req.body, 'path'),
      (req.body as Record<string, unknown> | null)?.content,
    );
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.get(
  '/raw',
  asyncHandler(async (req, res, next) => {
    const file = await fileManagerService.getReadableFile(readQueryPath(req.query.path));
    res.sendFile(file.absolutePath, (error) => {
      if (error && !res.headersSent) {
        next(error);
      }
    });
  }),
);

router.get(
  '/download',
  asyncHandler(async (req, res, next) => {
    const file = await fileManagerService.getReadableFile(readQueryPath(req.query.path));
    res.download(file.absolutePath, file.name, (error) => {
      if (error && !res.headersSent) {
        next(error);
      }
    });
  }),
);

router.post(
  '/download/archive',
  asyncHandler(async (req, res) => {
    const archive = await fileManagerService.createArchive(readBodyPaths(req.body));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
    res.send(archive.buffer);
  }),
);

router.post(
  '/entries',
  asyncHandler(async (req, res) => {
    const type = (req.body as Record<string, unknown> | null)?.type;
    if (type !== 'file' && type !== 'directory') {
      throw new AppError('type must be file or directory', {
        code: 'INVALID_ENTRY_TYPE',
        statusCode: 400,
      });
    }
    const entry = await fileManagerService.createEntry({
      parentPath: readBodyString(req.body, 'parentPath', ''),
      name: readBodyString(req.body, 'name'),
      type,
    });
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.patch(
  '/entries/rename',
  asyncHandler(async (req, res) => {
    const entry = await fileManagerService.renameEntry(
      readBodyString(req.body, 'path'),
      readBodyString(req.body, 'newName'),
    );
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.post(
  '/entries/copy',
  asyncHandler(async (req, res) => {
    const newName = (req.body as Record<string, unknown> | null)?.newName;
    const entry = await fileManagerService.copyEntry({
      sourcePath: readBodyString(req.body, 'sourcePath'),
      targetDirectory: readBodyString(req.body, 'targetDirectory', ''),
      ...(typeof newName === 'string' && newName ? { newName } : {}),
    });
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.post(
  '/entries/move',
  asyncHandler(async (req, res) => {
    const newName = (req.body as Record<string, unknown> | null)?.newName;
    const entry = await fileManagerService.moveEntry({
      sourcePath: readBodyString(req.body, 'sourcePath'),
      targetDirectory: readBodyString(req.body, 'targetDirectory', ''),
      ...(typeof newName === 'string' && newName ? { newName } : {}),
    });
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.post(
  '/entries/batch/copy',
  asyncHandler(async (req, res) => {
    const targetDirectory = readBodyString(req.body, 'targetDirectory', '');
    const result = await fileManagerService.transferEntries(
      readBodyPaths(req.body).map((sourcePath) => ({ sourcePath, targetDirectory })),
      'copy',
    );
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/entries/batch/move',
  asyncHandler(async (req, res) => {
    const targetDirectory = readBodyString(req.body, 'targetDirectory', '');
    const result = await fileManagerService.transferEntries(
      readBodyPaths(req.body).map((sourcePath) => ({ sourcePath, targetDirectory })),
      'move',
    );
    res.json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/entries/batch',
  asyncHandler(async (req, res) => {
    const result = await fileManagerService.trashEntries(readBodyPaths(req.body));
    res.json(createApiSuccessResponse(result));
  }),
);

router.delete(
  '/entries',
  asyncHandler(async (req, res) => {
    const entry = await fileManagerService.trashEntry(readBodyString(req.body, 'path'));
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.post(
  '/upload',
  uploadFiles,
  asyncHandler(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      throw new AppError('At least one file is required', {
        code: 'FILE_UPLOAD_EMPTY',
        statusCode: 400,
      });
    }

    const targetDirectory = readBodyString(req.body, 'targetDirectory', '');
    try {
      const entries = [];
      for (const file of files) {
        entries.push(await fileManagerService.storeUploadedFile(
          file.path,
          targetDirectory,
          path.basename(file.originalname),
        ));
      }
      res.json(createApiSuccessResponse({ entries }));
    } finally {
      await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
    }
  }),
);

router.get(
  '/trash',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ entries: await fileManagerService.listTrash() }));
  }),
);

router.post(
  '/trash/:id/restore',
  asyncHandler(async (req, res) => {
    const id = readRouteParam(req.params.id, 'id');
    const entry = await fileManagerService.restoreTrashEntry(id);
    res.json(createApiSuccessResponse({ entry }));
  }),
);

router.delete(
  '/trash/:id',
  asyncHandler(async (req, res) => {
    const id = readRouteParam(req.params.id, 'id');
    await fileManagerService.permanentlyDeleteTrashEntry(id);
    res.json(createApiSuccessResponse({ id }));
  }),
);

router.delete(
  '/trash',
  asyncHandler(async (_req, res) => {
    await fileManagerService.emptyTrash();
    res.json(createApiSuccessResponse({ emptied: true }));
  }),
);

export default router;
