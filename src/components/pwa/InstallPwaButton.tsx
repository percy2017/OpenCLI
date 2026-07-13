import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../shared/view/ui';
import { usePwaInstall } from '../../hooks/usePwaInstall';

/**
 * Floating "Install app" button + iOS install modal.
 *
 * Shows when the user is NOT already running as a PWA. On Chromium-based
 * browsers (desktop + Android) clicking the button triggers the native install
 * prompt. On iOS Safari it opens a modal with manual instructions because
 * `beforeinstallprompt` is not supported there.
 *
 * Mount once near the app root (e.g. sidebar header). Returns null when the
 * app is already installed and there is nothing to show.
 */
export default function InstallPwaButton() {
  const { t } = useTranslation();
  const { isInstalled, canInstall, isIosDevice, wasDismissed, promptInstall } = usePwaInstall();
  const [iosModalOpen, setIosModalOpen] = useState(false);

  if (isInstalled) return null;
  if (!canInstall && !isIosDevice) return null;
  if (wasDismissed) return null;

  const handleClick = async () => {
    if (isIosDevice) {
      setIosModalOpen(true);
      return;
    }
    const outcome = await promptInstall();
    // `accepted` → appinstalled fires and isInstalled flips. `dismissed` →
    // wasDismissed flag set inside the hook so we don't re-show.
    void outcome;
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="gap-1.5"
        title={t('pwa.install.title', 'Install OpenCLI')}
      >
        <Download className="h-3.5 w-3.5" />
        <span>{t('pwa.install.button', 'Install app')}</span>
      </Button>

      {iosModalOpen && createPortal(<IosInstallModal onClose={() => setIosModalOpen(false)} />, document.body)}
    </>
  );
}

function IosInstallModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="relative w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Download className="h-7 w-7" />
          </div>

          <h3 className="text-lg font-semibold text-foreground">
            {t('pwa.install.iosTitle', 'Install OpenCLI on your iPhone')}
          </h3>

          <ol className="w-full space-y-3 text-left text-sm text-foreground">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
              <span>
                {t(
                  'pwa.install.iosStep1',
                  'Tap the Share button in Safari’s toolbar.',
                )}{' '}
                <Share className="inline h-4 w-4 align-text-bottom text-primary" />
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
              <span>
                {t(
                  'pwa.install.iosStep2',
                  'Scroll down and choose “Add to Home Screen”.',
                )}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
              <span>
                {t(
                  'pwa.install.iosStep3',
                  'Tap “Add” to install. OpenCLI will appear on your home screen.',
                )}
              </span>
            </li>
          </ol>

          <Button onClick={onClose} className="mt-2 w-full">
            {t('common.gotIt', 'Got it')}
          </Button>
        </div>
      </div>
    </div>
  );
}