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

  constructor(private readonly secrets: { get(key: string): Promise<string | null> }) {}

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
  }): Promise<TestMailResult> {
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
      acceptInvalidCerts: true,
    });
    return result;
  }

  async send(request: SendMailRequest): Promise<SendMailResult> {
    if (request.to.length === 0) {
      return { ok: false, error: 'Add at least one recipient.', via: 'smtp' };
    }

    const account = request.accountId ? await this.accountConfig(request.accountId) : null;

    // The password lives in the keychain under the account's secretRef.
    const secretKey =
      account?.secretRef ||
      (request.accountId ? `${KEY_PREFIX}${request.accountId}` : `${KEY_PREFIX}default`);
    const password = await this.secrets.get(secretKey);

    return await this.invokeSend({
      host: account?.host ?? '',
      port: account?.port ?? 587,
      secure: account?.secure ?? false,
      starttls: account?.starttls ?? true,
      username: account?.username ?? '',
      password: password ?? '',
      fromName: request.fromName,
      fromEmail: request.fromEmail,
      to: request.to,
      subject: request.subject,
      body: request.body,
      attachments: request.attachments.map((a) => ({
        fileName: a.fileName,
        data: payloadData(a.content),
        mimeType: a.mimeType,
      })),
      acceptInvalidCerts: account?.acceptInvalidCerts ?? false,
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
    acceptInvalidCerts: boolean;
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
      // A local Bridge presents its own certificate; a pinned fingerprint is the
      // user explicitly trusting it. Either way the handshake must not fail.
      acceptInvalidCerts: account.provider === 'proton_bridge' || account.pinnedCertificateFingerprint !== '',
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
    password: string;
    fromName: string;
    fromEmail: string;
    to: string[];
    subject: string;
    body: string;
    attachments: { fileName: string; data: string; mimeType: string }[];
    acceptInvalidCerts: boolean;
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
