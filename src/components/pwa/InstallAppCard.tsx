import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Smartphone, X } from 'lucide-react';

import { Button } from '../../shared/view/ui';
import { usePwaInstall } from '../../hooks/usePwaInstall';

/**
 * Settings card surfaced in the Notifications tab — gives the user a stable,
 * always-visible place to install the PWA. Mirrors the floating button in the
 * sidebar but lives inside Ajustes so it's discoverable from the system
 * settings page even if the user closes the sidebar.
 *
 * Three states:
 *  - already installed → green check, no actions
 *  - can install       → button (native install prompt + iOS modal)
 *  - unsupported       → explanation that this browser/OS doesn't expose a
 *                        native install prompt (e.g. Firefox desktop)
 *
 * The hook `usePwaInstall` does the heavy lifting; this component just renders
 * the appropriate UI and wires the actions.
 */
export default function InstallAppCard() {
  const { t } = useTranslation('common');
  const {
    isInstalled,
    canInstall,
    isIosDevice,
    wasDismissed,
    promptInstall,
    resetDismissed,
  } = usePwaInstall();
  const [iosModalOpen, setIosModalOpen] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<'accepted' | 'dismissed' | 'unavailable' | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);

  const showInstallAction = !isInstalled && (canInstall || isIosDevice);
  const showUnsupportedHint = !isInstalled && !canInstall && !isIosDevice;

  const handleInstallClick = useCallback(async () => {
    if (isIosDevice) {
      setIosModalOpen(true);
      return;
    }
    setIsPrompting(true);
    try {
      const outcome = await promptInstall();
      setInstallOutcome(outcome);
    } finally {
      setIsPrompting(false);
    }
  }, [isIosDevice, promptInstall]);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-blue-600" />
            <h4 className="font-medium text-foreground">
              {t('pwa.install.cardTitle', { defaultValue: 'Install the app' })}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground">
            {isInstalled
              ? t('pwa.install.cardInstalledDescription', {
                  defaultValue: 'OpenCLI is installed on this device. Push notifications and sound still work in your browser too.',
                })
              : t('pwa.install.cardDescription', {
                  defaultValue: 'Add OpenCLI to your home screen or install it as a desktop app for quick access and offline support.',
                })}
          </p>
        </div>

        {isInstalled ? (
          <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            {t('pwa.install.installed', { defaultValue: 'Installed' })}
          </div>
        ) : showInstallAction ? (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleInstallClick()}
              disabled={isPrompting}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {isIosDevice
                ? t('pwa.install.iosAction', { defaultValue: 'Show iOS steps' })
                : t('pwa.install.button', { defaultValue: 'Install app' })}
            </Button>
            {wasDismissed && (
              <button
                type="button"
                onClick={resetDismissed}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t('pwa.install.resetDismissed', { defaultValue: 'Ask me again' })}
              </button>
            )}
            {installOutcome === 'dismissed' && !wasDismissed && (
              <p className="text-xs text-muted-foreground">
                {t('pwa.install.dismissed', { defaultValue: 'Install dismissed. You can try again any time.' })}
              </p>
            )}
          </div>
        ) : showUnsupportedHint ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('pwa.install.unsupported', {
              defaultValue: 'This browser does not expose an install prompt.',
            })}
          </span>
        ) : null}
      </div>

      {iosModalOpen && createPortal(<IosInstallModal onClose={() => setIosModalOpen(false)} />, document.body)}
    </div>
  );
}

function IosInstallModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
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
            {t('pwa.install.iosTitle', { defaultValue: 'Install OpenCLI on your iPhone' })}
          </h3>

          <ol className="w-full space-y-3 text-left text-sm text-foreground">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
              <span>{t('pwa.install.iosStep1', { defaultValue: 'Tap the Share button in Safari’s toolbar.' })}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
              <span>{t('pwa.install.iosStep2', { defaultValue: 'Scroll down and choose "Add to Home Screen".' })}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
              <span>{t('pwa.install.iosStep3', { defaultValue: 'Tap "Add" to install. OpenCLI will appear on your home screen.' })}</span>
            </li>
          </ol>

          <Button onClick={onClose} className="mt-2 w-full">
            {t('gotIt', { defaultValue: 'Got it' })}
          </Button>
        </div>
      </div>
    </div>
  );
}