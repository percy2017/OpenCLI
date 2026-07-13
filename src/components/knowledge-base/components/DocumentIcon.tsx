import {
  FileText,
  FileCode,
  FileSpreadsheet,
  FileType,
  Presentation,
  BookOpen,
  FileQuestion,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { DocumentKind } from '../types';

const ICON_MAP: Record<DocumentKind, { icon: LucideIcon; color: string }> = {
  pdf: { icon: FileText, color: 'text-red-500' },
  word: { icon: FileType, color: 'text-blue-500' },
  spreadsheet: { icon: FileSpreadsheet, color: 'text-emerald-500' },
  presentation: { icon: Presentation, color: 'text-orange-500' },
  text: { icon: FileText, color: 'text-muted-foreground' },
  markdown: { icon: FileText, color: 'text-slate-400' },
  code: { icon: FileCode, color: 'text-violet-500' },
  epub: { icon: BookOpen, color: 'text-amber-500' },
  other: { icon: FileQuestion, color: 'text-muted-foreground' },
};

type DocumentIconProps = {
  kind: DocumentKind;
  className?: string;
};

export default function DocumentIcon({ kind, className }: DocumentIconProps) {
  const entry = ICON_MAP[kind] ?? ICON_MAP.other;
  const Icon = entry.icon;
  return <Icon className={cn(entry.color, className)} aria-hidden="true" />;
}
