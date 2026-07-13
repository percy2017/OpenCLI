import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { UploadCloud, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_UPLOAD,
} from '../constants';
import type { UploadItem } from '../types';
import UploadQueueItem from './UploadQueueItem';

type UploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (items: UploadItem[]) => void;
};

function makeId(): string {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function UploadModal({ isOpen, onClose, onUpload }: UploadModalProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<UploadItem[]>([]);
  const lastIsOpenRef = useRef(isOpen);

  useEffect(() => {
    if (lastIsOpenRef.current && !isOpen) {
      setItems([]);
    }
    lastIsOpenRef.current = isOpen;
  }, [isOpen]);

  const onDropAccepted = useCallback((accepted: File[]) => {
    const next: UploadItem[] = accepted.map((file) => ({
      id: makeId(),
      file,
      progress: 0,
      status: 'pending',
    }));
    setItems((current) => [...current, ...next].slice(0, MAX_FILES_PER_UPLOAD));
  }, []);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const errorItems: UploadItem[] = rejections.map((rejection) => {
      const code = rejection.errors[0]?.code;
      const message =
        code === 'file-too-large'
          ? t('knowledgeBase.errors.fileTooLarge')
          : code === 'file-invalid-type'
            ? t('knowledgeBase.errors.unsupportedType')
            : t('knowledgeBase.errors.unknown');
      return {
        id: makeId(),
        file: rejection.file,
        progress: 0,
        status: 'error',
        errorMessage: message,
      };
    });
    setItems((current) => [...current, ...errorItems].slice(0, MAX_FILES_PER_UPLOAD));
  }, [t]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDropAccepted,
    onDropRejected,
    accept: undefined,
    multiple: true,
    maxSize: MAX_FILE_SIZE_BYTES,
    maxFiles: MAX_FILES_PER_UPLOAD,
  });

  const handleRemove = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const handleStart = () => {
    const valid = items.filter((item) => item.status === 'pending');
    if (valid.length === 0) return;
    onUpload(valid);
    onClose();
  };

  const pendingCount = items.filter((item) => item.status === 'pending').length;
  const errorCount = items.filter((item) => item.status === 'error').length;
  const dropzoneLabel = isDragReject
    ? t('knowledgeBase.upload.dropzoneReject')
    : isDragActive
      ? t('knowledgeBase.upload.dropzoneActive')
      : t('knowledgeBase.upload.dropzoneIdle');

  return (
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[min(92dvh,40rem)] w-[min(94vw,40rem)] flex-col gap-0 overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <DialogTitle className="text-base font-semibold">{t('knowledgeBase.upload.title')}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-muted-foreground"
            aria-label={t('knowledgeBase.upload.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div
            {...getRootProps({
              className: `flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                isDragReject
                  ? 'border-red-500/50 bg-red-500/5 text-red-600'
                  : isDragActive
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-muted/50'
              }`,
              'aria-label': t('knowledgeBase.upload.dropzoneAria'),
              role: 'button',
              tabIndex: 0,
            })}
          >
            <input
              {...getInputProps({
                accept: ACCEPT_ATTRIBUTE,
              })}
            />
            <UploadCloud className="h-8 w-8" aria-hidden="true" />
            <p className="text-sm font-medium">{dropzoneLabel}</p>
            <p className="text-xs text-muted-foreground">{t('knowledgeBase.upload.limits', { maxFiles: MAX_FILES_PER_UPLOAD })}</p>
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('knowledgeBase.upload.queueCount', { count: items.length })}</span>
                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setItems([])}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t('knowledgeBase.upload.clearAll')}
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.id} className="group relative">
                    <UploadQueueItem item={item} />
                    {item.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                        aria-label={t('knowledgeBase.upload.removeItem')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-5 py-3">
          <div className="text-xs text-muted-foreground">
            {errorCount > 0 && (
              <span className="text-red-600">{t('knowledgeBase.upload.errorsCount', { count: errorCount })}</span>
            )}
            {errorCount === 0 && pendingCount > 0 && (
              <span>{t('knowledgeBase.upload.readyCount', { count: pendingCount })}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t('knowledgeBase.upload.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleStart} disabled={pendingCount === 0}>
              {t('knowledgeBase.upload.submit', { count: pendingCount })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
