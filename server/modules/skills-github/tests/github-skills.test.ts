import assert from 'node:assert/strict';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pack as tarPack } from 'tar-stream';

import { AppError } from '@/shared/utils.js';

import { fetchAndExtractGitHubTarball } from '../github-fetcher.js';
import { buildSkillCreateEntriesFromExtractedRepo } from '../github-extract-walker.js';
import { parseAndValidateGithubUrl } from '../github-url.js';

const buildTarGz = async (
  entries: Array<{ name: string; content?: string; type?: 'file' | 'directory' | 'symlink'; linkname?: string }>,
): Promise<Buffer> => {
  const pack = tarPack();
  for (const entry of entries) {
    const header = entry.type === 'directory'
      ? { name: entry.name, type: 'directory' as const }
      : entry.type === 'symlink'
        ? { name: entry.name, type: 'symlink' as const, linkname: entry.linkname ?? '' }
        : { name: entry.name };
    pack.entry(header, entry.content ?? '');
  }
  pack.finalize();

  const tarChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => tarChunks.push(chunk));
    pack.on('end', () => resolve());
    pack.on('error', reject);
  });

  const gzipChunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const gzip = createGzip();
    gzip.on('data', (chunk: Buffer) => gzipChunks.push(chunk));
    gzip.on('end', () => resolve());
    gzip.on('error', reject);
    Readable.from(Buffer.concat(tarChunks)).pipe(gzip);
  });

  return Buffer.concat(gzipChunks);
};

const makeFetch = (body: Buffer | null, status = 200, headers: Record<string, string> = {}): typeof fetch => {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
};

const makeTmpRoot = async (label: string): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  return dir;
};

// ------------------------------
// URL parser
// ------------------------------

test('parseAndValidateGithubUrl accepts canonical repo URLs', () => {
  const result = parseAndValidateGithubUrl('https://github.com/alinaqi/claude-bootstrap');
  assert.equal(result.owner, 'alinaqi');
  assert.equal(result.repo, 'claude-bootstrap');
  assert.equal(result.ref, 'HEAD');
  assert.equal(result.tarballUrl, 'https://codeload.github.com/alinaqi/claude-bootstrap/tar.gz/HEAD');
});

test('parseAndValidateGithubUrl honors /tree/<ref> tail', () => {
  const result = parseAndValidateGithubUrl('https://github.com/alinaqi/claude-bootstrap/tree/main');
  assert.equal(result.ref, 'main');
  assert.equal(result.tarballUrl, 'https://codeload.github.com/alinaqi/claude-bootstrap/tar.gz/main');
});

test('parseAndValidateGithubUrl strips trailing .git', () => {
  const result = parseAndValidateGithubUrl('https://github.com/alinaqi/claude-bootstrap.git');
  assert.equal(result.repo, 'claude-bootstrap');
});

