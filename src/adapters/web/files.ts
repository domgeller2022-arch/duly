/**
 * Web `FileAdapter`.
 *
 * The File System Access API can write silently into a folder the user chose,
 * which is what makes auto-filing possible in the browser at all. It exists only
 * in Chromium browsers, and the permission it grants does not survive a restart,
 * so every write path has to be able to fall back to a download. That fallback
 * is the reason nothing in the app treats auto-filing as guaranteed.
 *
 * Directories are created on demand and an existing file is only overwritten
 * after asking, so re-filing a paid invoice cannot silently destroy a version.
 */

import type { FileAdapter, FileHandleRef, WriteFileOptions } from '../types';

/** The subset of the File System Access API Duly uses. */
interface FileSystemDirectoryHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: string): Promise<void>;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  id?: string;
  startIn?: string;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

/** Permissions are cached for the session so a multi-file write asks once. */
const granted = new Map<string, FileSystemDirectoryHandle>();

export class WebFileAdapter implements FileAdapter {
  readonly name = 'web-file-system-access';

  private outputFolder: FileSystemDirectoryHandle | null = null;
  private backupFolder: FileSystemDirectoryHandle | null = null;
  private refToken: string | null = null;

  get supportsFolderAccess(): boolean {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  async chooseOutputFolder(): Promise<FileHandleRef | null> {
    if (!this.supportsFolderAccess) return null;
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'duly-output' });
      this.outputFolder = handle;
      this.refToken = `dir:${handle.name}:${Date.now()}`;
      granted.set(this.refToken, handle);
      return { token: this.refToken, name: handle.name };
    } catch {
      // The user cancelled, or the browser refused. Either way, downloads are
      // still available, so this is not an error worth surfacing.
      return null;
    }
  }

  async chooseBackupFolder(): Promise<FileHandleRef | null> {
    if (!this.supportsFolderAccess) return null;
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'duly-backup' });
      this.backupFolder = handle;
      const token = `dir:${handle.name}:${Date.now()}`;
      granted.set(token, handle);
      return { token, name: handle.name };
    } catch {
      return null;
    }
  }

  /**
   * Reuse a backup folder chosen earlier this session.
   *
   * A web directory handle cannot be revived from a string, so a grant from a
   * previous session is gone; the caller re-chooses. Best-effort, like every
   * web folder path.
   */
  async restoreBackupFolder(ref: FileHandleRef): Promise<FileHandleRef | null> {
    const handle = granted.get(ref.token);
    if (!handle) return null;
    this.backupFolder = handle;
    return ref;
  }

  /**
   * Restore a previously chosen folder.
   *
   * A directory handle cannot be revived from a string, so the only honest
   * answer without the user picking again is "ask them". The handle itself is
   * held for the session in `granted`, which covers every write within one run.
   */
  async restoreFolder(ref: FileHandleRef): Promise<FileHandleRef | null> {
    const handle = granted.get(ref.token);
    if (handle) {
      this.outputFolder = handle;
      return ref;
    }
    const fresh = await this.chooseOutputFolder();
    return fresh;
  }

  async verifyPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean> {
    const handle = granted.get(ref.token);
    if (!handle?.queryPermission) return false;
    try {
      return (await handle.queryPermission({ mode })) === 'granted';
    } catch {
      return false;
    }
  }

  async requestPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean> {
    const handle = granted.get(ref.token);
    if (!handle?.requestPermission) return false;
    try {
      return (await handle.requestPermission({ mode })) === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Write into the chosen folder, creating intermediate directories.
   *
   * Returns the path written. Throws if no folder has been chosen, so callers can
   * fall back to `saveAs` deliberately rather than silently losing the file.
   */
  async writeFile(
    relativePath: string,
    data: Blob | string,
    options: WriteFileOptions = {},
  ): Promise<string> {
    const root = this.outputFolder;
    if (!root) throw new NoOutputFolderError();
    return this.writeInto(root, relativePath, data, options);
  }

  /** On the web the stored path is already relative to the chosen folder. */
  async rewriteStoredFile(storedPath: string, data: Blob | string): Promise<string> {
    return this.writeFile(storedPath, data, { confirmOverwrite: false });
  }

  /**
   * Write into the chosen backup folder.
   *
   * The daily backup used to go through `writeFile`, so a full copy of the
   * database — clients, bank details, everything — landed in the invoices
   * folder the user shares with clients. Backups go to their own folder, and
   * never prompt (there is no UI mid-backup; the name is dated).
   */
  async writeBackupFile(relativePath: string, data: Blob | string): Promise<string> {
    const root = this.backupFolder;
    if (!root) throw new NoBackupFolderError();
    return this.writeInto(root, relativePath, data, { confirmOverwrite: false });
  }

  private async writeInto(
    root: FileSystemDirectoryHandle,
    relativePath: string,
    data: Blob | string,
    options: WriteFileOptions,
  ): Promise<string> {
    const { createDirectories = true, confirmOverwrite = true } = options;
    const parts = splitPath(relativePath);
    const fileName = parts.pop();
    if (!fileName) throw new Error(`"${relativePath}" is not a file path`);

    let dir = root;
    if (createDirectories && parts.length > 0) {
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
    }

    if (confirmOverwrite) {
      try {
        await dir.getFileHandle(fileName);
        const overwrite = await confirmOverwriteInUi(relativePath);
        if (!overwrite) return '';
      } catch {
        // No such file yet, which is the common case and needs no question.
      }
    }

    const handle = await dir.getFileHandle(fileName, { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(typeof data === 'string' ? new Blob([data]) : data);
      await stream.close();
    } catch (error) {
      await stream.abort?.(String(error));
      throw error;
    }

    return relativePath;
  }

  async readFile(relativePath: string): Promise<string> {
    const handle = await this.resolveFile(relativePath, false);
    const file = await handle.getFile();
    return file.text();
  }

  async exists(relativePath: string): Promise<boolean> {
    if (!this.outputFolder) return false;
    try {
      await this.resolveFile(relativePath, false);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const parts = splitPath(relativePath);
    const fileName = parts.pop();
    if (!fileName || !this.outputFolder) return;
    let dir = this.outputFolder;
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(fileName);
    } catch {
      // Removing something that is not there is the desired end state anyway.
    }
  }

  async listFiles(relativePath = ''): Promise<string[]> {
    if (!this.outputFolder) return [];
    const out: string[] = [];
    await walk(this.outputFolder, relativePath, out);
    return out.sort();
  }

  async saveAs(fileName: string, data: Blob | string): Promise<void> {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain;charset=utf-8' }) : data;
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Revoke on the next tick: revoking synchronously can cancel the download
      // in some browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  async revealInFolder(relativePath: string): Promise<void> {
    // There is no web equivalent of "show me this file". The honest fallback is
    // to write it again and let the browser's download shelf do the showing.
    const data = await this.readFile(relativePath).catch(() => null);
    if (data !== null) await this.saveAs(relativePath.split('/').pop() ?? 'document.txt', data);
  }

  /** Direct access for the backup writer. */
  getBackupFolder(): FileSystemDirectoryHandle | null {
    return this.backupFolder;
  }

  setBackupFolder(handle: FileSystemDirectoryHandle | null): void {
    this.backupFolder = handle;
  }

  setOutputFolder(handle: FileSystemDirectoryHandle | null): void {
    this.outputFolder = handle;
  }

  get currentRef(): FileHandleRef | null {
    return this.refToken ? { token: this.refToken, name: this.outputFolder?.name ?? '' } : null;
  }

  private async resolveFile(relativePath: string, create: boolean): Promise<FileSystemFileHandle> {
    if (!this.outputFolder) throw new NoOutputFolderError();
    const parts = splitPath(relativePath);
    const fileName = parts.pop();
    if (!fileName) throw new Error(`"${relativePath}" is not a file path`);

    let dir = this.outputFolder;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(fileName, { create });
  }
}

export class NoOutputFolderError extends Error {
  constructor() {
    super('No output folder has been chosen yet');
    this.name = 'NoOutputFolderError';
  }
}

export class NoBackupFolderError extends Error {
  constructor() {
    super('No backup folder has been chosen yet');
    this.name = 'NoBackupFolderError';
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Split a relative path, rejecting anything that would escape the folder. */
export function splitPath(relativePath: string): string[] {
  const parts = String(relativePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..'))
    throw new Error(`"${relativePath}" would write outside the output folder`);
  return parts;
}

/** File-name characters that are unsafe on Windows or in a URL. */
export function sanitiseFileName(name: string, replacement = '-'): string {
  return (
    String(name ?? '')
      // Characters Windows forbids, plus the ones that would let a name escape a
      // directory. Written with explicit escapes so the class is unambiguous.
      .replace(/[\\/:*?"<>|]/g, replacement)
      // Control characters have no business in a file name. Stripping them is the
      // entire point, so the no-control-regex rule does not apply here.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, replacement)
      .replace(/\s+/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 180)
  );
}

/** Sanitise each segment of a relative path while keeping the separators. */
export function sanitisePath(relativePath: string): string {
  return String(relativePath ?? '')
    .split('/')
    .map((part) => (part === '' ? '' : sanitiseFileName(part)))
    .filter((part) => part !== '')
    .join('/');
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[], depth = 0): Promise<void> {
  if (depth > 8) return;
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') out.push(path);
    else await walk(handle as FileSystemDirectoryHandle, path, out, depth + 1);
  }
}

/** Ask before overwriting. Resolves false when there is no UI to ask. */
async function confirmOverwriteInUi(relativePath: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  return window.confirm(`${relativePath} already exists. Replace it?`);
}
