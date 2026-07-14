import { AppError } from '@/shared/utils.js';

export type ParsedGitHubRepoUrl = {
  owner: string;
  repo: string;
  ref: string;
  tarballUrl: string;
};

const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

const GITHUB_HOSTS = new Set(['github.com']);

/**
 * Parses and validates a GitHub repo URL submitted by the user.
 *
 * Accepts:
 *   - `https://github.com/<owner>/<repo>` (default branch inferred)
 *   - `https://github.com/<owner>/<repo>.git`
 *   - `https://github.com/<owner>/<repo>/tree/<ref>`
 *
 * Rejects:
 *   - Non-https URLs (`http://`, protocol-relative `//github.com/...`)
 *   - Hosts other than `github.com` (case-insensitive)
 *   - Owner/repo names containing characters outside `[A-Za-z0-9._-]`
 *   - Refs containing `..`, leading `/`, or absolute paths
 *   - Anything with more than one path segment beyond `/tree/<ref>`
 */
export function parseAndValidateGithubUrl(
  rawUrl: unknown,
  options: { defaultRef?: string; refOverride?: string } = {},
): ParsedGitHubRepoUrl {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  const rawInput = rawUrl.trim();

  // Guard against inputs whose `URL` constructor normalizes away
  // path-traversal segments (e.g. `..`). Any segment of the raw path that is
  // `.` or `..` would be silently dropped, so we reject it explicitly.
  const rawPathSegments = rawInput.split(/[?#]/)[0]
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rawPathSegments.some((segment) => segment === '.' || segment === '..')) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawInput);
  } catch {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError('Only github.com repositories are supported.', {
      code: 'PROVIDER_SKILL_GITHUB_NON_GITHUB_HOST',
      statusCode: 400,
    });
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(normalizedHost)) {
    throw new AppError('Only github.com repositories are supported.', {
      code: 'PROVIDER_SKILL_GITHUB_NON_GITHUB_HOST',
      statusCode: 400,
    });
  }

  // Strip a trailing `.git` and a possible `/tree/<ref>` tail, then split.
  // We never read `parsed.pathname` beyond the first three segments.
  const cleanedPath = parsed.pathname.replace(/\.git$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = cleanedPath.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  const owner = segments[0];
  const repo = segments[1];
  let refFromUrl: string | undefined;

  if (segments.length >= 4 && segments[2] === 'tree') {
    refFromUrl = segments.slice(3).join('/');
  } else if (segments.length > 2) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  if (!OWNER_REPO_PATTERN.test(owner)) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  if (!OWNER_REPO_PATTERN.test(repo)) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  const refOverride = options.refOverride?.trim();
  let ref = refOverride || refFromUrl || options.defaultRef || 'HEAD';

  if (!REF_PATTERN.test(ref)) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  if (ref.includes('..') || ref.startsWith('/')) {
    throw new AppError('Enter a valid GitHub repository URL.', {
      code: 'PROVIDER_SKILL_GITHUB_INVALID_URL',
      statusCode: 400,
    });
  }

  // We deliberately route through codeload (GitHub's CDN) rather than the
  // REST API — codeload carries no auth requirement and serves the
  // resolved-content tarball for `<owner>/<repo>/tar.gz/<ref>`.
  const tarballUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`;

  return {
    owner,
    repo,
    ref,
    tarballUrl,
  };
}
