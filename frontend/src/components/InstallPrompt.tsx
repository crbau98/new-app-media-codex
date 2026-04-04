import { useState, useEffect, useRef } from 'react';

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef<any>(null);

  useEffect(() => {
    if (localStorage.getItem('pwa-install-dismissed')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!show) return null;

  const handleInstall = async () => {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const result = await deferredPrompt.current.userChoice;
    if (result.outcome === 'accepted') {
      setShow(false);
    }
    deferredPrompt.current = null;
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem('pwa-install-dismissed', '1');
  };

  return (
    <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-4 py-2.5 glass border border-white/10 shadow-lg slide-up">
      <span className="text-sm text-[var(--color-text-primary)]">Install Codex for quick access</span>
      <button
        onClick={handleInstall}
        className="rounded-lg px-3 py-1 text-xs font-semibold text-white gradient-accent"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
      >
        Dismiss
      </button>
    </div>
  );
}
