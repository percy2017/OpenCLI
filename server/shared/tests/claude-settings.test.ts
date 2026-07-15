import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncClaudeUserPermissions } from '../claude-settings.js';

const createSettingsPath = async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-claude-settings-'));
  const claudeDirectory = path.join(rootPath, '.claude');
  const settingsPath = path.join(claudeDirectory, 'settings.json');
  await mkdir(claudeDirectory, { recursive: true });
  return { rootPath, settingsPath };
};

test('syncs Claude permissions while preserving unrelated settings', async () => {
  const { rootPath, settingsPath } = await createSettingsPath();

  try {
    await writeFile(settingsPath, `${JSON.stringify({
      theme: 'dark',
      env: { ANTHROPIC_API_KEY: 'configured-elsewhere' },
      permissions: {
        ask: ['Bash(curl:*)'],
        additionalDirectories: ['/workspace'],
      },
    })}\n`, 'utf8');

    await syncClaudeUserPermissions({
      allowedTools: ['Read', 'Bash(git status:*)'],
      disallowedTools: ['WebSearch'],
      skipPermissions: true,
    }, settingsPath);

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    assert.deepEqual(settings, {
      theme: 'dark',
      env: { ANTHROPIC_API_KEY: 'configured-elsewhere' },
      permissions: {
        ask: ['Bash(curl:*)'],
        additionalDirectories: ['/workspace'],
        allow: ['Read', 'Bash(git status:*)'],
        deny: ['WebSearch'],
        defaultMode: 'bypassPermissions',
      },
    });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('creates Claude settings and disables bypass mode when permissions are not skipped', async () => {
  const { rootPath, settingsPath } = await createSettingsPath();

  try {
    await syncClaudeUserPermissions({
      allowedTools: [],
      disallowedTools: ['Task'],
      skipPermissions: false,
    }, settingsPath);

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    assert.deepEqual(settings.permissions, {
      allow: [],
      deny: ['Task'],
      defaultMode: 'default',
    });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
