import { FileText, FileSpreadsheet, FileType, Presentation, X } from 'lucide-react';

interface FileAttachmentChipProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForMime(mime: string, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return { Icon: FileText, color: 'text-red-500' };
  if (mime.includes('spreadsheet') || ext === 'xlsx' || ext === 'csv') return { Icon: FileSpreadsheet, color: 'text-green-600' };
  if (mime.includes('presentation') || ext === 'pptx') return { Icon: Presentation, color: 'text-orange-500' };
  if (mime.includes('wordprocessing') || ext === 'docx') return { Icon: FileText, color: 'text-blue-500' };
  if (mime.startsWith('text/') || ext === 'txt' || ext === 'md') return { Icon: FileType, color: 'text-muted-foreground' };
  return { Icon: FileText, color: 'text-muted-foreground' };
}

const FileAttachmentChip = ({ file, onRemove, uploadProgress, error }: FileAttachmentChipProps) => {
  const { Icon, color } = iconForMime(file.type, file.name);

  return (
    <div className="group relative flex items-center gap-2 rounded-xl border border-border/50 bg-card px-3 py-2 shadow-sm">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{formatSize(file.size)}</p>
      </div>
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <span className="text-[10px] font-medium text-muted-foreground">{uploadProgress}%</span>
      )}
      {error && (
        <span className="text-[10px] font-medium text-red-500" title={error}>!</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded-full p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

export default FileAttachmentChip;