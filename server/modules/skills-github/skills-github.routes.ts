import express, { type Request, type Response } from 'express';

import type { LLMProvider } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse, readOptionalString } from '@/shared/utils.js';

import { githubSkillsService } from './skills-github.service.js';

const router = express.Router();

const PROVIDERS: LLMProvider[] = ['claude'];

const parseProvider = (value: unknown): LLMProvider => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (PROVIDERS.includes(normalized as LLMProvider)) {
    return normalized as LLMProvider;
  }

  throw new AppError(`Unsupported provider "${normalized}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

const parseGithubInstallPayload = (body: unknown): { url: string; ref?: string } => {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const record = body as Record<string, unknown>;
  const url = readOptionalString(record.url);
  if (!url) {
    throw new AppError('url is required.', {
      code: 'PROVIDER_SKILL_GITHUB_URL_REQUIRED',
      statusCode: 400,
    });
  }

  const ref = readOptionalString(record.ref);
  return { url, ref };
};

router.post(
  '/:provider/skills/github-install',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseGithubInstallPayload(req.body);
    const result = await githubSkillsService.installFromGithub(provider, payload);
    res.json(createApiSuccessResponse(result));
  }),
);

export default router;
