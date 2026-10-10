/**
 * Application settings and the email-account records.
 *
 * Note what is *not* here: no SMTP password. Secrets live behind the
 * `SecretAdapter` in the OS keychain, so an exported JSON backup or a shared
 * database file can never leak a mailbox password.
 */

import { z } from 'zod';
import { baseEntity, currencyCode, isoDateTime, uuid } from './common';
import { DEFAULT_TERMS } from './crm';
import type { RoundingMethod } from '../tax/tax';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const ADDRESS_FORMATS = ['structured', 'single_line'] as const;
export type AddressFormat = (typeof ADDRESS_FORMATS)[number];

export const APPOINTMENT_OPTIONS = ['on_due_date', 'days_after_due'] as const;

export const settingsSchema = z.object({
  ...baseEntity,
  /** Singleton row: id is always "settings". */
  version: z.number().int().default(1),

  /* ---- locale ---- */
  locale: z.string().default('en-AU'),
  timeZone: z.string().default('Australia/Sydney'),
  dateFormat: z.enum(['DMY', 'MDY', 'ISO', 'YMD']).default('DMY'),
  addressFormat: z.enum(ADDRESS_FORMATS).default('structured'),
  /** Australian Financial Year start month (7 = 1 July). */
  financialYearStartMonth: z.number().int().min(1).max(12).default(7),

  /* ---- appearance ---- */
  theme: z.enum(THEMES).default('system'),
  density: z.enum(DENSITIES).default('comfortable'),
  appAccent: z.string().default('#1F5E5B'),
  /** The business selected in the sidebar switcher. */
  activeProfileId: uuid.nullable().default(null),
  sidebarCollapsed: z.boolean().default(false),

  /* ---- money and tax ---- */
  homeCurrency: currencyCode,
  defaultCurrency: currencyCode,
  roundingMethod: z.enum(['total_invoice', 'taxable_sale']).default('total_invoice'),
  /** Show an informational AUD equivalent on foreign-currency documents. */
  showAudEquivalent: z.boolean().default(false),
  /** Currency symbols before or after the amount. */
  currencySymbolPosition: z.enum(['before', 'after', 'code']).default('before'),

  /* ---- tax ---- */
  /** Print the ATO note when a business is not GST registered. */
  showNoGstNoteWhenUnregistered: z.boolean().default(true),
  /** Block finalising a GST-registered invoice that is missing required details. */
  enforceTaxInvoiceRules: z.boolean().default(true),
  /** Warn, rather than block, when buyer identity is missing on invoices >= $1,000. */
  warnOnMissingBuyerIdentity: z.boolean().default(true),

  /* ---- terms ---- */
  defaultTermsId: z.string().default('net_30'),
  customTerms: z
    .array(z.object({ id: z.string(), name: z.string(), days: z.number().int().nullable() }))
    .default([]),
  /** Offer these terms in the editor dropdown. */
  enabledTermIds: z.array(z.string()).default(DEFAULT_TERMS.map((t) => t.id)),
  /** Finalising always creates a deposit request. */
  defaultDepositPercent: z.string().default('0'),

  /* ---- documents ---- */
  defaultQuoteValidityDays: z.number().int().default(30),
  /** Re-file the PDF when a payment or void happens and the PAID stamp is on. */
  refileOnPayment: z.boolean().default(true),
  stampPaidOnPdf: z.boolean().default(true),
  /** Show the draft watermark on unsubmitted documents. */
  showDraftWatermark: z.boolean().default(true),
  /** Warn when a schedule or rule would push a document past 100% progress. */
  warnOnProgressOver100: z.boolean().default(true),

  /* ---- files ---- */
  outputFolderName: z.string().default(''),
  /** Serialised directory handle. Never exported — it is machine-specific. */
  outputFolderHandle: z.string().nullable().default(null),
  /** {year}/{client}/{number} - {client} - {date}.pdf */
  fileNamePattern: z.string().default('{number} - {client} - {date}.pdf'),
  /** Create the year folder per calendar or financial year. */
  yearFolderMode: z.enum(['calendar', 'financial', 'none']).default('calendar'),
  /** Use the business output sub-folder under the root. */
  useBusinessSubFolder: z.boolean().default(true),
  autoFileOnSubmit: z.boolean().default(true),
  autoFileOnPayment: z.boolean().default(true),
  autoFileOnVoid: z.boolean().default(true),

  /* ---- backup ---- */
  backupEnabled: z.boolean().default(true),
  backupFolderName: z.string().default(''),
  backupFolderHandle: z.string().nullable().default(null),
  backupKeep: z.number().int().default(30),
  backupOnQuit: z.boolean().default(true),
  lastBackupAt: isoDateTime.nullable().default(null),
  lastBackupName: z.string().default(''),

  /* ---- automation ---- */
  automationEnabled: z.boolean().default(true),
  /** Scheduler wakes on start and every 15 minutes while the app is open. */
  schedulerIntervalMinutes: z.number().int().default(15),
  /** Reminder policies, rules and late fees run when this is on. */
  runReminderEngine: z.boolean().default(true),
  runLateFeeEngine: z.boolean().default(true),
  runQuoteExpiry: z.boolean().default(true),
  runRecurring: z.boolean().default(true),

  /* ---- email ---- */
  defaultEmailAccountId: uuid.nullable().default(null),
  /** When no account can send, fall back to mailto: with the PDF downloaded. */
  emailFallbackToMailto: z.boolean().default(true),
  /** Trust a locally-generated Bridge certificate (Proton Mail Bridge only). */
  trustBridgeCertificate: z.boolean().default(false),
  pinnedBridgeFingerprint: z.string().default(''),

  /* ---- privacy ---- */
  /** Refuse any AI endpoint that is not localhost. */
  aiLocalOnly: z.boolean().default(true),
  aiEnabled: z.boolean().default(false),
  /** Redact client names, ABNs and bank details before a cloud call. */
  aiRedact: z.boolean().default(true),
  /** OpenAI-compatible endpoint: Ollama, OpenRouter, or any other. */
  aiBaseUrl: z.string().default('http://localhost:11434/v1'),
  /** Keychain key for the API key. Never stored in the database. */
  aiSecretRef: z.string().default('ai-api-key'),
  /** Model per task: text for drafting and entry, vision for receipts. */
  aiTextModel: z.string().default(''),
  aiVisionModel: z.string().default(''),

  /* ---- ai cost visibility ---- */
  /** Cap AI spend per calendar month. Off means no cap. */
  aiSpendCapEnabled: z.boolean().default(false),
  /** The monthly cap, in US dollars. */
  aiSpendCapUsd: z.number().nonnegative().default(0),
  /** Estimated cost, in US dollars per 1,000 tokens — used for the cap and the running total. */
  aiCostPer1kTokensUsd: z.number().nonnegative().default(0),
  /** The month the running total is for, 'YYYY-MM'. */
  aiSpendPeriod: z.string().default(''),
  /** AI spend recorded for the current month, in US dollars. */
  aiSpendUsd: z.number().nonnegative().default(0),
  /** Tokens used this month, for visibility. */
  aiSpendTokens: z.number().int().nonnegative().default(0),

  /* ---- misc ---- */
  appLockEnabled: z.boolean().default(false),
  /** What submit does after finalising: nothing, a PDF download, or the mail app. */
  onSubmitAction: z.enum(['submit_only', 'download_pdf', 'open_email']).default('submit_only'),
  /** Which mail app "open the mail app" opens: the OS default, or a web compose. */
  webmailProvider: z.enum(['mailto', 'gmail', 'outlook', 'proton']).default('mailto'),
  /** Google Drive sync: the OAuth client id the user creates once, free. */
  cloudClientId: z.string().default(''),
  cloudFolderName: z.string().default('Duly'),
  cloudSyncOnSubmit: z.boolean().default(true),
  onboardingComplete: z.boolean().default(false),
  lastSeenVersion: z.string().default(''),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS_ID = 'settings';

/* ------------------------------------------------------------------ */
/* Email accounts                                                      */
/* ------------------------------------------------------------------ */

export const EMAIL_PROVIDERS = ['proton_bridge', 'proton_token', 'gmail', 'smtp', 'mailto'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const PROVIDER_PRESETS: Record<
  EmailProvider,
  {
    name: string;
    host: string;
    port: number;
    secure: boolean;
    starttls: boolean;
    usernameHint: string;
    docsUrl: string;
  }
> = {
  proton_bridge: {
    name: 'Proton Mail via Bridge',
    host: '127.0.0.1',
    port: 1025,
    secure: false,
    starttls: true,
    usernameHint: 'Generated by Bridge',
    docsUrl: 'https://proton.me/support/smtp-submission',
  },
  proton_token: {
    name: 'Proton Mail via SMTP token',
    host: 'smtp.protonmail.ch',
    port: 587,
    secure: false,
    starttls: true,
    usernameHint: 'Your custom-domain address',
    docsUrl: 'https://proton.me/support/smtp-submission',
  },
  gmail: {
    name: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    starttls: true,
    usernameHint: 'your.address@gmail.com',
    docsUrl: 'https://support.google.com/accounts/answer/185833',
  },
  smtp: {
    name: 'Other SMTP server',
    host: '',
    port: 587,
    secure: false,
    starttls: true,
    usernameHint: '',
    docsUrl: '',
  },
  mailto: {
    name: 'Open my mail app (no password needed)',
    host: '',
    port: 0,
    secure: false,
    starttls: false,
    usernameHint: '',
    docsUrl: '',
  },
};

export const emailAccountSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  provider: z.enum(EMAIL_PROVIDERS).default('gmail'),
  /** Displayed on outgoing mail; defaults to the business name. */
  fromName: z.string().default(''),
  fromEmail: z.string().default(''),
  replyTo: z.string().default(''),

  host: z.string().default(''),
  port: z.number().int().default(587),
  /** Implicit TLS (port 465) rather than STARTTLS. */
  secure: z.boolean().default(false),
  starttls: z.boolean().default(true),
  /** Keychain key for the password. Never stored in the database. */
  secretRef: z.string().default(''),
  /** SHA-256 fingerprint for a pinned local Bridge certificate. */
  pinnedCertificateFingerprint: z.string().default(''),
  /** Bridge sends from a generated username; keep it for the password prompt. */
  bridgeGeneratedUsername: z.string().default(''),

  /** Last successful send, used to show the account is working. */
  lastTestedAt: isoDateTime.nullable().default(null),
  lastTestSucceeded: z.boolean().default(false),
  lastTestError: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  /** Proof-of-life: new invoice created in the last N days. */
  recentDocumentDays: z.number().int().default(30),
});
export type EmailAccount = z.infer<typeof emailAccountSchema>;

/* ------------------------------------------------------------------ */
/* Saved views                                                         */
/* ------------------------------------------------------------------ */

export const savedViewSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  entity: z.enum(['document', 'client', 'item']).default('document'),
  /** Serialised filter state; the list screen reads it back. */
  filters: z.string().default('{}'),
  icon: z.string().default(''),
  colour: z.string().default('#1F5E5B'),
  displayOrder: z.number().int().default(0),
  builtin: z.boolean().default(false),
  /** A built-in view cannot be deleted, only hidden. */
  hidden: z.boolean().default(false),
});
export type SavedView = z.infer<typeof savedViewSchema>;

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

export function defaultSettings(): Settings {
  return settingsSchema.parse({ id: DEFAULT_SETTINGS_ID });
}

export function allTerms(settings: Settings): (typeof DEFAULT_TERMS)[number][] {
  const custom = settings.customTerms.map((t) => ({
    id: t.id,
    name: t.name,
    days: t.days,
    kind: 'custom_date' as const,
  }));
  return [...DEFAULT_TERMS, ...custom];
}

export function roundingMethod(settings: Settings): RoundingMethod {
  return settings.roundingMethod as RoundingMethod;
}
