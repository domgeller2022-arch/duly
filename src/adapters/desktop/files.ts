/**
 * Desktop `FileAdapter` — the native file system.
 *
 * The web build uses the File System Access API and re-asks permission when a
 * session's grant lapses. The desktop build has none of that friction: a
 * folder is chosen once through the dialog plugin, and every write after that
 * is silent — which is the plan's acceptance for Phase 6 on desktop.
 *
 * A `FileHandleRef.token` is the absolute path; "permission" on desktop just
 * means the folder still exists.
 */

import { invoke } from '@tauri-apps/api/core';
import type { FileAdapter, FileHandleRef } from '../types';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Write bytes or text to an absolute path, creating parents. */
async function writeAbs(path: string, data: Blob | string): Promise<void> {
  const dir = path.split(/[\\/]/).slice(0, -1).join('/');
  if (dir) {
    const exists = await invoke<boolean>('plugin:fs|exists', { path: dir });
    if (!exists) await invoke('plugin:fs|mkdir', { path: dir, recursive: true });
  }
  if (typeof data === 'string') {
    await invoke('plugin:fs|write_text_file', { path, contents: data });
    return;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  await invoke('plugin:fs|write_file', { path, contents: bytes.buffer });
}

export class DesktopFileAdapter implements FileAdapter {
  readonly name = 'desktop-native-fs';

  private outputFolder: string | null = null;

  get supportsFolderAccess(): boolean {
    return true;
  }

  async chooseOutputFolder(): Promise<FileHandleRef | null> {
    const path = await invoke<string | null>('plugin:dialog|open', {
      options: { directory: true, title: 'Choose the output folder' },
    });
    if (!path) return null;
    this.outputFolder = path;
    return { token: path, name: baseName(path) };
  }

  async restoreFolder(ref: FileHandleRef): Promise<FileHandleRef | null> {
    const exists = await invoke<boolean>('plugin:fs|exists', { path: ref.token });
    if (!exists) return null;
    this.outputFolder = ref.token;
    return ref;
  }

  async verifyPermission(ref: FileHandleRef, _mode: 'read' | 'readwrite'): Promise<boolean> {
    return await invoke<boolean>('plugin:fs|exists', { path: ref.token });
  }

  /** A desktop never withdraws permission — re-verify, and re-pick if gone. */
  async requestPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean> {
    if (await this.verifyPermission(ref, mode)) return true;
    const fresh = await this.chooseOutputFolder();
    if (!fresh) return false;
    this.outputFolder = mode === 'readwrite' ? fresh.token : this.outputFolder;
    return true;
  }

  async writeFile(relativePath: string, data: Blob | string): Promise<string> {
    const folder = this.outputFolder;
    if (!folder) throw new Error('Choose an output folder first — the setting remembers it.');
    const path = `${folder}/${relativePath}`;
    await writeAbs(path, data);
    return path;
  }

  async readFile(relativePath: string): Promise<string> {
    const folder = this.outputFolder;
    if (!folder) throw new Error('Choose an output folder first.');
    return await invoke<string>('plugin:fs|read_text_file', { path: `${folder}/${relativePath}` });
  }

  async exists(relativePath: string): Promise<boolean> {
    const folder = this.outputFolder;
    if (!folder) return false;
    return await invoke<boolean>('plugin:fs|exists', { path: `${folder}/${relativePath}` });
  }

  async deleteFile(relativePath: string): Promise<void> {
    const folder = this.outputFolder;
    if (!folder) return;
    await invoke('plugin:fs|remove', { path: `${folder}/${relativePath}` });
  }

  async listFiles(relativePath = ''): Promise<string[]> {
    const folder = this.outputFolder;
    if (!folder) return [];
    const path = relativePath ? `${folder}/${relativePath}` : folder;
    const exists = await invoke<boolean>('plugin:fs|exists', { path });
    if (!exists) return [];
    const entries = await invoke<{ name: string }[]>('plugin:fs|read_dir', { path });
    return entries.map((entry) => (relativePath ? `${relativePath}/${entry.name}` : entry.name));
  }

  /** A save panel, not a download. */
  async saveAs(fileName: string, data: Blob | string): Promise<void> {
    const path = await invoke<string | null>('plugin:dialog|save', {
      options: { defaultPath: fileName, title: 'Save' },
    });
    if (!path) return;
    await writeAbs(path, data);
  }

  async revealInFolder(relativePath: string): Promise<void> {
    const folder = this.outputFolder;
    if (!folder) return;
    await invoke('reveal_in_folder', { path: `${folder}/${relativePath}` });
  }

  async chooseBackupFolder(): Promise<FileHandleRef | null> {
    const path = await invoke<string | null>('plugin:dialog|open', {
      options: { directory: true, title: 'Choose the backup folder' },
    });
    if (!path) return null;
    return { token: path, name: baseName(path) };
  }
}
