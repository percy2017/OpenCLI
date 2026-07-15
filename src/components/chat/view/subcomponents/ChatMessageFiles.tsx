import { FileSpreadsheet, FileText, FileType, Presentation } from 'lucide-react';

interface ChatMessageFile {
  path: string;
  name?: string;
  mimeType?: string;
}

interface ChatMessageFilesProps {
  files: ChatMessageFile[];
}

function mimeIcon(mime?: string, name?: string) {
  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf')
    return { Icon: FileText, color: 'text-red-500' };
  if (mime?.includes('spreadsheet') || ext === 'xlsx' || ext === 'csv')
    return { Icon: FileSpreadsheet, color: 'text-green-600' };
  if (mime?.includes('presentation') || ext === 'pptx')
    return { Icon: Presentation, color: 'text-orange-500' };
  if (mime?.includes('wordprocessing') || ext === 'docx')
    return { Icon: FileText, color: 'text-blue-500' };
  return { Icon: FileType, color: 'text-muted-foreground' };
}

function ChatMessageFiles({ files }: ChatMessageFilesProps) {
  if (!files || files.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end justify-end gap-2">
      {files.map((file, index) => {
        const filename = file.name || file.path.split(/[\\/]/).pop() || 'Archivo adjunto';
        const { Icon, color } = mimeIcon(file.mimeType, file.name);
        return (
          <a
            key={`${file.path}-${index}`}
            href={file.path}
            target="_blank"
            rel="noopener noreferrer"
            className="flex max-w-[16rem] items-center gap-2 rounded-xl border border-border/50 bg-card px-3 py-2 shadow-sm transition-colors hover:bg-muted"
            title={file.path}
          >
            <Icon className={`h-5 w-5 shrink-0 ${color}`} />
            <span className="truncate text-xs font-medium text-foreground">{filename}</span>
          </a>
        );
      })}
    </div>
  );
}

export default ChatMessageFiles;