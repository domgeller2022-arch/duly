/**
 * The platform adapter interfaces.
 *
 * The four adapters are the entire surface between the core and the platform.
 * Swapping web for Tauri means swapping these four implementations and nothing
 * else — no feature code changes, because no feature code touches IndexedDB,
 * the file system, SMTP or the keychain directly.
 *
 *   Storage  IndexedDB (web)  -> SQLite (desktop and Android)
 *   Files    browser download -> native file system
 *   Mail     mailto: fallback -> SMTP from the Rust side
 *   Secrets  in-memory (web)  -> OS keychain
 */

import type {
  Attachment,
  AuditLogEntry,
  AutomationLogEntry,
  BankTransaction,
  BusinessProfile,
  Client,
  ClientCredit,
  Contact,
  ContentPreset,
  CurrencyRate,
  CustomField,
  DesignTemplate,
  Document,
  DocumentLine,
  EmailAccount,
  EmailLog,
  EmailTemplate,
  Expense,
  Item,
  NumberSequence,
  OutboxEntry,
  Payment,
  Project,
  Reminder,
  ReminderPolicy,
  LateFeePolicy,
  Retainer,
  Rule,
  SavedView,
  Settings,
  Signature,
  TimeEntry,
} from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';

/** Every table, so backup, import and export can walk them generically. */
export interface DataSnapshot {
  /** Bumped on every migration, recorded in the backup filename. */
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  settings: Settings[];
  businessProfiles: BusinessProfile[];
  clients: Client[];
  contacts: Contact[];
  items: Item[];
  taxCodes: TaxCode[];
  currencyRates: CurrencyRate[];
  customFields: CustomField[];
  documents: Document[];
  documentLines: DocumentLine[];
  payments: Payment[];
  designTemplates: DesignTemplate[];
  contentPresets: ContentPreset[];
  emailTemplates: EmailTemplate[];
  emailLogs: EmailLog[];
  outbox: OutboxEntry[];
  recurringSchedules: import('@/core/schemas/automation').RecurringSchedule[];
  numberSequences: NumberSequence[];
  rules: Rule[];
  reminderPolicies: ReminderPolicy[];
  lateFeePolicies: LateFeePolicy[];
  reminders: Reminder[];
  attachments: Attachment[];
  auditLog: AuditLogEntry[];
  automationLog: AutomationLogEntry[];
  clientCredits: ClientCredit[];
  signatures: Signature[];
  bankTransactions: BankTransaction[];
  savedViews: SavedView[];
  projects: Project[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  retainers: Retainer[];
  emailAccounts: Omit<EmailAccount, 'secretRef'>[];
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export interface QueryOptions {
  /** Exclude soft-deleted rows. Default true. */
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * A document with its lines and payments, which is what every screen actually
 * needs. Fetching them separately would mean three round trips and a window in
 * which the totals could be read against the wrong lines.
 */
export interface DocumentBundleRecord {
  document: Document;
  lines: DocumentLine[];
  payments: Payment[];
}

export interface BackupInfo {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  schemaVersion: number;
}

/**
 * Data storage.
 *
 * The only method with a correctness requirement rather than a convenience one
 * is `reserveDocumentNumber`, which must hand out a number exactly once even
 * under concurrent calls — two invoices sharing a number is the one data bug an
 * accounting package cannot have.
 */
export interface StorageAdapter {
  readonly name: string;

  init(): Promise<void>;
  close(): Promise<void>;
  readonly schemaVersion: number;

  /* settings */
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  /* business profiles */
  listBusinessProfiles(options?: QueryOptions): Promise<BusinessProfile[]>;
  getBusinessProfile(id: string): Promise<BusinessProfile | undefined>;
  saveBusinessProfile(profile: BusinessProfile): Promise<void>;
  deleteBusinessProfile(id: string): Promise<void>;

  /* clients */
  listClients(options?: QueryOptions): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  saveClient(client: Client): Promise<void>;
  deleteClient(id: string): Promise<void>;
  listContacts(clientId?: string): Promise<Contact[]>;
  saveContact(contact: Contact): Promise<void>;
  deleteContact(id: string): Promise<void>;

  /* items */
  listItems(
    options?: QueryOptions & { search?: string; activeOnly?: boolean; category?: string },
  ): Promise<Item[]>;
  getItem(id: string): Promise<Item | undefined>;
  saveItem(item: Item): Promise<void>;
  saveItems(items: Item[]): Promise<void>;
  saveClients(clients: Client[]): Promise<void>;
  deleteItem(id: string): Promise<void>;

  /* tax codes and rates */
  listTaxCodes(): Promise<TaxCode[]>;
  saveTaxCode(code: TaxCode): Promise<void>;
  deleteTaxCode(id: string): Promise<void>;
  listCurrencyRates(from?: string): Promise<CurrencyRate[]>;
  saveCurrencyRate(rate: CurrencyRate): Promise<void>;
  deleteCurrencyRate(id: string): Promise<void>;

  /* documents */
  listDocuments(
    options?: QueryOptions & { type?: string; status?: string; clientId?: string; profileId?: string },
  ): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  getDocumentBundle(id: string): Promise<DocumentBundleRecord | undefined>;
  listDocumentLines(documentId: string): Promise<DocumentLine[]>;
  saveDocument(document: Document, lines?: DocumentLine[]): Promise<void>;
  saveDocumentLine(line: DocumentLine): Promise<void>;
  saveDocumentLines(lines: DocumentLine[]): Promise<void>;
  deleteDocumentLine(id: string): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  /**
   * Reserve the next number for a profile and document type.
   *
   * Must be atomic: two invoices submitted in the same tick must never be handed
   * the same number, and a number once issued is never issued again.
   */
  reserveDocumentNumber(args: {
    profileId: string;
    documentType: string;
    date: string;
    pattern?: string;
    clientCode?: string;
    profileCode?: string;
  }): Promise<{ number: string; sequence: NumberSequence }>;

  /* payments */
  listPayments(documentId?: string): Promise<Payment[]>;
  savePayment(payment: Payment): Promise<void>;
  deletePayment(id: string): Promise<void>;

  /* templates */
  listDesignTemplates(): Promise<DesignTemplate[]>;
  getDesignTemplate(id: string): Promise<DesignTemplate | undefined>;
  saveDesignTemplate(template: DesignTemplate): Promise<void>;
  deleteDesignTemplate(id: string): Promise<void>;
  listContentPresets(): Promise<ContentPreset[]>;
  saveContentPreset(preset: ContentPreset): Promise<void>;
  deleteContentPreset(id: string): Promise<void>;
  listEmailTemplates(): Promise<EmailTemplate[]>;
  saveEmailTemplate(template: EmailTemplate): Promise<void>;
  deleteEmailTemplate(id: string): Promise<void>;

  /* email accounts and logs */
  listEmailAccounts(): Promise<EmailAccount[]>;
  getEmailAccount(id: string): Promise<EmailAccount | undefined>;
  saveEmailAccount(account: EmailAccount): Promise<void>;
  deleteEmailAccount(id: string): Promise<void>;
  listEmailLogs(documentId?: string): Promise<EmailLog[]>;
  saveEmailLog(log: EmailLog): Promise<void>;
  listOutbox(): Promise<OutboxEntry[]>;
  saveOutbox(entry: OutboxEntry): Promise<void>;
  deleteOutbox(id: string): Promise<void>;

  /* automation */
  listRecurringSchedules(): Promise<import('@/core/schemas/automation').RecurringSchedule[]>;
  getRecurringSchedule(
    id: string,
  ): Promise<import('@/core/schemas/automation').RecurringSchedule | undefined>;
  saveRecurringSchedule(schedule: import('@/core/schemas/automation').RecurringSchedule): Promise<void>;
  deleteRecurringSchedule(id: string): Promise<void>;
  listNumberSequences(profileId?: string): Promise<NumberSequence[]>;
  saveNumberSequence(sequence: NumberSequence): Promise<void>;
  listRules(): Promise<Rule[]>;
  saveRule(rule: Rule): Promise<void>;
  deleteRule(id: string): Promise<void>;
  listReminderPolicies(): Promise<ReminderPolicy[]>;
  saveReminderPolicy(policy: ReminderPolicy): Promise<void>;
  listLateFeePolicies(): Promise<LateFeePolicy[]>;
  saveLateFeePolicy(policy: LateFeePolicy): Promise<void>;
  listReminders(status?: string): Promise<Reminder[]>;
  saveReminder(reminder: Reminder): Promise<void>;
  deleteReminder(id: string): Promise<void>;
  listAutomationLog(limit?: number): Promise<AutomationLogEntry[]>;
  saveAutomationLog(entry: import('@/core/schemas/automation').AutomationLogInput): Promise<void>;
  clearAutomationLog(): Promise<void>;

  /* business modules */
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listTimeEntries(options?: { clientId?: string; uninvoicedOnly?: boolean }): Promise<TimeEntry[]>;
  saveTimeEntry(entry: TimeEntry): Promise<void>;
  deleteTimeEntry(id: string): Promise<void>;
  listExpenses(options?: { clientId?: string; uninvoicedOnly?: boolean }): Promise<Expense[]>;
  saveExpense(expense: Expense): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  listRetainers(): Promise<Retainer[]>;
  saveRetainer(retainer: Retainer): Promise<void>;
  deleteRetainer(id: string): Promise<void>;

  /* supporting records */
  listAttachments(ownerId?: string): Promise<Attachment[]>;
  saveAttachment(attachment: Attachment): Promise<void>;
  deleteAttachment(id: string): Promise<void>;
  listCustomFields(entity?: string): Promise<CustomField[]>;
  saveCustomField(field: CustomField): Promise<void>;
  deleteCustomField(id: string): Promise<void>;
  listSavedViews(entity?: string): Promise<SavedView[]>;
  saveSavedView(view: SavedView): Promise<void>;
  deleteSavedView(id: string): Promise<void>;
  listClientCredits(clientId?: string): Promise<ClientCredit[]>;
  saveClientCredit(credit: ClientCredit): Promise<void>;
  deleteClientCredit(id: string): Promise<void>;
  listSignatures(documentId?: string): Promise<Signature[]>;
  saveSignature(signature: Signature): Promise<void>;
  listBankTransactions(status?: string): Promise<BankTransaction[]>;
  saveBankTransaction(transaction: BankTransaction): Promise<void>;
  saveBankTransactions(transactions: BankTransaction[]): Promise<void>;
  deleteBankTransaction(id: string): Promise<void>;
  listAuditLog(limit?: number): Promise<AuditLogEntry[]>;
  saveAuditLog(entry: import('@/core/schemas/crm').AuditLogInput): Promise<void>;

  /* whole-database operations */
  exportSnapshot(): Promise<DataSnapshot>;
  /** Replace everything. Takes a pre-migration backup automatically. */
  importSnapshot(
    snapshot: DataSnapshot,
    mode: 'replace' | 'merge',
  ): Promise<{ imported: number; skipped: number }>;
  createBackup(name: string): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(id: string): Promise<void>;
  deleteBackup(id: string): Promise<void>;
  estimateSize(): Promise<number>;
  clear(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export interface WriteFileOptions {
  /** Create intermediate folders. Default true. */
  createDirectories?: boolean;
  /** Ask before overwriting. Default true. */
  confirmOverwrite?: boolean;
}

export interface FileHandleRef {
  /** Opaque; the web adapter stores a serialised directory handle. */
  token: string;
  name: string;
}

export interface FileAdapter {
  readonly name: string;

  /** Ask the user to choose an output folder. Returns null if cancelled. */
  chooseOutputFolder(): Promise<FileHandleRef | null>;
  /** Re-use a previously chosen folder, or null if permission was withdrawn. */
  restoreFolder(ref: FileHandleRef): Promise<FileHandleRef | null>;
  /** True when the folder is still usable without another prompt. */
  verifyPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean>;
  /** Ask again for a folder whose permission lapsed. */
  requestPermission(ref: FileHandleRef, mode: 'read' | 'readwrite'): Promise<boolean>;

  /** Write text or a blob into the chosen folder at a relative path. */
  writeFile(relativePath: string, data: Blob | string, options?: WriteFileOptions): Promise<string>;
  readFile(relativePath: string): Promise<string>;
  exists(relativePath: string): Promise<boolean>;
  deleteFile(relativePath: string): Promise<void>;
  listFiles(relativePath?: string): Promise<string[]>;

  /** Save outside the chosen folder: a download on the web, a save panel on desktop. */
  saveAs(fileName: string, data: Blob | string): Promise<void>;

  /** Reveal a written file in the OS file manager, where the platform allows it. */
  revealInFolder(relativePath: string): Promise<void>;

  /** Set the folder where daily database backups are copied. */
  chooseBackupFolder(): Promise<FileHandleRef | null>;
}

/* ------------------------------------------------------------------ */
/* Mail                                                                */
/* ------------------------------------------------------------------ */

export interface AttachmentPayload {
  fileName: string;
  /** Base64 or a data URL. */
  content: string;
  mimeType: string;
}

export interface SendMailRequest {
  accountId: string | null;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments: AttachmentPayload[];
}

export interface SendMailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  /** True when the message was queued rather than sent. */
  queued?: boolean;
  /** Which adapter handled it: "smtp", "mailto", or "download". */
  via: string;
  /** Set when the send failed but the PDF has been saved and is ready to attach. */
  recoverable?: boolean;
}

export interface TestMailResult extends SendMailResult {
  /** Populated when the account is a local Proton Mail Bridge. */
  certificateWarning?: string;
}

export interface MailAdapter {
  readonly name: string;

  /** Whether this adapter can send directly, or only open the user's mail app. */
  readonly canSendDirectly: boolean;

  /** Test an account's credentials without sending anything real. */
  testAccount(args: {
    host: string;
    port: number;
    secure: boolean;
    starttls: boolean;
    username: string;
    password: string;
    fromEmail: string;
    to: string;
    /** A configured fingerprint lets a trusted local Bridge's certificate pass. */
    pinnedFingerprint?: string;
  }): Promise<TestMailResult>;

  send(request: SendMailRequest): Promise<SendMailResult>;

  /**
   * The fallback that always works: save the PDF, put the subject and body on the
   * clipboard and open the user's mail app, so they only have to attach the file.
   */
  openInMailApp(args: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
  }): Promise<SendMailResult>;

  /** True when the user has granted clipboard access in this context. */
  canUseClipboard(): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

export interface SecretAdapter {
  readonly name: string;

  /**
   * Store a secret. On the web this keeps it in memory for the session only and
   * reports false, so the UI can tell the user their password will need typing
   * again after a reload rather than pretending it was saved.
   */
  set(key: string, value: string): Promise<boolean>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /** True when the secret survives an app restart. */
  readonly isPersistent: boolean;
}

/* ------------------------------------------------------------------ */
/* The platform                                                        */
/* ------------------------------------------------------------------ */

/**
 * The AI adapter: one OpenAI-compatible endpoint serves every task, so the
 * interface is one completion call plus a test. Output is JSON validated by
 * the caller's Zod schema; the adapter only speaks HTTP.
 */
export interface AiCompletionRequest {
  /** System prompt for the task. */
  system: string;
  /** The user's prompt, with any context already in it. */
  prompt: string;
  /** Images as base64 (no data-URL prefix), for vision tasks. */
  images?: string[];
  /** The model to use; empty uses the settings' default for the task. */
  model?: string;
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number;
  /** The API key, resolved from the secrets adapter by the caller. */
  apiKey?: string;
}

export interface AiCompletionResult {
  ok: boolean;
  /** The raw text content, for the caller to parse and validate. */
  content: string;
  tokens: number;
  error?: string;
}

export interface AiAdapter {
  readonly name: string;
  complete(request: AiCompletionRequest, baseUrl: string): Promise<AiCompletionResult>;
}

export interface Platform {
  readonly storage: StorageAdapter;
  readonly files: FileAdapter;
  readonly mail: MailAdapter;
  readonly secrets: SecretAdapter;
  /** AI works identically on web and desktop — HTTP is HTTP. */
  readonly ai: AiAdapter;
  /** Human-readable name for the settings screen. */
  readonly name: string;
  /** Capabilities this build has, used to hide features that cannot work. */
  readonly capabilities: {
    fileSystemAccess: boolean;
    directMail: boolean;
    persistentSecrets: boolean;
    print: boolean;
    offline: boolean;
  };
  /** Launch-at-login, desktop only. The web build omits these. */
  autostartEnable?(): Promise<void>;
  autostartDisable?(): Promise<void>;
  autostartIsEnabled?(): Promise<boolean>;
}

let current: Platform | null = null;

/** Install the platform. Called once at start-up by the adapter registry. */
export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error('Duly platform adapters have not been installed yet');
  return current;
}

export function storage(): StorageAdapter {
  return platform().storage;
}
export function files(): FileAdapter {
  return platform().files;
}
export function mail(): MailAdapter {
  return platform().mail;
}
export function secrets(): SecretAdapter {
  return platform().secrets;
}

/** Run an operation and log it to the automation log if it fails. */
export async function withAdapter<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}
