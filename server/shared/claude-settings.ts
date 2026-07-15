import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readJsonConfig, readObjectRecord } from './utils.js';

export type ClaudeUserPermissions = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
};

const getClaudeSettingsPath = (): string => path.join(os.homedir(), '.claude', 'settings.json');

let settingsWriteQueue: Promise<void> = Promise.resolve();

const writeJsonConfigAtomically = async (
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> => {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(directoryPath, { recursive: true });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};

const writeClaudeUserPermissions = async (
  permissions: ClaudeUserPermissions,
  filePath: string,
): Promise<void> => {
  const settings = await readJsonConfig(filePath);
  const currentPermissions = readObjectRecord(settings.permissions) ?? {};

  settings.permissions = {
    ...currentPermissions,
    allow: permissions.allowedTools,
    deny: permissions.disallowedTools,
    defaultMode: permissions.skipPermissions ? 'bypassPermissions' : 'default',
  };

  await writeJsonConfigAtomically(filePath, settings);
};

export const syncClaudeUserPermissions = (
  permissions: ClaudeUserPermissions,
  filePath: string = getClaudeSettingsPath(),
): Promise<void> => {
  const operation = settingsWriteQueue.then(() => writeClaudeUserPermissions(permissions, filePath));
  settingsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
};
