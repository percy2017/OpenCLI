import type { DocumentKind } from './types';

const EXTENSION_TO_KIND: Record<string, DocumentKind> = {
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

export const ACCEPT_ATTRIBUTE = [
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.xls',
  '.xlsx',
  '.ods',
  '.csv',
  '.ppt',
  '.pptx',
  '.odp',
  '.txt',
  '.md',
  '.markdown',
  '.rst',
  '.epub',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.sh',
  '.bash',
  '.zsh',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.xml',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.sql',
  '.vue',
  '.svelte',
  '.lua',
].join(',');

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 50;

export function getKindForFilename(filename: string): DocumentKind {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_TO_KIND[ext] ?? 'other';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
