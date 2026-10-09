/**
 * Desktop `MailAdapter` — SMTP through the Rust command.
 *
 * The web build opens the mail app because it cannot authenticate. The
 * desktop build speaks SMTP directly through lettre: Proton Mail Bridge
 * (a local relay with its own certificate), Gmail with an app password, or
 * any SMTP host. The password is resolved from the keychain by the account
 * id, and never reaches the webview.
 */

import { invoke } from '@tauri-apps/api/core';
import type { MailAdapter, SendMailRequest, SendMailResult, TestMailResult } from '../types';

function base64Of(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Data URL or plain base64 both arrive as content; strip the data-URL prefix. */
function payloadData(content: string): string {
  const comma = content.indexOf(',');
  return content.startsWith('data:') && comma >= 0 ? content.slice(comma + 1) : content;
}

const KEY_PREFIX = 'smtp:';

export class DesktopMailAdapter implements MailAdapter {
  readonly name = 'smtp';
  readonly canSendDirectly = true;

  /**
   * A real test send: one message to the given address. The plan asks for a
   * test send, because a wrong port or password is invisible until a real
   * invoice fails to leave.
   */
  async testAccount(args: {
    host: string;
    port: number;
    secure: boolean;
    starttls: boolean;
    username: string;
    password: string;
    fromEmail: string;
    to: string;
    pinnedFingerprint?: string;
  }): Promise<TestMailResult> {
    // A test has the password in hand (the settings screen just typed or
    // stored it) and no keychain key to name, so it goes in directly —
    // the one place a password crosses, because the user just gave it.
    const result = await this.invokeSend({
      host: args.host,
      port: args.port,
      secure: args.secure,
      starttls: args.starttls,
      username: args.username,
      password: args.password,
      fromName: 'Duly',
      fromEmail: args.fromEmail,
      to: [args.to],
      subject: 'Duly test',
      body: 'Duly test message. Your email account settings are ready to use.',
      attachments: [],
      pinnedFingerprint: args.pinnedFingerprint ?? '',
    });
    return result;
  }

  async send(request: SendMailRequest): Promise<SendMailResult> {
    if (request.to.length === 0) {
      return { ok: false, error: 'Add at least one recipient.', via: 'smtp' };
    }

    const account = request.accountId ? await this.accountConfig(request.accountId) : null;

    // The password never crosses into the webview: Rust resolves it from the
    // keychain by the secret key named here.
    const secretKey =
      account?.secretRef ||
      (request.accountId ? `${KEY_PREFIX}${request.accountId}` : `${KEY_PREFIX}default`);

    return await this.invokeSend({
      host: account?.host ?? '',
      port: account?.port ?? 587,
      secure: account?.secure ?? false,
      starttls: account?.starttls ?? true,
      username: account?.username ?? '',
      secretKey,
      fromName: request.fromName,
      fromEmail: request.fromEmail,
      replyTo: request.replyTo || undefined,
      to: request.to,
      cc: request.cc,
      bcc: request.bcc,
      subject: request.subject,
      body: request.body,
      attachments: request.attachments.map((a) => ({
        fileName: a.fileName,
        data: payloadData(a.content),
        mimeType: a.mimeType,
      })),
      // Trust is explicit: a configured fingerprint, never a provider blanket.
      pinnedFingerprint: account?.pinnedFingerprint ?? '',
    });
  }

  /** The account's connection settings, stored in the settings table. */
  private async accountConfig(accountId: string): Promise<{
    host: string;
    port: number;
    secure: boolean;
    starttls: boolean;
    username: string;
    secretRef: string;
    pinnedFingerprint: string;
  } | null> {
    const { storage } = await import('../index');
    const accounts = await storage().listEmailAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return null;
    return {
      host: account.host,
      port: account.port,
      secure: account.secure,
      starttls: account.starttls,
      // Bridge sends from a generated username; the others send from the address.
      username: account.bridgeGeneratedUsername || account.fromEmail,
      secretRef: account.secretRef,
      pinnedFingerprint: account.pinnedCertificateFingerprint,
    };
  }

  /** The fallback that always works, on desktop too. */
  async openInMailApp(args: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
  }): Promise<SendMailResult> {
    const { WebMailAdapter } = await import('../web/mail');
    const fallback = new WebMailAdapter();
    return fallback.openInMailApp(args);
  }

  async canUseClipboard(): Promise<boolean> {
    return typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
  }

  private async invokeSend(args: {
    host: string;
    port: number;
    secure: boolean;
    starttls: boolean;
    username: string;
    /** A test connection carries the password; a real send names its keychain key. */
    password?: string;
    secretKey?: string;
    fromName: string;
    fromEmail: string;
    replyTo?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    attachments: { fileName: string; data: string; mimeType: string }[];
    pinnedFingerprint?: string;
  }): Promise<SendMailResult> {
    try {
      const result = await invoke<{ ok: boolean; error: string | null }>('send_smtp', { args });
      return {
        ok: result.ok,
        error: result.error ?? undefined,
        via: 'smtp',
        queued: false,
        recoverable: false,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The send failed.',
        via: 'smtp',
        queued: false,
        recoverable: false,
      };
    }
  }
}

export { base64Of };
