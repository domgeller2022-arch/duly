/**
 * The daily backup must go to the backup folder, never the output folder.
 *
 * The re-audit found the scheduler wrote its snapshot through `writeFile`,
 * which targets the output folder — so a full copy of the database (clients,
 * bank details) landed among the invoices the user shares. `writeBackupFile`
 * targets the backup folder and refuses when there is none, rather than
 * quietly falling back to the output folder.
 */

import { describe, expect, it } from 'vitest';
import { WebFileAdapter } from './files';

type DirHandle = Parameters<WebFileAdapter['setOutputFolder']>[0];

function fakeDir(name: string) {
  const files = new Map<string, string>();
  const dir = {
    kind: 'directory' as const,
    name,
    files,
    async getDirectoryHandle(child: string) {
      return fakeDir(child) as unknown as DirHandle;
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName) && !options?.create) throw new Error('not found');
      return {
        kind: 'file' as const,
        name: fileName,
        async createWritable() {
          return {
            async write(data: Blob | string) {
              // The adapter always wraps text in a Blob here, and jsdom's Blob
              // has no `.text()`, so record presence rather than content.
              files.set(fileName, typeof data === 'string' ? data : 'blob');
            },
            async close() {},
          };
        },
      };
    },
    async removeEntry() {},
  };
  return dir;
}

describe('WebFileAdapter.writeBackupFile', () => {
  it('writes into the backup folder, never the output folder', async () => {
    const adapter = new WebFileAdapter();
    const output = fakeDir('invoices');
    const backup = fakeDir('backups');
    adapter.setOutputFolder(output as unknown as DirHandle);
    adapter.setBackupFolder(backup as unknown as DirHandle);

    await adapter.writeBackupFile('duly-backup.json', '{"a":1}');

    expect(backup.files.has('duly-backup.json')).toBe(true);
    expect(output.files.size).toBe(0);
  });

  it('refuses when no backup folder is chosen, rather than using the output folder', async () => {
    const adapter = new WebFileAdapter();
    adapter.setOutputFolder(fakeDir('invoices') as unknown as DirHandle);

    await expect(adapter.writeBackupFile('duly-backup.json', '{}')).rejects.toThrow(/backup folder/i);
  });
});
