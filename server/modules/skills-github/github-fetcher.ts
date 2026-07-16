import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { extract as tarExtract } from 'tar-stream';
import type { Entry, Extract, Headers } from 'tar-stream';

import { AppError } from '@/shared/utils.js';

export type GitHubTarballLimits = {
  /** Hard cap on bytes downloaded from the wire (gzip-compressed archive). */
  maxArchiveBytes?: number;
  /** Hard cap on bytes materialized to disk. */
  maxExtractedBytes?: number;
  /** Hard cap on any single tar entry. */
  maxEntryBytes?: number;
  /** Fetch + extract deadline. */
  timeoutMs?: number;
};

export type GitHubTarballTarget = {
  /** Absolute directory the tarball will be extracted into. Created if missing. */
  tmpRoot: string;
} & GitHubTarballLimits;

const DEFAULT_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

const assertInsideRoot = (rootDir: string, candidatePath: string): void => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (
    resolvedCandidate !== resolvedRoot
    && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new AppError(
      'Extracted repository contains an entry outside the temporary directory.',
      {
        code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL',
        statusCode: 400,
      },
    );
  }
};

const sanitizedEntryName = (rawName: string): string => {
  if (!rawName) {
    throw new AppError('Repository archive contains an invalid entry.', {
      code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL',
      statusCode: 400,
    });
  }

  if (path.isAbsolute(rawName) || /^[a-zA-Z]:[\\/]/.test(rawName)) {
    throw new AppError('Repository archive contains an invalid entry path.', {
      code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL',
      statusCode: 400,
    });
  }

  const segments = rawName.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new AppError('Repository archive contains an invalid entry.', {
      code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL',
      statusCode: 400,
    });
  }

  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new AppError('Repository archive contains a path traversal segment.', {
      code: 'PROVIDER_SKILL_GITHUB_PATH_TRAVERSAL',
      statusCode: 400,
    });
  }

  return segments.join('/');
};

/**
 * Downloads a GitHub tarball and extracts it into `target.tmpRoot` while
 * enforcing archive/extracted/entry size caps, rejecting symlinks and
 * hardlinks, and refusing any tar entry whose resolved path would escape
 * the target directory.
 */
export async function fetchAndExtractGitHubTarball(
  tarballUrl: string,
  target: GitHubTarballTarget,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ archiveBytes: number; extractedBytes: number; fileCount: number }> {
  const maxArchiveBytes = target.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const maxExtractedBytes = target.maxExtractedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES;
  const maxEntryBytes = target.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  await mkdir(target.tmpRoot, { recursive: true });

  const fetchImpl = options.fetchImpl ?? fetch;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(tarballUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: abortController.signal,
      headers: {
        'user-agent': 'opencli-skill-installer',
        accept: 'application/vnd.github.v3+json,application/x-gzip,application/octet-stream,*/*',
      },
    });
  } catch (error) {
    clearTimeout(timer);
    throw new AppError('Could not reach GitHub.', {
      code: 'PROVIDER_SKILL_GITHUB_NETWORK',
      statusCode: 502,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  if (response.status === 404) {
    clearTimeout(timer);
    throw new AppError('Repository not found (404).', {
      code: 'PROVIDER_SKILL_GITHUB_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const isRateLimited = remaining === '0';
    clearTimeout(timer);
    throw new AppError(
      isRateLimited
        ? 'GitHub rate limit reached. Try again later.'
        : `GitHub rejected the request (${response.status}).`,
      {
        code: isRateLimited
          ? 'PROVIDER_SKILL_GITHUB_RATE_LIMIT'
          : 'PROVIDER_SKILL_GITHUB_FORBIDDEN',
        statusCode: 502,
      },
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new AppError(`GitHub responded with HTTP ${response.status}.`, {
      code: 'PROVIDER_SKILL_GITHUB_NETWORK',
      statusCode: 502,
    });
  }

  if (!response.body) {
    clearTimeout(timer);
    throw new AppError('GitHub returned an empty response body.', {
      code: 'PROVIDER_SKILL_GITHUB_NETWORK',
      statusCode: 502,
    });
  }

  const webStream = response.body as unknown as ReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream);

  let archiveBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      archiveBytes += chunk.length;
      if (archiveBytes > maxArchiveBytes) {
        callback(new AppError('Repository archive exceeds the size limit.', {
          code: 'PROVIDER_SKILL_GITHUB_ARCHIVE_TOO_LARGE',
          statusCode: 413,
        }));
        return;
      }
      callback(null, chunk);
    },
  });

  const gunzip = createGunzip();
  const extractor: Extract = tarExtract();
  let extractedBytes = 0;
  let fileCount = 0;

  extractor.on('entry', (header: Headers, stream: Entry, next) => {
    if (
      header.type === 'symlink'
      || header.type === 'link'
      || header.type === 'character-device'
      || header.type === 'block-device'
      || header.type === 'fifo'
    ) {
      stream.resume();
      stream.on('end', () => next());
      return;
    }

    let safeName: string;
    try {
      safeName = sanitizedEntryName(header.name);
    } catch (err) {
      stream.resume();
      stream.on('end', () => next(err as Error));
      return;
    }

    const dest = path.join(target.tmpRoot, safeName);

    try {
      assertInsideRoot(target.tmpRoot, dest);
    } catch (err) {
      stream.resume();
      stream.on('end', () => next(err as Error));
      return;
    }

    if (header.type === 'directory') {
      mkdir(dest, { recursive: true })
        .then(() => {
          stream.resume();
          stream.on('end', () => next());
        })
        .catch(next);
      return;
    }

    mkdir(path.dirname(dest), { recursive: true })
      .then(() => {
        const writer = createWriteStream(dest);
        let entryBytes = 0;
        let entryOverflowed = false;

        stream.on('data', (chunk: Buffer) => {
          if (entryOverflowed) {
            return;
          }
          entryBytes += chunk.length;
          if (entryBytes > maxEntryBytes) {
            entryOverflowed = true;
            writer.destroy();
            stream.destroy();
            extractor.destroy(new AppError('Extracted file exceeds the per-entry limit.', {
              code: 'PROVIDER_SKILL_GITHUB_ENTRY_TOO_LARGE',
              statusCode: 413,
            }));
          }
        });

        pipeline(stream, writer)
          .then(() => {
            extractedBytes += entryBytes;
            if (extractedBytes > maxExtractedBytes) {
              extractor.destroy(new AppError('Extracted repository exceeds the size limit.', {
                code: 'PROVIDER_SKILL_GITHUB_EXTRACTED_TOO_LARGE',
                statusCode: 413,
              }));
              return;
            }
            fileCount += 1;
            next();
          })
          .catch(next);
      })
      .catch(next);
  });

  try {
    await pipeline(nodeStream, counter, gunzip, extractor);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Could not extract the repository archive.', {
      code: 'PROVIDER_SKILL_GITHUB_NETWORK',
      statusCode: 502,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  clearTimeout(timer);
  return { archiveBytes, extractedBytes, fileCount };
}
