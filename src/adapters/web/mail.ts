/**
 * Web `MailAdapter` — the fallback that works everywhere.
 *
 * A browser cannot open an authenticated SMTP connection, so Duly's web build
 * cannot attach a PDF and send it from its own mailbox. What it *can* do is the
 * thing that actually gets invoices paid:
 *
 *   1. write the PDF to the output folder, or download it
 *   2. copy the merged subject and body to the clipboard
 *   3. open the user's own mail app with everything filled in
 *
 * All the user has to do is press send and attach the file that is already on
 * their clipboard's file manager. That works on a free Proton account, on Gmail,
 * on Outlook, on anything — which is why this is the documented primary path for
 * v1 on the web, with SMTP arriving on the desktop build.
 *
 * The desktop build swaps this adapter for one that speaks SMTP over the user's
 * own credentials. Nothing else in the app changes.
 */

import type { MailAdapter, SendMailRequest, SendMailResult, TestMailResult } from '../types';

export class WebMailAdapter implements MailAdapter {
  readonly name = 'mailto';
  readonly canSendDirectly = false;

  /**
   * The web build cannot authenticate, so "test" here means checking that a
   * mailto: link can actually be built from the settings the user entered.
   *
   * Catching a malformed From address now saves a failed send later.
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
    if (!args.fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.fromEmail)) {
      return { ok: false, error: 'That From address is not a valid email address.', via: 'mailto' };
    }
    if (!args.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to)) {
      return { ok: false, error: 'That test recipient is not a valid email address.', via: 'mailto' };
    }

    const body = 'Duly test message. Your email account settings are ready to use.';
    buildMailto({ to: [args.to], subject: 'Duly test', body });

    return {
      ok: true,
      via: 'mailto',
      // Nothing was sent, and the UI needs to be told why rather than inferring it.
      error:
        'Duly on the web opens your mail app rather than connecting directly, so nothing was sent. Install the desktop build to send through Proton Mail or Gmail automatically.',
    };
  }

  /**
   * Not a real send.
   *
   * Returns a result the UI can act on: the caller writes the PDF first, then
   * opens the mail app. Marking it `opened_in_app` rather than `sent` keeps the
   * invoice's email history honest — we know the message was prepared, not that
   * it left the building.
   */
  async send(request: SendMailRequest): Promise<SendMailResult> {
    return this.openInMailApp({
      to: request.to,
      cc: request.cc,
      subject: request.subject,
      body: request.body,
    });
  }

  async openInMailApp(args: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
  }): Promise<SendMailResult> {
    const to = args.to.filter(Boolean);
    if (to.length === 0) return { ok: false, error: 'Add at least one recipient.', via: 'mailto' };

    // The mailbox of choice: the settings name the provider, and the web
    // compose URL fills in the same subject and body a mailto would.
    const href = buildWebmailUrl(await this.readProvider(), args);

    // Copy the body first: the mail app takes focus, and a clipboard write after
    // that can be rejected by the browser for lack of user activation.
    const copied = await this.copyToClipboard(`${args.subject}\n\n${args.body}`);

    const opened = openUrl(href);
    if (!opened) {
      return {
        ok: false,
        error:
          'This browser would not open your mail app. The subject and body have been copied — paste them into a new message.',
        via: 'mailto',
      };
    }

    return {
      ok: true,
      via: 'mailto',
      queued: false,
      recoverable: true,
      error: copied
        ? undefined
        : 'Your mail app opened with the message ready. The clipboard was not available, so copy the text from the email editor.',
    };
  }

  async canUseClipboard(): Promise<boolean> {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard?.writeText === 'function' &&
      typeof window !== 'undefined' &&
      window.isSecureContext
    );
  }

  /** The webmail provider the settings name, read lazily. */
  private async readProvider(): Promise<'mailto' | 'gmail' | 'outlook' | 'proton'> {
    try {
      const { storage } = await import('../index');
      const settings = await storage().getSettings();
      return settings?.webmailProvider ?? 'mailto';
    } catch {
      return 'mailto';
    }
  }

  async copyToClipboard(text: string): Promise<boolean> {
    if (!(await this.canUseClipboard())) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* mailto: construction                                                */
/* ------------------------------------------------------------------ */

/** RFC 6068 caps each component; longer values are truncated rather than dropped. */
const MAX_SUBJECT = 200;
const MAX_BODY = 8000;

/**
 * The web compose URL for the provider the settings name — the plan's "open
 * your mailbox of choice". Gmail, Outlook and Proton Mail all have a
 * pre-filled compose URL; `mailto` opens the OS default mail app.
 */
export function buildWebmailUrl(
  provider: 'mailto' | 'gmail' | 'outlook' | 'proton',
  args: { to: string[]; cc?: string[]; subject: string; body: string },
): string {
  const to = args.to.filter(Boolean).join(',');
  const params = new URLSearchParams();
  if (args.cc?.length) params.set('cc', args.cc.join(','));
  params.set('subject', args.subject.slice(0, MAX_SUBJECT));
  params.set('body', args.body.slice(0, MAX_BODY));
  const query = params.toString();

  switch (provider) {
    case 'gmail':
      return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&${query}`;
    case 'outlook':
      return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&${query}`;
    case 'proton':
      return `https://mail.proton.me/compose?to=${encodeURIComponent(to)}&${query}`;
    default:
      return buildMailto(args);
  }
}

export function buildMailto(args: { to: string[]; cc?: string[]; subject: string; body: string }): string {
  const params = new URLSearchParams();
  if (args.cc?.length) params.set('cc', args.cc.join(','));
  params.set('subject', truncate(args.subject ?? '', MAX_SUBJECT));
  params.set('body', truncate(normaliseBody(args.body ?? ''), MAX_BODY));
  return `mailto:${args.to.join(',')}?${params.toString()}`;
}

/** Turn plain newlines into the CRLF line breaks a mail client expects. */
function normaliseBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function openUrl(href: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.location.href = href;
    return true;
  } catch {
    return false;
  }
}