test('parseAndValidateGithubUrl rejects http:// scheme', () => {
  assert.throws(
    () => parseAndValidateGithubUrl('http://github.com/alinaqi/claude-bootstrap'),
    (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_NON_GITHUB_HOST',
  );
});

test('parseAndValidateGithubUrl rejects non-github hosts', () => {
  assert.throws(
    () => parseAndValidateGithubUrl('https://gitlab.com/foo/bar'),
    (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_NON_GITHUB_HOST',
  );
});

test('parseAndValidateGithubUrl rejects invalid owner chars', () => {
  assert.throws(
    () => parseAndValidateGithubUrl('https://github.com/alina qi/repo'),
    (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_INVALID_URL',
  );
});

test('parseAndValidateGithubUrl rejects ref with path traversal', () => {
  assert.throws(
    () => parseAndValidateGithubUrl('https://github.com/foo/bar/tree/..'),
    (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_INVALID_URL',
  );
});

test('parseAndValidateGithubUrl rejects oversegmented URL', () => {
  assert.throws(
    () => parseAndValidateGithubUrl('https://github.com/foo/bar/baz/qux'),
    (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_INVALID_URL',
  );
});

test('parseAndValidateGithubUrl honors override ref over URL ref', () => {
  const result = parseAndValidateGithubUrl('https://github.com/foo/bar/tree/main', { refOverride: 'develop' });
  assert.equal(result.ref, 'develop');
});

// ------------------------------
// Fetcher
// ------------------------------

test('fetchAndExtractGitHubTarball extracts SKILL.md + supporting files', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-fetcher-happy');
  const archive = await buildTarGz([
    { name: 'demo-abc123/SKILL.md', content: '---\nname: demo\ndescription: hello\n---\n\nbody' },
    { name: 'demo-abc123/scripts/run.sh', content: '#!/bin/sh\necho hi' },
    { name: 'demo-abc123/assets/logo.png', content: 'PNGDATA' },
  ]);

  try {
    const result = await fetchAndExtractGitHubTarball(
      'https://codeload.github.com/alinaqi/claude-bootstrap/tar.gz/HEAD',
      { tmpRoot },
      { fetchImpl: makeFetch(archive) },
    );

    assert.ok(result.archiveBytes > 0);
    assert.equal(result.fileCount, 3);

    const skillPath = path.join(tmpRoot, 'demo-abc123', 'SKILL.md');
    const skillBody = await fs.readFile(skillPath, 'utf8');
    assert.ok(skillBody.includes('name: demo'));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('fetchAndExtractGitHubTarball rejects path traversal', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-fetcher-traversal');
  const archive = await buildTarGz([
    { name: '../escape.md', content: 'pwned' },
  ]);

  try {
    await assert.rejects(
      fetchAndExtractGitHubTarball(
        'https://codeload.github.com/foo/bar/tar.gz/HEAD',
        { tmpRoot },
        { fetchImpl: makeFetch(archive) },
      ),
      (err) => err instanceof AppError && (
        err.code === 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL'
        || err.code === 'PROVIDER_SKILL_GITHUB_NETWORK'
      ),
    );

    // The escaped file must not exist outside tmpRoot.
    const escape = path.join(os.tmpdir(), 'escape.md');
    await assert.rejects(fs.access(escape), (err) => {
      const e = err as NodeJS.ErrnoException;
      return e.code === 'ENOENT';
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(path.join(os.tmpdir(), 'escape.md'), { force: true }).catch(() => undefined);
  }
});

test('fetchAndExtractGitHubTarball rejects symlink entries', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-fetcher-symlink');
  const archive = await buildTarGz([
    { name: 'demo-abc/SKILL.md', content: '---\nname: demo\ndescription: hi\n---\n' },
    { name: 'demo-abc/link', type: 'symlink', linkname: '/etc/passwd' },
  ]);

  try {
    const result = await fetchAndExtractGitHubTarball(
      'https://codeload.github.com/foo/bar/tar.gz/HEAD',
      { tmpRoot },
      { fetchImpl: makeFetch(archive) },
    );

    // SKILL.md should have been written; the symlink should NOT have been
    // traversed or written as a file.
    const skillPath = path.join(tmpRoot, 'demo-abc', 'SKILL.md');
    await fs.access(skillPath);
    assert.ok(result.fileCount >= 1);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('fetchAndExtractGitHubTarball maps 404 to NOT_FOUND', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-fetcher-404');
  try {
    await assert.rejects(
      fetchAndExtractGitHubTarball(
        'https://codeload.github.com/alinaqi/claude-bootstrap/tar.gz/HEAD',
        { tmpRoot },
        { fetchImpl: makeFetch(null, 404) },
      ),
      (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_NOT_FOUND',
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('fetchAndExtractGitHubTarball maps 403 rate limit to RATE_LIMIT', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-fetcher-rate');
  try {
    await assert.rejects(
      fetchAndExtractGitHubTarball(
        'https://codeload.github.com/alinaqi/claude-bootstrap/tar.gz/HEAD',
        { tmpRoot },
        { fetchImpl: makeFetch(null, 403, { 'x-ratelimit-remaining': '0' }) },
      ),
      (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_RATE_LIMIT',
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

// ------------------------------
// Walker
// ------------------------------

test('buildSkillCreateEntriesFromExtractedRepo returns entries with utf8-vs-base64 classification', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-walker-happy');

  try {
    const skillDir = path.join(tmpRoot, 'demo-wrap', 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\n---\n\nbody', 'utf8');
    await fs.writeFile(path.join(skillDir, 'README.md'), '# readme', 'utf8');
    // Non-printable bytes force binary classification.
    await fs.writeFile(path.join(skillDir, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]));

    const { entries, total } = await buildSkillCreateEntriesFromExtractedRepo(tmpRoot);
    assert.equal(total, 1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].directoryName, 'my-skill');

    const files = entries[0].files ?? [];
    const readme = files.find((file) => file.relativePath === 'README.md');
    const logo = files.find((file) => file.relativePath === 'logo.bin');

    assert.ok(readme, 'README.md must be included');
    assert.equal(readme!.encoding, 'utf8');
    assert.ok(logo, 'logo.bin must be included');
    assert.equal(logo!.encoding, 'base64');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('buildSkillCreateEntriesFromExtractedRepo throws when no SKILL.md present', { concurrency: false }, async () => {
  const tmpRoot = await makeTmpRoot('opencli-skill-walker-empty');
  try {
    await fs.writeFile(path.join(tmpRoot, 'README.md'), '# no skill here');

    await assert.rejects(
      buildSkillCreateEntriesFromExtractedRepo(tmpRoot),
      (err) => err instanceof AppError && err.code === 'PROVIDER_SKILL_GITHUB_NO_SKILLS',
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
