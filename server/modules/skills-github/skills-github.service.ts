import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { providerSkillsService } from '@/modules/providers/index.js';
import type { LLMProvider, ProviderSkill } from '@/shared/types.js';

import { buildSkillCreateEntriesFromExtractedRepo } from './github-extract-walker.js';
import { fetchAndExtractGitHubTarball } from './github-fetcher.js';
import { parseAndValidateGithubUrl } from './github-url.js';

type InstallFromGithubInput = {
  url: string;
  ref?: string;
};

type InstalledRepoRef = {
  owner: string;
  repo: string;
  ref: string;
};

type InstallFromGithubResult = {
  provider: LLMProvider;
  repo: InstalledRepoRef;
  skills: ProviderSkill[];
  total: number;
};

const githubSkillsService = {
  /**
   * Resolves a GitHub repo URL, downloads the matching tarball, walks the
   * extracted tree for SKILL.md files, and installs each skill through
   * the shared provider pipeline.
   *
   * The temp directory is always cleaned up, including on validation or write
   * failure. Provider-unsupported errors from `addProviderSkills` are rethrown
   * verbatim so the route layer can map them to a controlled response.
   */
  async installFromGithub(
    provider: LLMProvider,
    input: InstallFromGithubInput,
  ): Promise<InstallFromGithubResult> {
    const parsed = parseAndValidateGithubUrl(input.url, { refOverride: input.ref });

    const tmpRoot = path.join(
      os.tmpdir(),
      `cloudcli-skill-install-${randomUUID()}`,
    );

    await mkdir(tmpRoot, { recursive: true });

    try {
      const tarResult = await fetchAndExtractGitHubTarball(parsed.tarballUrl, {
        tmpRoot,
      });

      void tarResult; // included for observability / future logging

      const { entries, total } = await buildSkillCreateEntriesFromExtractedRepo(tmpRoot);

      const skills = await providerSkillsService.addProviderSkills(provider, { entries });

      return {
        provider,
        repo: { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref },
        skills,
        total,
      };
    } finally {
      // Best-effort cleanup; a leftover tmp dir is not worth propagating to the
      // caller because the install either succeeded or errored out cleanly.
      void rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

export { githubSkillsService };
export type { InstallFromGithubInput, InstallFromGithubResult };
// InstallFromGithubResult is exported via `export type` above; this file is the
// canonical source of the type and the only one that needs the alias.
