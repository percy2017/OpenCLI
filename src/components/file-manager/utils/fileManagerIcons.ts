import {
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

const extensionOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

export const getFileIcon = (name: string): LucideIcon => {
  const lowerName = name.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.')) return FileType2;

  const extension = extensionOf(name);
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'php', 'rb'].includes(extension)) {
    return FileCode2;
  }
  if (['json', 'jsonl', 'yaml', 'yml', 'toml', 'xml'].includes(extension)) return FileJson;
  if (['md', 'markdown', 'txt', 'log', 'license', 'csv'].includes(extension)) return FileText;
  if (['css', 'scss', 'less', 'html', 'htm', 'svg'].includes(extension)) return FileType2;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'apng'].includes(extension)) return FileImage;
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'weba'].includes(extension)) return FileAudio;
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension)) return FileVideo;
  if (['db', 'sqlite', 'sqlite3', 's3db', 'sl3'].includes(extension)) return Database;
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz', 'iso'].includes(extension)) return FileArchive;
  if (['xls', 'xlsx', 'ods'].includes(extension)) return FileSpreadsheet;
  return File;
};
