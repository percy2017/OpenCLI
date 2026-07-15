import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import { findAppRoot } from '@/utils/runtime-paths.js';

export { ensureRagMcpOnStartup } from './rag-mcp-installer.js';

const SEEDED_KEY = 'skills_bundled_v1';
const SEEDED_VERSION = '1';
const SKILL_FILE_NAME = 'SKILL.md';

const CLAUDE_SKILLS_ROOT = path.join(os.homedir(), '.claude', 'skills');

function resolveBundledSkillsRoot(): string {
  // Compiled layout: dist-server/server/modules/first-run/first-run.service.ts
  //   -> ../../.. -> dist-server/  -> .. -> app root  -> bundled/skills
  // Dev layout: server/modules/first-run/first-run.service.ts
  //   -> ../../.. -> <app>/server  -> .. -> <app>     -> bundled/skills
  // findAppRoot already collapses both layouts to the real app root.
  const appRoot = findAppRoot(import.meta.url);
  return path.join(appRoot, 'bundled', 'skills');
}

async function readSeededState(): Promise<{ seeded: boolean; version: string | null }> {
  try {
    const raw = appConfigDb.get(SEEDED_KEY);
    if (!raw) {
      return { seeded: false, version: null };
    }
    const parsed = JSON.parse(raw) as { version?: string };
    return { seeded: true, version: typeof parsed.version === 'string' ? parsed.version : null };
  } catch {
    return { seeded: false, version: null };
  }
}

function writeSeededState(version: string): void {
  appConfigDb.set(SEEDED_KEY, JSON.stringify({
    version,
    seededAt: new Date().toISOString(),
  }));
}

async function listBundledSkillNames(bundledRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(bundledRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readSkillMarkdown(bundledRoot: string, skillName: string): Promise<string> {
  const skillPath = path.join(bundledRoot, skillName, SKILL_FILE_NAME);
  return readFile(skillPath, 'utf8');
}

async function writeSkillToHome(skillName: string, markdown: string, targetRoot: string): Promise<{ wrote: boolean; reason?: string }> {
  const targetDir = path.join(targetRoot, skillName);
  const targetFile = path.join(targetDir, SKILL_FILE_NAME);

  try {
    await mkdir(targetDir, { recursive: true });
  } catch (error) {
    return { wrote: false, reason: `mkdir failed: ${(error as Error).message}` };
  }

  try {
    await writeFile(targetFile, markdown, 'utf8');
    return { wrote: true };
  } catch (error) {
    return { wrote: false, reason: `write failed: ${(error as Error).message}` };
  }
}

type SeedTarget = {
  label: 'claude';
  rootDir: string;
};

const SEED_TARGETS: SeedTarget[] = [
  { label: 'claude', rootDir: CLAUDE_SKILLS_ROOT },
];

export type SeedResult = {
  skills: number;
  targets: Array<{ label: SeedTarget['label']; rootDir: string; installed: number }>;
  skippedReason?: string;
};

export async function seedBundledSkills(): Promise<SeedResult> {
  const state = await readSeededState();
  if (state.seeded && state.version === SEEDED_VERSION) {
    return {
      skills: 0,
      targets: SEED_TARGETS.map((target) => ({ label: target.label, rootDir: target.rootDir, installed: 0 })),
      skippedReason: 'already-seeded',
    };
  }

  const bundledRoot = resolveBundledSkillsRoot();
  const names = await listBundledSkillNames(bundledRoot);
  if (names.length === 0) {
    // Nothing to seed — still mark as seeded so we don't keep re-scanning.
    writeSeededState(SEEDED_VERSION);
    return {
      skills: 0,
      targets: SEED_TARGETS.map((target) => ({ label: target.label, rootDir: target.rootDir, installed: 0 })),
      skippedReason: 'no-bundled-skills',
    };
  }

  const results: SeedResult = {
    skills: names.length,
    targets: SEED_TARGETS.map((target) => ({ label: target.label, rootDir: target.rootDir, installed: 0 })),
  };

  for (const name of names) {
    let markdown: string;
    try {
      markdown = await readSkillMarkdown(bundledRoot, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Folder without a SKILL.md — skip silently.
        continue;
      }
      console.warn(`[first-run] Failed to read bundled skill "${name}":`, (error as Error).message);
      continue;
    }

    for (const target of SEED_TARGETS) {
      const writeResult = await writeSkillToHome(name, markdown, target.rootDir);
      if (writeResult.wrote) {
        const targetResult = results.targets.find((entry) => entry.label === target.label);
        if (targetResult) {
          targetResult.installed += 1;
        }
      } else {
        console.warn(`[first-run] Failed to install "${name}" into ${target.rootDir}: ${writeResult.reason}`);
      }
    }
  }

  writeSeededState(SEEDED_VERSION);
  return results;
}

export async function runFirstRunOnStartup(): Promise<void> {
  try {
    const result = await seedBundledSkills();
    if (result.skippedReason === 'already-seeded') {
      console.log('[first-run] Bundled skills already seeded; skipping.');
      return;
    }
    if (result.skippedReason === 'no-bundled-skills') {
      console.log('[first-run] No bundled skills found.');
      return;
    }
    for (const target of result.targets) {
      console.log(`[first-run] Seeded ${target.installed} skill(s) into ${target.rootDir}`);
    }
  } catch (error) {
    console.warn('[first-run] Skill seeding failed:', (error as Error).message);
  }
}