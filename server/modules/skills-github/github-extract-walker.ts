import * as path from 'node:path';
import { readFile } from 'node:fs/promises';

import { AppError, findProviderSkillMarkdownFiles, readProviderSkillMarkdownDefinitionFromContent } from '@/shared/utils.js';
import type { ProviderSkillCreateEntry, ProviderSkillCreateFile } from '@/shared/types.js';

const BINARY_SUFFIX_PATTERN = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|svgz|woff2?|ttf|otf|eot|mp[34]|m4a|aac|ogg|wav|flac|opus|wma|avi|mov|mkv|webm|wmv|flv|zip|tar|tgz|gz|bz2|xz|7z|rar|pdf|psd|ai|eps|sketch|fig|wasm|bin|exe|dll|so|dylib|class|jar|pyc|node|db|sqlite|sqlite3)$/i;

const isLikelyUtf8 = (buffer: Buffer): boolean => {
  // UTF-8 BOM is positive; absence of replacement chars in the first 1KB is
  // a heuristic. For our use, anything that decodes cleanly without replacement
  // and contains at least one printable char is treated as text.
  if (buffer.length === 0) {
    return true;
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  const decoded = sample.toString('utf8');
  if (decoded.includes('�')) {
    return false;
  }
  // No printable ASCII char → assume binary (e.g. pure whitespace header only).
  return /[\x20-\x7e\t\r\n]/.test(decoded);
};

const isBinaryFilename = (relativePath: string): boolean => BINARY_SUFFIX_PATTERN.test(relativePath);

const encodeSupportingFile = async (
  absolutePath: string,
): Promise<ProviderSkillCreateFile> => {
  const buffer = await readFile(absolutePath);
  const relativePath = path.basename(absolutePath);

  const treatAsBinary = isBinaryFilename(relativePath) || !isLikelyUtf8(buffer);

  if (treatAsBinary) {
    return {
      relativePath,
      content: buffer.toString('base64'),
      encoding: 'base64',
    };
  }

  return {
    relativePath,
    content: buffer.toString('utf8'),
    encoding: 'utf8',
  };
};

/**
 * Walks an extracted repository root, finds every SKILL.md, and produces
 * the supporting-file payload that `providerSkillsService.addProviderSkills`
 * expects.
 *
 * GitHub's tarball wraps every entry under `<repo>-<sha>/<...>`; the recursive
 * `findProviderSkillMarkdownFiles` handles that naturally without knowing
 * about the wrapper. Each skill's supporting files are read relative to
 * the SKILL.md's own directory so we never accidentally pick files from a
 * sibling skill.
 */
export async function buildSkillCreateEntriesFromExtractedRepo(
  tmpRoot: string,
): Promise<{ entries: ProviderSkillCreateEntry[]; total: number }> {
  const skillFiles = await findProviderSkillMarkdownFiles(tmpRoot, { recursive: true });

  if (skillFiles.length === 0) {
    throw new AppError('No SKILL.md files were found in this repository.', {
      code: 'PROVIDER_SKILL_GITHUB_NO_SKILLS',
      statusCode: 404,
    });
  }

  const entries: ProviderSkillCreateEntry[] = [];

  for (const skillPath of skillFiles) {
    const skillDir = path.dirname(skillPath);
    const fallbackName = path.basename(skillDir);
    const content = await readFile(skillPath, 'utf8');
    const definition = readProviderSkillMarkdownDefinitionFromContent(content, fallbackName);

    // Walk the skill's own directory, skip the SKILL.md itself and any
    // .git metadata GitHub occasionally includes.
    const { readdir } = await import('node:fs/promises');
    let siblings: string[];
    try {
      const dirents = await readdir(skillDir, { withFileTypes: true });
      siblings = dirents
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase() !== 'skill.md')
        .filter((name) => name !== '.gitkeep' && !name.startsWith('.git'))
        .sort();
    } catch {
      siblings = [];
    }

    const files: ProviderSkillCreateFile[] = [];
    for (const sibling of siblings) {
      const absolute = path.join(skillDir, sibling);
      try {
        const payload = await encodeSupportingFile(absolute);
        files.push(payload);
      } catch {
        // Skip unreadable entries; they're not part of the skill body.
      }
    }

    entries.push({
      content,
      directoryName: fallbackName,
      fileName: `${fallbackName}.md`,
      files: files.length > 0 ? files : undefined,
    });
  }

  return { entries, total: entries.length };
}
