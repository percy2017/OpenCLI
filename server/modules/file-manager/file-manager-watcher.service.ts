import chokidar from 'chokidar';
import type { WebSocket } from 'ws';

import { fileManagerService } from './file-manager.service.js';

const WS_OPEN_STATE = 1;

type SubscriptionMessage = {
  type?: unknown;
  paths?: unknown;
};

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

export function handleFileManagerConnection(ws: WebSocket): void {
  const watcher = chokidar.watch([], {
    depth: 0,
    followSymlinks: false,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  });
  const watchedDirectories = new Map<string, string>();

  const syncSubscriptions = async (relativePaths: string[]) => {
    const requestedPaths = new Set(['', ...relativePaths]);
    const resolvedDirectories = new Map<string, string>();

    for (const relativePath of requestedPaths) {
      try {
        const directory = await fileManagerService.resolveWatchDirectory(relativePath);
        resolvedDirectories.set(directory.relativePath, directory.absolutePath);
      } catch (error) {
        sendJson(ws, {
          type: 'file-manager:error',
          path: relativePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const [relativePath, absolutePath] of watchedDirectories) {
      if (!resolvedDirectories.has(relativePath)) {
        await watcher.unwatch(absolutePath);
        watchedDirectories.delete(relativePath);
      }
    }

    for (const [relativePath, absolutePath] of resolvedDirectories) {
      if (!watchedDirectories.has(relativePath)) {
        watcher.add(absolutePath);
        watchedDirectories.set(relativePath, absolutePath);
      }
    }

    sendJson(ws, {
      type: 'file-manager:subscribed',
      paths: [...watchedDirectories.keys()],
    });
  };

  watcher.on('all', (event, changedPath) => {
    void fileManagerService.getRelativePathForEvent(changedPath).then((relativePath) => {
      if (relativePath === null) {
        return;
      }
      const parentPath = relativePath.includes('/')
        ? relativePath.slice(0, relativePath.lastIndexOf('/'))
        : '';
      sendJson(ws, {
        type: 'file-manager:change',
        event,
        path: relativePath,
        parentPath,
      });
    });
  });

  watcher.on('error', (error) => {
    sendJson(ws, {
      type: 'file-manager:error',
      message: error instanceof Error ? error.message : String(error),
    });
  });

  ws.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString()) as SubscriptionMessage;
      if (message.type !== 'file-manager:subscribe' || !Array.isArray(message.paths)) {
        return;
      }
      const paths = message.paths.filter((value): value is string => typeof value === 'string');
      void syncSubscriptions(paths);
    } catch {
      sendJson(ws, {
        type: 'file-manager:error',
        message: 'Invalid file-manager subscription message',
      });
    }
  });

  const closeWatcher = () => {
    void watcher.close();
  };
  ws.once('close', closeWatcher);
  ws.once('error', closeWatcher);

  void syncSubscriptions([]).then(() => {
    sendJson(ws, { type: 'file-manager:ready' });
  });
}
