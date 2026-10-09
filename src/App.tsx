/**
 * Application root.
 *
 * Boots the platform adapters, starts the scheduler, applies the theme and
 * density, then renders the router. The splash screen is shown until the database
 * is open, because a half-loaded shell that then fills in is more confusing than
 * a brief pause.
 */

import { useEffect } from 'react';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { installPlatform, useAppStore } from '@/state/app';
import { startScheduler, stopScheduler } from '@/lib/automation/scheduler';
import { ToastProvider, Button, Card } from '@/ui/components/base';
import { AppShell } from '@/ui/shell/AppShell';
import { applyPreferences, watchSystemTheme } from '@/ui/hooks/usePreferences';
import { routes } from './routes';

const router = createBrowserRouter(
  routes.map((route) => ({ ...route, element: <AppShell>{route.element}</AppShell> })),
);

export function App() {
  const ready = useAppStore((s) => s.ready);
  const bootError = useAppStore((s) => s.bootError);
  const boot = useAppStore((s) => s.boot);
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    installPlatform();
    void boot();
  }, [boot]);

  // Theme, density and accent are applied to the document element so the CSS
  // custom properties resolve before anything paints.
  useEffect(() => {
    applyPreferences(settings);
  }, [settings]);

  // With the theme set to "system", switching the operating system's appearance
  // has to update the app straight away — not on the next reload.
  useEffect(() => watchSystemTheme(settings?.theme), [settings?.theme]);

  // Jobs run on start and every 15 minutes while the app is open.
  useEffect(() => {
    if (!ready) return;
    void startScheduler();
    return () => stopScheduler();
  }, [ready]);

  if (!ready) return <Splash />;
  if (bootError) return <BootError message={bootError} onRetry={() => void boot()} />;

  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
}

/**
 * The splash.
 *
 * Deliberately plain: the wordmark, a rule, and a hairline progress bar. No
 * spinner in the middle of an empty page.
 */
function Splash() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-paper px-6">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-[9px] bg-accent font-display text-lg font-semibold text-on-accent"
          aria-hidden
        >
          D
        </span>
        <span className="font-display text-xl font-semibold tracking-tight text-ink">Duly</span>
      </div>
      <p className="text-[13px] text-ink-muted">Invoices, duly done.</p>
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-rule">
        <div className="h-full w-1/2 rounded-full bg-accent motion-safe:animate-pulse" />
      </div>
      <p className="sr-only" role="status">
        <Loader2 aria-hidden className="size-3" /> Opening your local database
      </p>
    </div>
  );
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-paper px-6">
      <Card className="max-w-md">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-overdue" aria-hidden />
          <div>
            <h1 className="font-display text-base font-semibold text-ink">
              Duly could not open your database
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{message}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              If this is a private-browsing window, IndexedDB is unavailable — open Duly in a normal window.
              Otherwise a backup from Settings → Backups may still restore your data.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export { Navigate };
