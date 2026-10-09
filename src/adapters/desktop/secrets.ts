/**
 * Desktop `SecretAdapter` — the OS keychain.
 *
 * The web build keeps secrets in memory because a browser has nowhere safe.
 * The desktop build has macOS Keychain and Windows Credential Manager, and
 * this is the only file that changes: secrets are only ever reached through
 * the interface, so nothing else in the app knows the difference.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SecretAdapter } from '../types';

export class DesktopSecretAdapter implements SecretAdapter {
  readonly name = 'os-keychain';
  readonly isPersistent = true;

  async set(key: string, value: string): Promise<boolean> {
    await invoke('keychain_set', { account: key, secret: value });
    return true;
  }

  async get(key: string): Promise<string | null> {
    return await invoke<string | null>('keychain_get', { account: key });
  }

  async delete(key: string): Promise<void> {
    await invoke('keychain_delete', { account: key });
  }
}
