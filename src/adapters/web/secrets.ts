/**
 * Web `SecretAdapter` — session memory only.
 *
 * A browser has nowhere safe to put an SMTP password. `localStorage` is readable
 * by any script on the origin; a cookie is worse. So the web build keeps secrets
 * in memory for the life of the tab and reports `isPersistent: false`, which
 * makes the UI say so plainly rather than pretending the password was saved.
 *
 * The desktop build replaces this with the OS keychain — macOS Keychain, Windows
 * Credential Manager — and nothing else in the app changes, because secrets are
 * only ever reached through this interface.
 */

import type { SecretAdapter } from '../types';

export class WebSecretAdapter implements SecretAdapter {
  readonly name = 'session-memory';
  readonly isPersistent = false;

  private readonly store = new Map<string, string>();

  async set(key: string, value: string): Promise<boolean> {
    this.store.set(key, value);
    // Deliberately false: the caller uses this to tell the user the password will
    // need typing again after a reload.
    return false;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Wipe everything, for a "clear session" action and on sign-out. */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** The keychain key for an email account's password. */
export function secretRefFor(accountId: string): string {
  return `duly.smtp.${accountId}`;
}
