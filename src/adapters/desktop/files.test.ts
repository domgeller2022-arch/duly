/**
 * Re-filing must write back to the path the PDF was stored at.
 *
 * A stored `lastPdfPath` is absolute on desktop, and bulk re-file joined it
 * onto the output folder again — writing to a nonsense path like
 * `~/Invoices/Users/me/Invoices/2026/INV.pdf`. `rewriteStoredFile` writes to
 * the stored path; this drives the desktop adapter with a mocked fs plugin.
 */

import { describe, expect, it, vi } from 'vitest';

const { written } = vi.hoisted(() => ({ written: [] as { path: string }[] }));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => true,
  mkdir: async () => {},
  readTextFile: async () => '',
  readDir: async () => [],
  remove: async () => {},
  writeFile: async (path: string) => {
    written.push({ path });
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: async () => null,
  save: async () => null,
}));

import { DesktopFileAdapter } from './files';

describe('DesktopFileAdapter.rewriteStoredFile', () => {
  it('writes to the stored absolute path, not joined onto the output folder', async () => {
    written.length = 0;
    const adapter = new DesktopFileAdapter();
    await adapter.restoreFolder({ token: '/Users/me/Invoices', name: 'Invoices' });

    await adapter.rewriteStoredFile('/Users/me/Invoices/2026/INV-1.pdf', 'pdf');

    expect(written[0].path).toBe('/Users/me/Invoices/2026/INV-1.pdf');
  });
});
