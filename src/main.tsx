/**
 * Entry point.
 *
 * Order matters here: the CSS is imported first so the design tokens are
 * resolved before the first paint, and the platform adapters are installed
 * before React mounts, so the first render already has a database to talk to.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ui/styles/index.css';
import { App } from './App';
import { installPlatform } from './state/app';

// The adapters have to exist before anything calls `storage()`. Installing them
// here rather than inside a component means a failed boot shows the error screen
// rather than a blank page.
installPlatform();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Duly could not find its mount point');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the service worker that makes the app work with the network off.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is a bonus, not a requirement: the app still runs, it
      // just needs to be served again on the next visit.
    });
  });
}
