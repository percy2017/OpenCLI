import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, Loader2, X } from 'lucide-react';

import { Button, Input, Dialog, DialogContent, DialogTitle  } from '../../../shared/view/ui';

type GithubInstallDialogProps = {
  open: boolean;
  providerName: string;
  isSubmitting: boolean;
  submitError: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { url: string; ref?: string }) => Promise<void>;
};

const sanitizeRef = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};

const sanitizeUrl = (raw: string): string => raw.trim();

export default function GithubInstallDialog({
  open,
  providerName,
  isSubmitting,
  submitError,
  onOpenChange,
  onSubmit,
}: GithubInstallDialogProps) {
  const { t } = useTranslation('settings');
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLocalError(null);
    }
  }, [open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedUrl = sanitizeUrl(url);
    if (!cleanedUrl) {
      setLocalError(t('skillsManagement.githubError.invalidUrl'));
      return;
    }

    void (async () => {
      try {
        await onSubmit({ url: cleanedUrl, ref: sanitizeRef(ref) });
        setUrl('');
        setRef('');
      } catch {
        // Submission errors flow through `submitError`; dialog stays open
        // so the user can correct the URL or retry.
      }
    })();
  };

  const errorMessage = localError ?? submitError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wrapperClassName="z-[10000]"
        className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden p-0 sm:w-[480px]"
      >
        <DialogTitle className="sr-only">{t('skillsManagement.githubDialog.title')}</DialogTitle>
        <div className="flex-shrink-0 border-b border-border/60 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/20 text-muted-foreground">
              <Github className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-foreground">
                {t('skillsManagement.githubDialog.title')}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t('skillsManagement.githubDialog.help', { provider: providerName })}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label={t('skillsManagement.cancel', { defaultValue: 'Cancel' })}
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <div className="space-y-4 overflow-y-auto p-4">
            <div className="space-y-1.5">
              <label htmlFor="github-install-url" className="block text-sm font-medium text-foreground">
                {t('skillsManagement.githubDialog.urlLabel')}
              </label>
              <Input
                id="github-install-url"
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (localError) {
                    setLocalError(null);
                  }
                }}
                placeholder={t('skillsManagement.githubDialog.urlPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="github-install-ref" className="block text-sm font-medium text-foreground">
                {t('skillsManagement.githubDialog.refLabel')}
              </label>
              <Input
                id="github-install-ref"
                type="text"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                placeholder={t('skillsManagement.githubDialog.refPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {errorMessage ? (
                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
                  {errorMessage}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('skillsManagement.githubDialog.help', { provider: providerName })}
                </span>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                {t('skillsManagement.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="w-full sm:w-auto"
                disabled={isSubmitting || url.trim().length === 0}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                {isSubmitting
                  ? t('skillsManagement.githubDialog.installing')
                  : t('skillsManagement.githubDialog.install')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
