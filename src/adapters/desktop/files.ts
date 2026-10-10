/**
 * Desktop `FileAdapter` — the native file system.
 *
 * The web build uses the File System Access API and re-asks permission when a
 * session's grant lapses. The desktop build has none of that friction: a
 * folder is chosen once through the dialog plugin, and every write after that
 * is silent.
 *
 * Every fs call goes through the plugin's own JavaScript wrapper
 * (`@tauri-apps/plugin-fs`), not hand-rolled invokes: the plugin's wire
 * format (raw bytes in the body, the path in a header, `recursive` inside
 * `options`) is the wrapper's job to get right, and the hand-rolled version
 * got it wrong — every desktop write failed with "unexpected invoke body".
 *
 * A `FileHandleRef.token` is the absolute path. Each path segment is
 * sanitised before it is ever joined, so a client named "../../x" cannot
 * write outside the chosen folder — the same rule the web adapter applies.
 */

import { exists, mkdir, readDir, readTextFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { FileAdapter, FileHandleRef } from '../types';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** One safe path segment: no separators, no traversal, no control bytes. */
function safeSegment(segment: string): string {
  const cleaned = segment
    .replace(/[\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180);
  return cleaned || 'untitled';
}

/** Join the chosen folder with a sanitised relative path. */
function resolvePath(folder: string, relativePath: string): string {
  const segments = relativePath
    .split(/[\\/]/)
    .filter((part) => part && part !== '.' && part !== '..')
    .map(safeSegment);
  return [folder, ...segments].join('/');
}

/** Write bytes or text to an absolute path, creating parents. */
async function writeAbs(path: string, data: Blob | string): Promise<void> {
  const dir = path.split(/[\\/]/).slice(0, -1).join('/');
  if (dir && !(await exists(dir))) await mkdir(dir, { recursive: true });
  if (typeof data === 'string') {
    await writeFile(path, new TextEncoder().encode(data));
    return;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  await writeFile(path, bytes);
}

export class DesktopFileAdapter implements FileAdapter {
  readonly name = 'desktop-native-fs';

  private outputFolder: string | null = null;
  private backupFolder: string | null = null;

  get supportsFolderAccess(): boolean {
    return true;
  }

  async chooseOutputFolder(): Promise<FileHandleRef | null> {
    const path = await openDialog({ directory: true, title: 'Choose the output folder' });
    if (!path || Array.isArray(path)) return null;
    this.outputFolder = path;
    return { token: path, name: baseName(path) };
  }

  async restoreFolder(ref: FileHandleRef): Promise<FileHandleRef | null> {
    // Permissions are implicit on desktop: restored whenever the folder still
    // exists — which is the whole point of persisting the path.
    if (!(await exists(ref.token))) return null;
    this.outputFolder = ref.token;
    return ref;
  }

  async verifyPermission(ref: FileHandleRef, _mode: 'read' | 'readwrite'): Promise<boolean> {
    return await exists(ref.token);
  }

  /** A desktop never withdraws permission — re-verify, and re-pick if gone. */
  async requestPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean> {
    if (await this.verifyPermission(ref, mode)) return true;
    const fresh = await this.chooseOutputFolder();
    if (!fresh) return false;
    this.outputFolder = fresh.token;
    return true;
  }

  async writeFile(relativePath: string, data: Blob | string): Promise<string> {
    const folder = this.outputFolder;
    if (!folder) throw new Error('Choose an output folder first — the setting remembers it.');
    const path = resolvePath(folder, relativePath);
    await writeAbs(path, data);
    return path;
  }

  async readFile(relativePath: string): Promise<string> {
    const folder = this.outputFolder;
    if (!folder) throw new Error('Choose an output folder first.');
    return await readTextFile(resolvePath(folder, relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    const folder = this.outputFolder;
    if (!folder) return false;
    return await exists(resolvePath(folder, relativePath));
  }

  async deleteFile(relativePath: string): Promise<void> {
    const folder = this.outputFolder;
    if (!folder) return;
    await remove(resolvePath(folder, relativePath));
  }

  async listFiles(relativePath = ''): Promise<string[]> {
    const folder = this.outputFolder;
    if (!folder) return [];
    const path = relativePath ? resolvePath(folder, relativePath) : folder;
    if (!(await exists(path))) return [];
    const entries = await readDir(path);
    return entries.map((entry) =>
      relativePath ? `${relativePath}/${entry.name}` : entry.name,
    );
  }

  /** A save panel, not a download. */
  async saveAs(fileName: string, data: Blob | string): Promise<void> {
    const path = await saveDialog({ defaultPath: fileName });
    if (!path) return;
    await writeAbs(path, data);
  }

  async revealInFolder(relativePath: string): Promise<void> {
    const folder = this.outputFolder;
    if (!folder) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_folder', { path: resolvePath(folder, relativePath) });
  }

  async chooseBackupFolder(): Promise<FileHandleRef | null> {
    const path = await openDialog({ directory: true, title: 'Choose the backup folder' });
    if (!path || Array.isArray(path)) return null;
    this.backupFolder = path;
    return { token: path, name: baseName(path) };
  }

  async restoreBackupFolder(ref: FileHandleRef): Promise<FileHandleRef | null> {
    if (!(await exists(ref.token))) return null;
    this.backupFolder = ref.token;
    return ref;
  }

  /** Write into the chosen backup folder — never among the invoices. */
  async writeBackupFile(relativePath: string, data: Blob | string): Promise<string> {
    const folder = this.backupFolder;
    if (!folder) throw new Error('Choose a backup folder first — the setting remembers it.');
    const path = resolvePath(folder, relativePath);
    await writeAbs(path, data);
    return path;
  }
}
