/**
 * File → text extraction for the RAG pipeline.
 *
 * Strategy:
 *   - Plain-text formats (.txt, .md, .rst, code) → decode as UTF-8 with BOM strip.
 *   - Office documents (.pdf, .docx, .xlsx, .pptx) → best-effort text recovery by
 *     scanning the bytes for printable UTF-8 sequences. This is intentionally
 *     dependency-free for v1; it produces noisy but usable excerpts that the
 *     chunker+embedder can still search. Heavier parsers (mammoth, pdf-parse)
 *     can replace this module later without touching callers.
 *
 * Returns extracted text plus the detected kind and mime type.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import type { DocumentKind } from './types.js';

export type ParsedDocument = {
  text: string;
  kind: DocumentKind;
  mimeType: string;
};

const EXT_TO_KIND: Record<string, DocumentKind> = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  txt: 'text',
  rtf2: 'text',
  md: 'markdown',
  markdown: 'markdown',
  rst: 'text',
  epub: 'epub',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cc: 'code',
  cs: 'code',
  rb: 'code',
  php: 'code',
  swift: 'code',
  kt: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  html: 'code',
  htm: 'code',
  xml: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  sql: 'code',
  vue: 'code',
  svelte: 'code',
  lua: 'code',
};

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  rst: 'text/plain',
  epub: 'application/epub+zip',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  js: 'text/javascript',
  jsx: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  py: 'text/x-python',
  rs: 'text/x-rust',
  go: 'text/x-go',
  java: 'text/x-java',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  hpp: 'text/x-c++',
  cc: 'text/x-c++',
  cs: 'text/x-csharp',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  css: 'text/css',
  scss: 'text/x-scss',
  sass: 'text/x-sass',
  less: 'text/x-less',
  html: 'text/html',
  htm: 'text/html',
  xml: 'text/xml',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/x-toml',
  sql: 'text/x-sql',
  vue: 'text/x-vue',
  svelte: 'text/x-svelte',
  lua: 'text/x-lua',
};

const TEXT_KINDS = new Set<DocumentKind>([
  'text',
  'markdown',
  'code',
  'csv',
]);

export function getKindForFilename(filename: string): DocumentKind {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? 'other';
}

export function getMimeForFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

/**
 * Extract a printable-text stream from arbitrary bytes. Useful for office
 * document formats (DOCX/XLSX/PPTX are ZIPs of XML; PDFs and older Office
 * formats contain printable text segments).
 *
 * Splits on non-printable boundaries and stitches together runs of ≥4
 * printable characters.
 */
export function extractPrintableText(buffer: Buffer): string {
  // Match runs of printable Unicode characters (letters, digits, common punctuation,
  // whitespace, and extended Latin). Skips control bytes and binary garbage.
  const pattern = /[\x20-\x7E -ɏͰ-ϿЀ-ӿ‐- ←-⇿]+/gu;
  const text = buffer.toString('utf8');
  const runs = text.match(pattern) ?? [];
  return runs
    .filter((run) => run.length >= 4)
    .map((run) => run.trim())
    .filter((run) => run.length > 0)
    .join('\n');
}

/**
 * Pull every `<w:t>` text run out of a WordprocessingML XML document
 * (DOCX body, headers, footers). Joins runs into paragraphs so chunk
 * boundaries roughly match paragraph breaks.
 */
function extractDocxText(xml: string): string {
  // Mark paragraph boundaries with a sentinel newline so we can split on
  // them after extracting runs.
  const marked = xml.replace(/<w:p\b[^>]*>/g, '\n<w:p>');
  const paragraphs = marked.split('');
  const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const runs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(paragraph)) !== null) {
      runs.push(decodeXmlEntities(m[1]));
    }
    const joined = runs.join('').trim();
    if (joined) out.push(joined);
  }
  return out.join('\n\n');
}

/**
 * Pull inline-strings from SpreadsheetML (XLSX sharedStrings).
 */
function extractXlsxText(xml: string): string {
  const lines: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const block = m[1];
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    const parts: string[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(block)) !== null) {
      parts.push(decodeXmlEntities(tm[1]));
    }
    const text = parts.join('').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

/**
 * Pull text from PresentationML slide XMLs (PPTX).
 */
function extractPptxText(xml: string): string {
  const out: string[] = [];
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeXmlEntities(m[1]).trim();
    if (text) out.push(text);
  }
  return out.join('\n');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/**
 * DOCX/XLSX/PPTX files are ZIP packages of XML parts. Pull the parts that
 * carry the actual content, run them through the matching XML extractor,
 * and concatenate. Modern Office formats — fallback printable-text scan
 * returns garbage for these (XML tags, base64 blobs, attribute noise).
 */
async function extractOfficeArchive(
  buffer: Buffer,
  kind: 'word' | 'spreadsheet' | 'presentation',
): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return '';
  }

  const targets: Record<'word' | 'spreadsheet' | 'presentation', RegExp[]> = {
    word: [/^word\/document\d*\.xml$/, /^word\/header\d*\.xml$/, /^word\/footer\d*\.xml$/, /^word\/footnotes?\.xml$/, /^word\/endnotes?\.xml$/],
    spreadsheet: [/^xl\/sharedStrings\.xml$/, /^xl\/worksheets\/sheet\d+\.xml$/],
    presentation: [/^ppt\/slides\/slide\d+\.xml$/, /^ppt\/notesSlides\/notesSlide\d+\.xml$/],
  };

  const matching = Object.keys(zip.files)
    .filter((name) => targets[kind].some((re) => re.test(name)))
    .sort();

  const extractors = {
    word: extractDocxText,
    spreadsheet: extractXlsxText,
    presentation: extractPptxText,
  } as const;
  const extractor = extractors[kind];

  const pieces: string[] = [];
  for (const name of matching) {
    const file = zip.files[name];
    if (file.dir) continue;
    const content = await file.async('string');
    const text = extractor(content).trim();
    if (text) pieces.push(text);
  }
  return pieces.join('\n\n');
}

export async function parseFile(filePath: string, filename: string): Promise<ParsedDocument> {
  const kind = getKindForFilename(filename);
  const mimeType = getMimeForFilename(filename);
  const buffer = await readFile(filePath);

  if (TEXT_KINDS.has(kind)) {
    // Strip UTF-8 BOM if present, then decode.
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    return { text, kind, mimeType };
  }

  // Modern Office formats are ZIPs of XML. Parse the structured content
  // instead of scanning raw bytes.
  if (kind === 'word') {
    const text = await extractOfficeArchive(buffer, 'word');
    if (text) return { text, kind, mimeType };
  }
  if (kind === 'spreadsheet') {
    const text = await extractOfficeArchive(buffer, 'spreadsheet');
    if (text) return { text, kind, mimeType };
  }
  if (kind === 'presentation') {
    const text = await extractOfficeArchive(buffer, 'presentation');
    if (text) return { text, kind, mimeType };
  }

  // Legacy binary formats (DOC, XLS, PPT) and PDF: best-effort fallback.
  const text = extractPrintableText(buffer);
  return { text, kind, mimeType };
}

export function basename(filename: string): string {
  return path.basename(filename);
}
