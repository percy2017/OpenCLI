import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const STORAGE_KEY = 'pwa-install-dismissed';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    Boolean(nav.standalone) ||
    document.referrer.includes('android-app://')
  );
}

function detectIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) ||
    // iPad on iPadOS 13+ reports as Mac with touch
    (/Mac/.test(ua) && 'ontouchend' in document);
}

export type PwaInstallState = {
  /** True when the app is already running in standalone/installed mode. */
  isInstalled: boolean;
  /** True when the browser has offered the install prompt and it has not been used. */
  canInstall: boolean;
  /** True on iOS Safari, where the API is not supported but the user can still install via Share → Add to Home Screen. */
  isIosDevice: boolean;
  /** True when the user has previously dismissed the install prompt and we should not nag them. */
  wasDismissed: boolean;
  /** Trigger the native install prompt (Chrome/Edge/Android). Returns true if accepted. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Clear the "dismissed" flag so the button reappears. */
  resetDismissed: () => void;
};

/**
 * Detects whether the app can be installed as a PWA and exposes a hook to
 * trigger the native install prompt. Works on:
 *  - Chrome/Edge desktop and Android (uses `beforeinstallprompt`)
 *  - iOS Safari (no API — surfaces a manual install hint via `isIosDevice`)
 *
 * Silently returns `canInstall: false` on browsers that don't support PWA
 * install (Firefox desktop, etc.).
 */
export function usePwaInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectStandalone());
  const [canInstall, setCanInstall] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [wasDismissed, setWasDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Watch for changes to display-mode (e.g. user installs then comes back).
    const mql = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setIsInstalled(detectStandalone());
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      // Prevent the browser's default mini-infobar so we can show our own button.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      // Either way, the prompt is single-use.
      setDeferredPrompt(null);
      setCanInstall(false);
      if (choice.outcome === 'dismissed') {
        try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
        setWasDismissed(true);
      }
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const resetDismissed = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setWasDismissed(false);
  }, []);

  return {
    isInstalled,
    canInstall: canInstall && !isInstalled,
    isIosDevice: detectIos(),
    wasDismissed,
    promptInstall,
    resetDismissed,
  };
}