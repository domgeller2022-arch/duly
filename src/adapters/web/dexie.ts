/**
 * Dexie implementation of `StorageAdapter` for the web prototype.
 *
 * IndexedDB is a single local database file per origin. A backup is therefore a
 * JSON snapshot rather than a file copy, which is exactly what the desktop
 * SQLite build needs too — the import path is the same in both, so exporting on
 * the web and re-importing on the desktop is a supported migration.
 *
 * Number reservation is the one place that needs real care. Dexie gives us a
 * transaction, and inside it we read the sequence, increment it and write it
 * back. Two invoices submitted in the same tick are serialised by the
 * transaction, so the second sees the first's increment.
 */

import Dexie, { type Table } from 'dexie';
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
import { DEFAULT_SETTINGS_ID, settingsSchema } from '@/core/schemas/settings';
import {
  attachmentSchema,
  auditLogSchema,
  automationLogSchema,
  bankTransactionSchema,
  businessProfileSchema,
  clientCreditSchema,
  clientSchema,
  contactSchema,
  contentPresetSchema,
  currencyRateSchema,
  customFieldSchema,
  designTemplateSchema,
  documentLineSchema,
  documentSchema,
  emailLogSchema,
  emailTemplateSchema,
  expenseSchema,
  itemSchema,
  lateFeePolicySchema,
  numberSequenceSchema,
  outboxSchema,
  paymentSchema,
  projectSchema,
  recurringScheduleSchema,
  reminderPolicySchema,
  reminderSchema,
  retainerSchema,
  ruleSchema,
  savedViewSchema,
  signatureSchema,
  timeEntrySchema,
} from '@/core/schemas';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { DEFAULT_PATTERNS } from '@/core/schemas/automation';
import { financialYearKey, todayIn } from '@/core/validation/dates';
import { nextCounterValue, periodKeyFor, renderNumber, shouldReset } from '@/core/engines/numbering';
import type { BackupInfo, DataSnapshot, DocumentBundleRecord, QueryOptions, StorageAdapter } from '../types';
import { SCHEMA_VERSION, appVersion } from './version';

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export class DulyDatabase extends Dexie {
  settings!: Table<Settings, string>;
  businessProfiles!: Table<BusinessProfile, string>;
  clients!: Table<Client, string>;
  contacts!: Table<Contact, string>;
  items!: Table<Item, string>;
  taxCodes!: Table<import('@/core/tax/tax').TaxCode, string>;
  currencyRates!: Table<CurrencyRate, string>;
  customFields!: Table<CustomField, string>;
  documents!: Table<Document, string>;
  documentLines!: Table<DocumentLine, string>;
  payments!: Table<Payment, string>;
  designTemplates!: Table<DesignTemplate, string>;
  contentPresets!: Table<ContentPreset, string>;
  emailTemplates!: Table<EmailTemplate, string>;
  emailLogs!: Table<EmailLog, string>;
  emailAccounts!: Table<EmailAccount, string>;
  outbox!: Table<OutboxEntry, string>;
  recurringSchedules!: Table<import('@/core/schemas/automation').RecurringSchedule, string>;
  numberSequences!: Table<NumberSequence, string>;
  rules!: Table<Rule, string>;
  reminderPolicies!: Table<ReminderPolicy, string>;
  lateFeePolicies!: Table<LateFeePolicy, string>;
  reminders!: Table<Reminder, string>;
  attachments!: Table<Attachment, string>;
  auditLog!: Table<AuditLogEntry, string>;
  automationLog!: Table<AutomationLogEntry, string>;
  clientCredits!: Table<ClientCredit, string>;
  signatures!: Table<Signature, string>;
  bankTransactions!: Table<BankTransaction, string>;
  savedViews!: Table<SavedView, string>;
  projects!: Table<Project, string>;
  timeEntries!: Table<TimeEntry, string>;
  expenses!: Table<Expense, string>;
  retainers!: Table<Retainer, string>;
  backups!: Table<BackupInfo, string>;

  constructor(name = 'duly') {
    super(name);

    // v2 — GST registration history.
    //
    // An install from v1 has a `gstRegistered` flag but no record of when it took
    // effect. The upgrade seeds a history from what is already stored, dated at the
    // recorded effective date (or the beginning of time when there was none), so the
    // answer for every existing date is exactly what it was before the upgrade.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<BusinessProfile>('businessProfiles')
          .toCollection()
          .modify((profile) => {
            if (Array.isArray(profile.gstHistory) && profile.gstHistory.length > 0) return;
            profile.gstHistory = [
              {
                registered: Boolean(profile.gstRegistered),
                from: profile.gstRegisteredFrom ?? '0000-01-01',
                note: '',
              },
            ];
          });
      });

    // Every table that is queried by document, client or profile gets an index,
    // because the document list is by far the hottest screen in the app.
    this.version(SCHEMA_VERSION).stores({
      settings: 'id',
      businessProfiles: 'id, archived, name, gstRegistered',
      clients: 'id, displayName, archived, *tags, defaultCurrency',
      contacts: 'id, clientId, isPrimary, field',
      items: 'id, code, name, category, active, *prices',
      taxCodes: 'id, displayOrder, active, type',
      currencyRates: 'id, from, to, effectiveDate',
      customFields: 'id, entity, key, displayOrder',
      documents:
        'id, type, status, clientId, profileId, issueDate, dueDate, number, [profileId+type], updatedAt',
      documentLines: 'id, documentId, position, itemId, taxCodeId, sectionId, type',
      payments: 'id, documentId, date, method, bankTransactionId',
      designTemplates: 'id, name, layout, builtin, updatedAt',
      contentPresets: 'id, name, documentType, builtin',
      emailTemplates: 'id, name, purpose, builtin',
      emailLogs: 'id, documentId, sentAt, status',
      emailAccounts: 'id, provider, enabled',
      outbox: 'id, documentId, status, queuedAt',
      recurringSchedules: 'id, profileId, clientId, paused, nextRunDate, frequency',
      // The compound index is what `reserveDocumentNumber` queries inside its
      // transaction. Declaring only the single-field indexes makes that lookup throw,
      // which is why v3 exists.
      numberSequences: 'id, profileId, documentType, periodKey, [profileId+documentType]',
      rules: 'id, enabled, priority',
      reminderPolicies: 'id, enabled, name',
      lateFeePolicies: 'id, enabled, name',
      reminders: 'id, documentId, status, scheduledFor, dedupeKey',
      attachments: 'id, ownerId, ownerType, mimeType',
      auditLog: 'id, entity, entityId, createdAt',
      automationLog: 'id, category, ranAt, needsAttention',
      clientCredits: 'id, clientId, date, sourceDocumentId',
      signatures: 'id, documentId, signedAt',
      bankTransactions: 'id, date, status, matchedDocumentId, importBatchId',
      savedViews: 'id, entity, displayOrder, hidden',
      projects: 'id, clientId, status, code',
      timeEntries: 'id, clientId, projectId, date, invoicedOnDocumentId, billable',
      expenses: 'id, clientId, projectId, date, category, billable, invoicedOnDocumentId',
      retainers: 'id, clientId, status, renewsOn',
      backups: 'id, createdAt',
    });
  }
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class DexieStorageAdapter implements StorageAdapter {
  readonly name = 'indexeddb';

  private db: DulyDatabase;
  private ready = false;

  constructor(dbName = 'duly') {
    this.db = new DulyDatabase(dbName);
  }

  async init(): Promise<void> {
    if (this.ready) return;
    await this.db.open();
    await this.seed();
    this.ready = true;
  }

  async close(): Promise<void> {
    this.db.close();
    this.ready = false;
  }

  get schemaVersion(): number {
    return SCHEMA_VERSION;
  }

  /** Re-open for tests that need a clean database. */
  reset(dbName: string): void {
    this.db.close();
    this.db = new DulyDatabase(dbName);
    this.ready = false;
  }

  /* ---------------- settings ---------------- */

  async getSettings(): Promise<Settings> {
    const row = await this.db.settings.get(DEFAULT_SETTINGS_ID);
    if (row) return row;
    const fresh = settingsSchema.parse({
      id: DEFAULT_SETTINGS_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.db.settings.put(fresh);
    return fresh;
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.db.settings.put(settingsSchema.parse({ ...settings, updatedAt: new Date().toISOString() }));
  }

  /* ---------------- business profiles ---------------- */

  async listBusinessProfiles(options?: QueryOptions): Promise<BusinessProfile[]> {
    const rows = await this.db.businessProfiles.toArray();
    return applyQuery(
      rows.filter((r) => !options?.includeDeleted || !r.deletedAt),
      options,
    );
  }

  getBusinessProfile(id: string): Promise<BusinessProfile | undefined> {
    return this.db.businessProfiles.get(id);
  }

  async saveBusinessProfile(profile: BusinessProfile): Promise<void> {
    await this.db.businessProfiles.put(
      businessProfileSchema.parse({ ...profile, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteBusinessProfile(id: string): Promise<void> {
    await this.db.businessProfiles.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- clients ---------------- */

  async listClients(options?: QueryOptions): Promise<Client[]> {
    const rows = await this.db.clients.toArray();
    return applyQuery(rows, options);
  }

  getClient(id: string): Promise<Client | undefined> {
    return this.db.clients.get(id);
  }

  async saveClient(client: Client): Promise<void> {
    await this.db.clients.put(clientSchema.parse({ ...client, updatedAt: new Date().toISOString() }));
  }

  async deleteClient(id: string): Promise<void> {
    await this.db.clients.update(id, { deletedAt: new Date().toISOString() });
  }

  async listContacts(clientId?: string): Promise<Contact[]> {
    const rows = clientId
      ? await this.db.contacts.where('clientId').equals(clientId).toArray()
      : await this.db.contacts.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveContact(contact: Contact): Promise<void> {
    await this.db.contacts.put(contactSchema.parse({ ...contact, updatedAt: new Date().toISOString() }));
  }

  async deleteContact(id: string): Promise<void> {
    await this.db.contacts.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- items ---------------- */

  async listItems(
    options?: QueryOptions & { search?: string; activeOnly?: boolean; category?: string },
  ): Promise<Item[]> {
    let rows = await this.db.items.toArray();
    if (!options?.includeDeleted) rows = rows.filter((r) => !r.deletedAt);
    if (options?.activeOnly) rows = rows.filter((r) => r.active);
    if (options?.category) rows = rows.filter((r) => r.category === options.category);
    if (options?.search) {
      const q = options.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }
    return applyQuery(rows, options);
  }

  getItem(id: string): Promise<Item | undefined> {
    return this.db.items.get(id);
  }

  async saveItem(item: Item): Promise<void> {
    await this.db.items.put(itemSchema.parse({ ...item, updatedAt: new Date().toISOString() }));
  }

  async saveItems(items: Item[]): Promise<void> {
    await this.db.items.bulkPut(
      items.map((i) => itemSchema.parse({ ...i, updatedAt: new Date().toISOString() })),
    );
  }

  /** One transaction for the whole batch, because a CSV import is not row-at-a-time. */
  async saveClients(clients: Client[]): Promise<void> {
    await this.db.clients.bulkPut(
      clients.map((c) => clientSchema.parse({ ...c, updatedAt: new Date().toISOString() })),
    );
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.items.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- tax codes and rates ---------------- */

  async listTaxCodes(): Promise<import('@/core/tax/tax').TaxCode[]> {
    const rows = await this.db.taxCodes.toArray();
    return rows.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async saveTaxCode(code: import('@/core/tax/tax').TaxCode): Promise<void> {
    await this.db.taxCodes.put(code);
  }

  async deleteTaxCode(id: string): Promise<void> {
    await this.db.taxCodes.update(id, { active: false });
  }

  async listCurrencyRates(from?: string): Promise<CurrencyRate[]> {
    const rows = from
      ? await this.db.currencyRates.where('from').equals(from).toArray()
      : await this.db.currencyRates.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  async saveCurrencyRate(rate: CurrencyRate): Promise<void> {
    await this.db.currencyRates.put(
      currencyRateSchema.parse({ ...rate, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteCurrencyRate(id: string): Promise<void> {
    await this.db.currencyRates.delete(id);
  }

  /* ---------------- documents ---------------- */

  async listDocuments(
    options?: QueryOptions & { type?: string; status?: string; clientId?: string; profileId?: string },
  ): Promise<Document[]> {
    let rows = await this.db.documents.toArray();
    if (!options?.includeDeleted) rows = rows.filter((r) => !r.deletedAt);
    if (options?.type) rows = rows.filter((r) => r.type === options.type);
    if (options?.status) rows = rows.filter((r) => r.status === options.status);
    if (options?.clientId) rows = rows.filter((r) => r.clientId === options.clientId);
    if (options?.profileId) rows = rows.filter((r) => r.profileId === options.profileId);
    rows.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt));
    return applyQuery(rows, options);
  }

  getDocument(id: string): Promise<Document | undefined> {
    return this.db.documents.get(id);
  }

  async getDocumentBundle(id: string): Promise<DocumentBundleRecord | undefined> {
    const document = await this.db.documents.get(id);
    if (!document) return undefined;
    const [lines, payments] = await Promise.all([this.listDocumentLines(id), this.listPayments(id)]);
    return { document, lines, payments };
  }

  async listDocumentLines(documentId: string): Promise<DocumentLine[]> {
    const rows = await this.db.documentLines.where('documentId').equals(documentId).toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  async saveDocument(document: Document, lines?: DocumentLine[]): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.documentLines, async () => {
      await this.db.documents.put(
        documentSchema.parse({
          ...document,
          updatedAt: new Date().toISOString(),
          revision: document.revision + 1,
        }),
      );
      if (lines) {
        // Replace the whole set. The editor always holds every line, so a full
        // write is simpler than diffing and cannot leave a phantom line behind.
        await this.db.documentLines.where('documentId').equals(document.id).delete();
        if (lines.length > 0) {
          await this.db.documentLines.bulkPut(
            lines.map((l) => documentLineSchema.parse({ ...l, documentId: document.id })),
          );
        }
      }
    });
  }

  async saveDocumentLine(line: DocumentLine): Promise<void> {
    await this.db.documentLines.put(documentLineSchema.parse(line));
  }

  async saveDocumentLines(lines: DocumentLine[]): Promise<void> {
    if (lines.length > 0) await this.db.documentLines.bulkPut(lines.map((l) => documentLineSchema.parse(l)));
  }

  async deleteDocumentLine(id: string): Promise<void> {
    await this.db.documentLines.update(id, { deletedAt: new Date().toISOString() });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.documentLines, this.db.payments, async () => {
      await this.db.documents.update(id, { deletedAt: new Date().toISOString() });
      await this.db.documentLines
        .where('documentId')
        .equals(id)
        .modify({ deletedAt: new Date().toISOString() });
    });
  }

  /**
   * Reserve the next document number.
   *
   * The read, increment and write all happen inside one Dexie transaction, so
   * two concurrent submissions are serialised: the second one reads the value
   * the first one wrote. The issued number is also appended to `issued`, which
   * makes reuse impossible even if a reset rule ever rolls the counter back.
   */
  async reserveDocumentNumber(args: {
    profileId: string;
    documentType: string;
    date: string;
    pattern?: string;
    clientCode?: string;
    profileCode?: string;
  }): Promise<{ number: string; sequence: NumberSequence }> {
    return this.db.transaction('rw', this.db.numberSequences, async () => {
      const existing = await this.db.numberSequences
        .where('[profileId+documentType]')
        .equals([args.profileId, args.documentType])
        .first();

      const now = new Date().toISOString();
      const sequence: NumberSequence = existing
        ? { ...existing, updatedAt: now }
        : {
            id: `seq_${args.profileId}_${args.documentType}`,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            profileId: args.profileId,
            documentType: args.documentType as NumberSequence['documentType'],
            pattern: args.pattern ?? DEFAULT_PATTERNS[args.documentType] ?? 'INV-{YYYY}-{####}',
            nextValue: 1,
            resetRule: 'yearly',
            periodKey: periodKeyFor(args.date, 'yearly'),
            issued: [],
            startAt: 1,
          };

      if (args.pattern) sequence.pattern = args.pattern;

      const reset = shouldReset(sequence, args.date);
      const value = nextCounterValue(sequence, reset);
      const number = renderNumber(sequence.pattern, {
        value,
        date: args.date,
        documentType: sequence.documentType,
        clientCode: args.clientCode,
        profileCode: args.profileCode,
      });

      sequence.nextValue = value + 1;
      sequence.periodKey = periodKeyFor(args.date, sequence.resetRule);
      sequence.issued = [...sequence.issued, number];

      await this.db.numberSequences.put(sequence);
      return { number, sequence };
    });
  }

  /* ---------------- payments ---------------- */

  async listPayments(documentId?: string): Promise<Payment[]> {
    const rows = documentId
      ? await this.db.payments.where('documentId').equals(documentId).toArray()
      : await this.db.payments.toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }

  async savePayment(payment: Payment): Promise<void> {
    await this.db.payments.put(paymentSchema.parse({ ...payment, updatedAt: new Date().toISOString() }));
  }

  async deletePayment(id: string): Promise<void> {
    await this.db.payments.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- templates ---------------- */

  async listDesignTemplates(): Promise<DesignTemplate[]> {
    const rows = await this.db.designTemplates.toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
  }

  getDesignTemplate(id: string): Promise<DesignTemplate | undefined> {
    return this.db.designTemplates.get(id);
  }

  async saveDesignTemplate(template: DesignTemplate): Promise<void> {
    await this.db.designTemplates.put(
      designTemplateSchema.parse({ ...template, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteDesignTemplate(id: string): Promise<void> {
    await this.db.designTemplates.update(id, { deletedAt: new Date().toISOString() });
  }

  async listContentPresets(): Promise<ContentPreset[]> {
    const rows = await this.db.contentPresets.toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
  }

  async saveContentPreset(preset: ContentPreset): Promise<void> {
    await this.db.contentPresets.put(
      contentPresetSchema.parse({ ...preset, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteContentPreset(id: string): Promise<void> {
    await this.db.contentPresets.update(id, { deletedAt: new Date().toISOString() });
  }

  async listEmailTemplates(): Promise<EmailTemplate[]> {
    const rows = await this.db.emailTemplates.toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name));
  }

  async saveEmailTemplate(template: EmailTemplate): Promise<void> {
    await this.db.emailTemplates.put(
      emailTemplateSchema.parse({ ...template, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteEmailTemplate(id: string): Promise<void> {
    await this.db.emailTemplates.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- email accounts and logs ---------------- */

  async listEmailAccounts(): Promise<EmailAccount[]> {
    const rows = await this.db.emailAccounts.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  getEmailAccount(id: string): Promise<EmailAccount | undefined> {
    return this.db.emailAccounts.get(id);
  }

  async saveEmailAccount(account: EmailAccount): Promise<void> {
    await this.db.emailAccounts.put({ ...account, updatedAt: new Date().toISOString() });
  }

  async deleteEmailAccount(id: string): Promise<void> {
    await this.db.emailAccounts.update(id, { deletedAt: new Date().toISOString() });
  }

  async listEmailLogs(documentId?: string): Promise<EmailLog[]> {
    const rows = documentId
      ? await this.db.emailLogs.where('documentId').equals(documentId).toArray()
      : await this.db.emailLogs.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  }

  async saveEmailLog(log: EmailLog): Promise<void> {
    await this.db.emailLogs.put(emailLogSchema.parse(log));
  }

  async listOutbox(): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async saveOutbox(entry: OutboxEntry): Promise<void> {
    await this.db.outbox.put(outboxSchema.parse(entry));
  }

  async deleteOutbox(id: string): Promise<void> {
    await this.db.outbox.delete(id);
  }

  /* ---------------- automation ---------------- */

  async listRecurringSchedules(): Promise<import('@/core/schemas/automation').RecurringSchedule[]> {
    const rows = await this.db.recurringSchedules.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  }

  getRecurringSchedule(
    id: string,
  ): Promise<import('@/core/schemas/automation').RecurringSchedule | undefined> {
    return this.db.recurringSchedules.get(id);
  }

  async saveRecurringSchedule(
    schedule: import('@/core/schemas/automation').RecurringSchedule,
  ): Promise<void> {
    await this.db.recurringSchedules.put(
      recurringScheduleSchema.parse({ ...schedule, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteRecurringSchedule(id: string): Promise<void> {
    await this.db.recurringSchedules.update(id, { deletedAt: new Date().toISOString() });
  }

  async listNumberSequences(profileId?: string): Promise<NumberSequence[]> {
    const rows = profileId
      ? await this.db.numberSequences.where('profileId').equals(profileId).toArray()
      : await this.db.numberSequences.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveNumberSequence(sequence: NumberSequence): Promise<void> {
    await this.db.numberSequences.put(
      numberSequenceSchema.parse({ ...sequence, updatedAt: new Date().toISOString() }),
    );
  }

  async listRules(): Promise<Rule[]> {
    const rows = await this.db.rules.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => a.priority - b.priority);
  }

  async saveRule(rule: Rule): Promise<void> {
    await this.db.rules.put(ruleSchema.parse({ ...rule, updatedAt: new Date().toISOString() }));
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.rules.delete(id);
  }

  async listReminderPolicies(): Promise<ReminderPolicy[]> {
    const rows = await this.db.reminderPolicies.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveReminderPolicy(policy: ReminderPolicy): Promise<void> {
    await this.db.reminderPolicies.put(
      reminderPolicySchema.parse({ ...policy, updatedAt: new Date().toISOString() }),
    );
  }

  async listLateFeePolicies(): Promise<LateFeePolicy[]> {
    const rows = await this.db.lateFeePolicies.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveLateFeePolicy(policy: LateFeePolicy): Promise<void> {
    await this.db.lateFeePolicies.put(
      lateFeePolicySchema.parse({ ...policy, updatedAt: new Date().toISOString() }),
    );
  }

  async listReminders(status?: string): Promise<Reminder[]> {
    const rows = status
      ? await this.db.reminders.where('status').equals(status).toArray()
      : await this.db.reminders.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  async saveReminder(reminder: Reminder): Promise<void> {
    await this.db.reminders.put(reminderSchema.parse({ ...reminder, updatedAt: new Date().toISOString() }));
  }

  async deleteReminder(id: string): Promise<void> {
    await this.db.reminders.delete(id);
  }

  async listAutomationLog(limit = 200): Promise<AutomationLogEntry[]> {
    const rows = await this.db.automationLog.toArray();
    const sorted = rows.filter((r) => !r.deletedAt).sort((a, b) => b.ranAt.localeCompare(a.ranAt));
    return sorted.slice(0, limit);
  }

  async saveAutomationLog(entry: import('@/core/schemas/automation').AutomationLogInput): Promise<void> {
    await this.db.automationLog.put(automationLogSchema.parse(entry));
  }

  async clearAutomationLog(): Promise<void> {
    await this.db.automationLog.clear();
  }

  /* ---------------- business modules ---------------- */

  async listProjects(): Promise<Project[]> {
    const rows = await this.db.projects.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveProject(project: Project): Promise<void> {
    await this.db.projects.put(projectSchema.parse({ ...project, updatedAt: new Date().toISOString() }));
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.projects.update(id, { deletedAt: new Date().toISOString() });
  }

  async listTimeEntries(options?: { clientId?: string; uninvoicedOnly?: boolean }): Promise<TimeEntry[]> {
    let rows = options?.clientId
      ? await this.db.timeEntries.where('clientId').equals(options.clientId).toArray()
      : await this.db.timeEntries.toArray();
    rows = rows.filter((r) => !r.deletedAt);
    if (options?.uninvoicedOnly) rows = rows.filter((r) => !r.invoicedOnDocumentId);
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  async saveTimeEntry(entry: TimeEntry): Promise<void> {
    await this.db.timeEntries.put(timeEntrySchema.parse({ ...entry, updatedAt: new Date().toISOString() }));
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.db.timeEntries.update(id, { deletedAt: new Date().toISOString() });
  }

  async listExpenses(options?: { clientId?: string; uninvoicedOnly?: boolean }): Promise<Expense[]> {
    let rows = options?.clientId
      ? await this.db.expenses.where('clientId').equals(options.clientId).toArray()
      : await this.db.expenses.toArray();
    rows = rows.filter((r) => !r.deletedAt);
    if (options?.uninvoicedOnly) rows = rows.filter((r) => !r.invoicedOnDocumentId);
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  async saveExpense(expense: Expense): Promise<void> {
    await this.db.expenses.put(expenseSchema.parse({ ...expense, updatedAt: new Date().toISOString() }));
  }

  async deleteExpense(id: string): Promise<void> {
    await this.db.expenses.update(id, { deletedAt: new Date().toISOString() });
  }

  async listRetainers(): Promise<Retainer[]> {
    const rows = await this.db.retainers.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveRetainer(retainer: Retainer): Promise<void> {
    await this.db.retainers.put(retainerSchema.parse({ ...retainer, updatedAt: new Date().toISOString() }));
  }

  async deleteRetainer(id: string): Promise<void> {
    await this.db.retainers.update(id, { deletedAt: new Date().toISOString() });
  }

  /* ---------------- supporting records ---------------- */

  async listAttachments(ownerId?: string): Promise<Attachment[]> {
    const rows = ownerId
      ? await this.db.attachments.where('ownerId').equals(ownerId).toArray()
      : await this.db.attachments.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveAttachment(attachment: Attachment): Promise<void> {
    await this.db.attachments.put(
      attachmentSchema.parse({ ...attachment, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.attachments.delete(id);
  }

  async listCustomFields(entity?: string): Promise<CustomField[]> {
    const rows = entity
      ? await this.db.customFields.where('entity').equals(entity).toArray()
      : await this.db.customFields.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async saveCustomField(field: CustomField): Promise<void> {
    await this.db.customFields.put(
      customFieldSchema.parse({ ...field, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteCustomField(id: string): Promise<void> {
    await this.db.customFields.delete(id);
  }

  async listSavedViews(entity?: string): Promise<SavedView[]> {
    const rows = entity
      ? await this.db.savedViews.where('entity').equals(entity).toArray()
      : await this.db.savedViews.toArray();
    return rows.filter((r) => !r.deletedAt && !r.hidden).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async saveSavedView(view: SavedView): Promise<void> {
    await this.db.savedViews.put(savedViewSchema.parse({ ...view, updatedAt: new Date().toISOString() }));
  }

  async deleteSavedView(id: string): Promise<void> {
    await this.db.savedViews.delete(id);
  }

  async listClientCredits(clientId?: string): Promise<ClientCredit[]> {
    const rows = clientId
      ? await this.db.clientCredits.where('clientId').equals(clientId).toArray()
      : await this.db.clientCredits.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  }

  async saveClientCredit(credit: ClientCredit): Promise<void> {
    await this.db.clientCredits.put(
      clientCreditSchema.parse({ ...credit, updatedAt: new Date().toISOString() }),
    );
  }

  async deleteClientCredit(id: string): Promise<void> {
    await this.db.clientCredits.delete(id);
  }

  async listSignatures(documentId?: string): Promise<Signature[]> {
    const rows = documentId
      ? await this.db.signatures.where('documentId').equals(documentId).toArray()
      : await this.db.signatures.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async saveSignature(signature: Signature): Promise<void> {
    await this.db.signatures.put(
      signatureSchema.parse({ ...signature, updatedAt: new Date().toISOString() }),
    );
  }

  async listBankTransactions(status?: string): Promise<BankTransaction[]> {
    const rows = status
      ? await this.db.bankTransactions.where('status').equals(status).toArray()
      : await this.db.bankTransactions.toArray();
    return rows.filter((r) => !r.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  }

  async saveBankTransaction(transaction: BankTransaction): Promise<void> {
    await this.db.bankTransactions.put(
      bankTransactionSchema.parse({ ...transaction, updatedAt: new Date().toISOString() }),
    );
  }

  async saveBankTransactions(transactions: BankTransaction[]): Promise<void> {
    await this.db.bankTransactions.bulkPut(
      transactions.map((t) => bankTransactionSchema.parse({ ...t, updatedAt: new Date().toISOString() })),
    );
  }

  async deleteBankTransaction(id: string): Promise<void> {
    await this.db.bankTransactions.delete(id);
  }

  async listAuditLog(limit = 500): Promise<AuditLogEntry[]> {
    const rows = await this.db.auditLog.toArray();
    return rows
      .filter((r) => !r.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async saveAuditLog(entry: import('@/core/schemas/crm').AuditLogInput): Promise<void> {
    await this.db.auditLog.put(auditLogSchema.parse(entry));
  }

  /* ---------------- whole database ---------------- */

  async exportSnapshot(): Promise<DataSnapshot> {
    const tableNames = [
      'settings',
      'businessProfiles',
      'clients',
      'contacts',
      'items',
      'taxCodes',
      'currencyRates',
      'customFields',
      'documents',
      'documentLines',
      'payments',
      'designTemplates',
      'contentPresets',
      'emailTemplates',
      'emailLogs',
      'outbox',
      'recurringSchedules',
      'numberSequences',
      'rules',
      'reminderPolicies',
      'lateFeePolicies',
      'reminders',
      'attachments',
      'auditLog',
      'automationLog',
      'clientCredits',
      'signatures',
      'bankTransactions',
      'savedViews',
      'projects',
      'timeEntries',
      'expenses',
      'retainers',
    ] as const;

    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: appVersion(),
    } as Record<string, unknown>;

    for (const name of tableNames) {
      snapshot[name] = await (this.db as unknown as Record<string, Table>)[name].toArray();
    }

    // Email accounts are exported without their keychain reference: a JSON
    // backup that carried a pointer to a machine-local secret would be useless
    // elsewhere and could leak the fact that a secret exists.
    snapshot.emailAccounts = (await this.db.emailAccounts.toArray()).map((a) => ({
      ...a,
      secretRef: '',
      pinnedCertificateFingerprint: a.pinnedCertificateFingerprint,
    }));

    return snapshot as unknown as DataSnapshot;
  }

  async importSnapshot(
    snapshot: DataSnapshot,
    mode: 'replace' | 'merge',
  ): Promise<{ imported: number; skipped: number }> {
    // A pre-import backup, so a bad import can never be the end of the data.
    if (mode === 'replace') {
      await this.createBackup(`before-import-${Date.now()}`);
    }

    const tableNames = Object.keys(snapshot).filter(
      (k) => !['schemaVersion', 'exportedAt', 'appVersion', 'emailAccounts'].includes(k),
    ) as (keyof DataSnapshot)[];

    let imported = 0;
    let skipped = 0;

    await this.db.transaction(
      'rw',
      [
        this.db.settings,
        this.db.businessProfiles,
        this.db.clients,
        this.db.contacts,
        this.db.items,
        this.db.taxCodes,
        this.db.currencyRates,
        this.db.customFields,
        this.db.documents,
        this.db.documentLines,
        this.db.payments,
        this.db.designTemplates,
        this.db.contentPresets,
        this.db.emailTemplates,
        this.db.emailLogs,
        this.db.outbox,
        this.db.recurringSchedules,
        this.db.numberSequences,
        this.db.rules,
        this.db.reminderPolicies,
        this.db.lateFeePolicies,
        this.db.reminders,
        this.db.attachments,
        this.db.auditLog,
        this.db.automationLog,
        this.db.clientCredits,
        this.db.signatures,
        this.db.bankTransactions,
        this.db.savedViews,
        this.db.projects,
        this.db.timeEntries,
        this.db.expenses,
        this.db.retainers,
        this.db.emailAccounts,
      ],
      async () => {
        for (const name of tableNames) {
          const rows = (snapshot[name] as unknown[]) ?? [];
          if (rows.length === 0) continue;
          const table = (this.db as unknown as Record<string, Table>)[name as string];
          if (mode === 'replace') await table.clear();
          for (const row of rows) {
            const record = row as { id?: string };
            if (!record?.id) {
              skipped += 1;
              continue;
            }
            await table.put(row);
            imported += 1;
          }
        }

        if (snapshot.emailAccounts?.length) {
          const existing = await this.db.emailAccounts.toArray();
          const byId = new Map(existing.map((a) => [a.id, a]));
          for (const account of snapshot.emailAccounts) {
            // Keep the local keychain reference if this machine already has one.
            const local = byId.get(account.id);
            await this.db.emailAccounts.put({ ...account, secretRef: local?.secretRef ?? '' });
            imported += 1;
          }
        }
      },
    );

    return { imported, skipped };
  }

  async createBackup(name: string): Promise<BackupInfo> {
    const snapshot = await this.exportSnapshot();
    const json = JSON.stringify(snapshot);
    const id = `backup_${Date.now()}`;
    const info: BackupInfo = {
      id,
      name,
      createdAt: new Date().toISOString(),
      sizeBytes: new Blob([json]).size,
      schemaVersion: SCHEMA_VERSION,
    };
    await this.db.backups.put({ ...info, payload: json } as BackupInfo & { payload: string });
    await this.pruneBackups();
    return info;
  }

  async listBackups(): Promise<BackupInfo[]> {
    const rows = await this.db.backups.toArray();
    return rows
      .map(({ id, name, createdAt, sizeBytes, schemaVersion }) => ({
        id,
        name,
        createdAt,
        sizeBytes,
        schemaVersion,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restoreBackup(id: string): Promise<void> {
    const row = await this.db.backups.get(id);
    if (!row) throw new Error('That backup could not be found');
    const payload = (row as BackupInfo & { payload?: string }).payload;
    if (!payload) throw new Error('That backup has no data attached');
    await this.importSnapshot(JSON.parse(payload) as DataSnapshot, 'replace');
  }

  async deleteBackup(id: string): Promise<void> {
    await this.db.backups.delete(id);
  }

  async estimateSize(): Promise<number> {
    if (!navigator.storage?.estimate) return 0;
    const { usage } = await navigator.storage.estimate();
    return usage ?? 0;
  }

  async clear(): Promise<void> {
    await this.db.delete();
    this.db = new DulyDatabase(this.db.name);
    await this.init();
  }

  /* ---------------- seeding ---------------- */

  /**
   * Insert the reference data a new install needs: tax codes and nothing else.
   *
   * Design templates, email templates and rules are seeded by the app's bootstrap
   * rather than here, because they carry ids the rest of the app references.
   * Tax codes are different — they are referenced by id from every document
   * default, so they must exist before anything else can be created.
   */
  private async seed(): Promise<void> {
    const count = await this.db.taxCodes.count();
    if (count === 0) {
      await this.db.taxCodes.bulkPut(DEFAULT_TAX_CODES.map((c) => ({ ...c })));
    }
    const settingsCount = await this.db.settings.count();
    if (settingsCount === 0) {
      const now = new Date().toISOString();
      await this.db.settings.put(
        settingsSchema.parse({
          id: DEFAULT_SETTINGS_ID,
          createdAt: now,
          updatedAt: now,
          lastBackupAt: null,
          backupFolderHandle: null,
        }),
      );
    }
  }

  /** Keep only the newest `keep` backups. */
  private async pruneBackups(): Promise<void> {
    const settings = await this.getSettings();
    const rows = (await this.db.backups.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const keep = Math.max(1, settings.backupKeep);
    for (const row of rows.slice(keep)) await this.db.backups.delete(row.id);
  }

  /** Today in the app's time zone, for date-sensitive defaults. */
  today(): string {
    return todayIn('Australia/Sydney');
  }

  /** The current Australian financial year, for numbering previews. */
  currentFinancialYear(): string {
    return financialYearKey(this.today());
  }
}

function applyQuery<T>(rows: T[], options?: { limit?: number; offset?: number }): T[] {
  let out = rows;
  if (options?.offset) out = out.slice(options.offset);
  if (options?.limit !== undefined) out = out.slice(0, options.limit);
  return out;
}
