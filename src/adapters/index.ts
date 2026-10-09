/**
 * The web platform: IndexedDB, the File System Access API, mailto and
 * session-memory secrets.
 *
 * This is the whole of the web build's platform layer. The desktop and Android
 * builds install a different set of four adapters and nothing else changes.
 */

import type { Platform } from './types';
import {
  files as adapterFiles,
  mail as adapterMail,
  platform as adapterPlatform,
  secrets as adapterSecrets,
  storage as adapterStorage,
} from './types';
import { DexieStorageAdapter } from './web/dexie';
import { WebFileAdapter } from './web/files';
import { WebMailAdapter } from './web/mail';
import { WebSecretAdapter } from './web/secrets';
import { OpenAiCompatibleAdapter } from './web/ai';

export function createWebPlatform(dbName = 'duly'): Platform {
  const storage = new DexieStorageAdapter(dbName);
  const files = new WebFileAdapter();
  const mail = new WebMailAdapter();
  const secrets = new WebSecretAdapter();

  return {
    storage,
    files,
    mail,
    secrets,
    ai: new OpenAiCompatibleAdapter(),
    name: 'Web prototype',
    capabilities: {
      // Safari and Firefox have no File System Access API, so the prototype is
      // built for Chrome and Edge, where auto-filing into a chosen folder works.
      fileSystemAccess: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
      directMail: false,
      persistentSecrets: false,
      print: typeof window !== 'undefined' && 'print' in window,
      offline: true,
    },
  };
}

/* Re-exported so feature code never reaches past this module into ./types. */
export {
  adapterFiles as files,
  adapterMail as mail,
  adapterPlatform as platform,
  adapterSecrets as secrets,
  adapterStorage as storage,
};
export type {
  AttachmentPayload,
  BackupInfo,
  DataSnapshot,
  DocumentBundleRecord,
  FileAdapter,
  FileHandleRef,
  MailAdapter,
  Platform,
  QueryOptions,
  SecretAdapter,
  SendMailRequest,
  SendMailResult,
  StorageAdapter,
  TestMailResult,
  WriteFileOptions,
} from './types';
export { setPlatform, withAdapter } from './types';

export { DexieStorageAdapter } from './web/dexie';
export { WebFileAdapter, NoOutputFolderError, sanitiseFileName, sanitisePath, splitPath } from './web/files';
export { WebMailAdapter, buildMailto } from './web/mail';
export { WebSecretAdapter, secretRefFor } from './web/secrets';
export {
  SCHEMA_VERSION,
  SchemaTooNewError,
  appVersion,
  assertSchemaSupported,
  compareVersions,
} from './web/version';
