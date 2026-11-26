import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalInstalled = false;
const listeners = new Set<() => void>();

const notifyInstallSubscribers = () => {
  listeners.forEach((cb) => cb());
};

if (typeof window !== 'undefined') {
  globalInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyInstallSubscribers();
  });

  window.addEventListener('appinstalled', () => {
    globalInstalled = true;
    globalDeferredPrompt = null;
    notifyInstallSubscribers();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    globalDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState(globalInstalled);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const syncState = () => {
      const standaloneNow =
        globalInstalled ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneNow);
      setDeferredPrompt(globalDeferredPrompt);
    };

    syncState();
    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    listeners.add(syncState);
    return () => {
      listeners.delete(syncState);
    };
  }, []);

  const install = async () => {
    const promptEvent = deferredPrompt || globalDeferredPrompt;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      globalInstalled = true;
      globalDeferredPrompt = null;
      notifyInstallSubscribers();
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}
