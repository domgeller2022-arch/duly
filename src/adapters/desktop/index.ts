/**
 * The desktop platform: the web storage (IndexedDB works in the webview) with
 * the three adapters the web cannot have — native files, SMTP, the keychain.
 *
 * Storage stays IndexedDB deliberately: the webview has it, the JSON export
 * in Settings → Data is the one-time importer from a web install, and a
 * native SQLite would be a second storage engine for no gain until
 * multi-window or large datasets demand it.
 */

import type { Platform } from '../types';
import { invoke } from '@tauri-apps/api/core';
import type {
  files as adapterFiles,
  mail as adapterMail,
  platform as adapterPlatform,
  secrets as adapterSecrets,
  storage as adapterStorage,
} from '../types';
import { DexieStorageAdapter } from '../web/dexie';
import { DesktopFileAdapter } from './files';
import { DesktopMailAdapter } from './mail';
import { DesktopSecretAdapter } from './secrets';
import { OpenAiCompatibleAdapter } from '../web/ai';

export function createDesktopPlatform(dbName = 'duly'): Platform {
  const storage = new DexieStorageAdapter(dbName);
  const secrets = new DesktopSecretAdapter();
  const files = new DesktopFileAdapter();
  const mail = new DesktopMailAdapter();

  return {
    storage,
    files,
    mail,
    secrets,
    ai: new OpenAiCompatibleAdapter(),
    name: 'Desktop',
    capabilities: {
      fileSystemAccess: true,
      directMail: true,
      persistentSecrets: true,
      print: true,
      offline: true,
    },
    async autostartEnable() {
      await invoke('plugin:autostart|enable');
    },
    async autostartDisable() {
      await invoke('plugin:autostart|disable');
    },
    async autostartIsEnabled() {
      return await invoke<boolean>('plugin:autostart|is_enabled');
    },
  };
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type { adapterFiles, adapterMail, adapterPlatform, adapterSecrets, adapterStorage };
