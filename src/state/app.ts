/**
 * Application state.
 *
 * One Zustand store holds everything the shell needs — the loaded records, the
 * active business, settings, and the flags that drive the shell. Feature-level
 * edit state lives in the editor's own store so that typing in the line grid does
 * not re-render the dashboard.
 *
 * Records are loaded once at start-up and mutated through the store's actions,
 * which write to the platform storage and then update in memory. That ordering
 * matters: the database is the truth, and the store only mirrors it after a
 * successful write.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Attachment,
  BusinessProfile,
  Client,
  ContentPreset,
  Contact,
  CurrencyRate,
  CustomField,
  DesignTemplate,
  Document,
  EmailAccount,
  EmailTemplate,
  OutboxEntry,
  Expense,
  Item,
  NumberSequence,
  Payment,
  Project,
  Reminder,
  Retainer,
  SavedView,
  Settings,
  TimeEntry,
} from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';
import type { AutomationLogEntry, RecurringSchedule } from '@/core/schemas/automation';
import type { Rule } from '@/core/schemas';
import { createWebPlatform, platform, storage } from '@/adapters';
import { createDesktopPlatform, isTauri } from '@/adapters/desktop';
import { setPlatform } from '@/adapters/types';
import { todayIn } from '@/core/validation/dates';
import {
  builtinContentPresets,
  builtinDesignTemplates,
  builtinEmailTemplates,
  builtinLateFeePolicies,
  builtinReminderPolicies,
  builtinRulesAt,
  builtinSavedViews,
  indicativeRates,
  starterItems,
} from '@/adapters/web/seed';

export interface AppState {
  /* ---- lifecycle ---- */
  ready: boolean;
  bootError: string | null;
  today: string;

  /* ---- settings ---- */
  settings: Settings | null;

  /* ---- reference data ---- */
  profiles: BusinessProfile[];
  activeProfileId: string | null;
  clients: Client[];
  contacts: Contact[];
  items: Item[];
  taxCodes: TaxCode[];
  currencyRates: CurrencyRate[];
  designTemplates: DesignTemplate[];
  contentPresets: ContentPreset[];
  emailTemplates: EmailTemplate[];
  numberSequences: NumberSequence[];

  /* ---- documents ---- */
  documents: Document[];
  /** Every payment, so a client's history needs no second query. */
  payments: Payment[];
  reminders: Reminder[];
  recurringSchedules: RecurringSchedule[];
  automationLog: AutomationLogEntry[];
  rules: Rule[];
  outbox: OutboxEntry[];
  projects: Project[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  retainers: Retainer[];
  attachments: Attachment[];
  savedViews: SavedView[];
  customFields: CustomField[];

  /* ---- capabilities ---- */
  capabilities: ReturnType<typeof getCapabilities>;

  /* ---- actions ---- */
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  saveProfile: (profile: BusinessProfile) => Promise<void>;
  saveClient: (client: Client) => Promise<void>;
  saveDesignTemplate: (template: DesignTemplate) => Promise<void>;
  removeDesignTemplate: (id: string) => Promise<void>;
  removeClient: (id: string) => Promise<void>;
  saveContact: (contact: Contact) => Promise<void>;
  saveItem: (item: Item) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  saveTaxCode: (code: TaxCode) => Promise<void>;
  removeTaxCode: (id: string) => Promise<void>;
  saveCurrencyRate: (rate: CurrencyRate) => Promise<void>;
  removeCurrencyRate: (id: string) => Promise<void>;
  saveCustomField: (field: CustomField) => Promise<void>;
  saveContentPreset: (preset: ContentPreset) => Promise<void>;
  removeCustomField: (id: string) => Promise<void>;
  saveNumberSequence: (sequence: NumberSequence) => Promise<void>;
  emailAccounts: EmailAccount[];
  saveEmailAccount: (account: EmailAccount) => Promise<void>;
  removeEmailAccount: (id: string) => Promise<void>;
  saveEmailTemplate: (template: EmailTemplate) => Promise<void>;
  removeEmailTemplate: (id: string) => Promise<void>;
  saveRecurringSchedule: (schedule: RecurringSchedule) => Promise<void>;
  removeRecurringSchedule: (id: string) => Promise<void>;
  saveRule: (rule: Rule) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  saveReminder: (reminder: Reminder) => Promise<void>;
  saveOutboxEntry: (entry: OutboxEntry) => Promise<void>;
  saveProject: (project: Project) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  saveTimeEntry: (entry: TimeEntry) => Promise<void>;
  removeTimeEntry: (id: string) => Promise<void>;
  saveExpense: (expense: Expense) => Promise<void>;
  removeExpense: (id: string) => Promise<void>;
  saveRetainer: (retainer: Retainer) => Promise<void>;
  removeRetainer: (id: string) => Promise<void>;
  saveDocument: (document: Document) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  setToday: (today: string) => void;
}

function getCapabilities() {
  const p = isTauri() ? createDesktopPlatform() : createWebPlatform();
  return p.capabilities;
}

let installed = false;

/** Install the platform adapters once. Called before React renders. */
export function installPlatform(): void {
  if (installed) return;
  setPlatform(isTauri() ? createDesktopPlatform() : createWebPlatform());
  installed = true;

  // Desktop: the output folder the user chose is a path, and permissions are
  // implicit — restoring it on boot is what makes every write after a
  // restart silent instead of throwing "Choose an output folder first".
  if (isTauri()) {
    void (async () => {
      try {
        const settings = await storage().getSettings();
        if (settings?.outputFolderHandle) {
          await platform().files.restoreFolder({ token: settings.outputFolderHandle, name: settings.outputFolderName });
        }
        // The backup folder is restored the same way, so daily backups keep
        // writing to their own folder after a restart.
        if (settings?.backupFolderHandle) {
          await platform().files.restoreBackupFolder({
            token: settings.backupFolderHandle,
            name: settings.backupFolderName,
          });
        }
      } catch {
        // A failed restore is not fatal: the next write re-asks via
        // requestPermission, which re-opens the picker.
      }
    })();
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  today: todayIn('Australia/Sydney'),
  settings: null,
  profiles: [],
  activeProfileId: null,
  clients: [],
  contacts: [],
  items: [],
  taxCodes: [],
  currencyRates: [],
  designTemplates: [],
  contentPresets: [],
  emailTemplates: [],
  numberSequences: [],
  emailAccounts: [],
  documents: [],
  payments: [],
  reminders: [],
  recurringSchedules: [],
  automationLog: [],
  rules: [],
  outbox: [],
  projects: [],
  timeEntries: [],
  expenses: [],
  retainers: [],
  attachments: [],
  savedViews: [],
  customFields: [],
  capabilities: getCapabilities(),

  async boot() {
    installPlatform();
    const db = storage();
    try {
      await db.init();
      await seedReferenceData();
      const settings = await db.getSettings();
      const profiles = await db.listBusinessProfiles();

      set({
        settings,
        profiles,
        activeProfileId:
          settings.activeProfileId && profiles.some((p: BusinessProfile) => p.id === settings.activeProfileId)
            ? settings.activeProfileId
            : (profiles[0]?.id ?? null),
        today: todayIn(settings.timeZone),
      });

      await get().refresh();
      set({ ready: true, bootError: null });
    } catch (error) {
      set({
        bootError: error instanceof Error ? error.message : 'Duly could not start up',
        ready: true,
      });
    }
  },

  async refresh() {
    const db = storage();
    const [
      taxCodes,
      clients,
      contacts,
      items,
      currencyRates,
      designTemplates,
      contentPresets,
      emailTemplates,
      documents,
      recurringSchedules,
      reminders,
      automationLog,
      attachments,
      savedViews,
      customFields,
      profiles,
      numberSequences,
      emailAccounts,
      payments,
      rules,
      outbox,
      projects,
      timeEntries,
      expenses,
      retainers,
    ] = await Promise.all([
      db.listTaxCodes(),
      db.listClients(),
      db.listContacts(),
      db.listItems({ activeOnly: false }),
      db.listCurrencyRates(),
      db.listDesignTemplates(),
      db.listContentPresets(),
      db.listEmailTemplates(),
      db.listDocuments(),
      db.listRecurringSchedules(),
      db.listReminders(),
      db.listAutomationLog(200),
      db.listAttachments(),
      db.listSavedViews('document'),
      db.listCustomFields(),
      db.listBusinessProfiles(),
      db.listNumberSequences(),
      db.listEmailAccounts(),
      db.listPayments(),
      db.listRules(),
      db.listOutbox(),
      db.listProjects(),
      db.listTimeEntries(),
      db.listExpenses(),
      db.listRetainers(),
    ]);

    set({
      taxCodes,
      clients,
      contacts,
      items,
      currencyRates,
      designTemplates,
      contentPresets,
      emailTemplates,
      documents,
      recurringSchedules,
      reminders,
      automationLog,
      attachments,
      savedViews,
      customFields,
      profiles,
      numberSequences,
      emailAccounts,
      payments,
      rules,
      outbox,
      projects,
      timeEntries,
      expenses,
      retainers,
      today: todayIn(get().settings?.timeZone ?? 'Australia/Sydney'),
    });
  },

  async refreshDocuments() {
    const [documents, reminders, payments] = await Promise.all([
      storage().listDocuments(),
      storage().listReminders(),
      storage().listPayments(),
    ]);
    set({ documents, reminders, payments });
  },

  async setActiveProfile(id) {
    const settings = get().settings;
    if (!settings) return;
    const next = { ...settings, activeProfileId: id };
    await storage().saveSettings(next);
    set({ settings: next, activeProfileId: id });
  },

  async saveSettings(settings) {
    await storage().saveSettings(settings);
    set({ settings, today: todayIn(settings.timeZone) });
  },

  async saveProfile(profile) {
    await storage().saveBusinessProfile(profile);
    const profiles = await storage().listBusinessProfiles();
    set({ profiles });
  },

  async saveClient(client) {
    await storage().saveClient(client);
    set({ clients: await storage().listClients(), contacts: await storage().listContacts() });
  },

  async saveDesignTemplate(template) {
    await storage().saveDesignTemplate(template);
    set({ designTemplates: await storage().listDesignTemplates() });
  },

  async removeDesignTemplate(id) {
    await storage().deleteDesignTemplate(id);
    set({ designTemplates: await storage().listDesignTemplates() });
  },

  async removeClient(id) {
    await storage().deleteClient(id);
    set({ clients: await storage().listClients() });
  },

  async saveContact(contact) {
    await storage().saveContact(contact);
    set({ contacts: await storage().listContacts() });
  },

  async saveItem(item) {
    await storage().saveItem(item);
    set({ items: await storage().listItems({ activeOnly: false }) });
  },

  async removeItem(id) {
    await storage().deleteItem(id);
    set({ items: await storage().listItems({ activeOnly: false }) });
  },

  async saveTaxCode(code) {
    await storage().saveTaxCode(code);
    set({ taxCodes: await storage().listTaxCodes() });
  },

  async removeTaxCode(id) {
    await storage().deleteTaxCode(id);
    set({ taxCodes: await storage().listTaxCodes() });
  },

  async saveCurrencyRate(rate) {
    await storage().saveCurrencyRate(rate);
    set({ currencyRates: await storage().listCurrencyRates() });
  },

  async removeCurrencyRate(id) {
    await storage().deleteCurrencyRate(id);
    set({ currencyRates: await storage().listCurrencyRates() });
  },

  async saveCustomField(field) {
    await storage().saveCustomField(field);
    set({ customFields: await storage().listCustomFields() });
  },

  async saveContentPreset(preset) {
    await storage().saveContentPreset(preset);
    set({ contentPresets: await storage().listContentPresets() });
  },

  async removeCustomField(id) {
    await storage().deleteCustomField(id);
    set({ customFields: await storage().listCustomFields() });
  },

  async saveNumberSequence(sequence) {
    // `issued` is the record of numbers already handed out, so it is never rewritten
    // from the settings screen: a number once issued can never be issued again.
    await storage().saveNumberSequence(sequence);
    set({ numberSequences: await storage().listNumberSequences() });
  },

  async saveEmailAccount(account) {
    await storage().saveEmailAccount(account);
    set({ emailAccounts: await storage().listEmailAccounts() });
  },

  async removeEmailAccount(id) {
    await storage().deleteEmailAccount(id);
    set({ emailAccounts: await storage().listEmailAccounts() });
  },

  async saveEmailTemplate(template) {
    await storage().saveEmailTemplate(template);
    set({ emailTemplates: await storage().listEmailTemplates() });
  },

  async removeEmailTemplate(id) {
    await storage().deleteEmailTemplate(id);
    set({ emailTemplates: await storage().listEmailTemplates() });
  },

  async saveRecurringSchedule(schedule) {
    await storage().saveRecurringSchedule(schedule);
    set({ recurringSchedules: await storage().listRecurringSchedules() });
  },

  async removeRecurringSchedule(id) {
    await storage().deleteRecurringSchedule(id);
    set({ recurringSchedules: await storage().listRecurringSchedules() });
  },

  async saveRule(rule) {
    await storage().saveRule(rule);
    set({ rules: await storage().listRules() });
  },

  async removeRule(id) {
    await storage().deleteRule(id);
    set({ rules: await storage().listRules() });
  },

  async saveReminder(reminder) {
    await storage().saveReminder(reminder);
    set({ reminders: await storage().listReminders() });
  },

  async saveOutboxEntry(entry) {
    await storage().saveOutbox(entry);
    set({ outbox: await storage().listOutbox() });
  },

  async saveProject(project) {
    await storage().saveProject(project);
    set({ projects: await storage().listProjects() });
  },

  async removeProject(id) {
    await storage().deleteProject(id);
    set({ projects: await storage().listProjects() });
  },

  async saveTimeEntry(entry) {
    await storage().saveTimeEntry(entry);
    set({ timeEntries: await storage().listTimeEntries() });
  },

  async removeTimeEntry(id) {
    await storage().deleteTimeEntry(id);
    set({ timeEntries: await storage().listTimeEntries() });
  },

  async saveExpense(expense) {
    await storage().saveExpense(expense);
    set({ expenses: await storage().listExpenses() });
  },

  async removeExpense(id) {
    await storage().deleteExpense(id);
    set({ expenses: await storage().listExpenses() });
  },

  async saveRetainer(retainer) {
    await storage().saveRetainer(retainer);
    set({ retainers: await storage().listRetainers() });
  },

  async removeRetainer(id) {
    await storage().deleteRetainer(id);
    set({ retainers: await storage().listRetainers() });
  },

  async saveDocument(document) {
    await storage().saveDocument(document);
    const [documents, payments] = await Promise.all([storage().listDocuments(), storage().listPayments()]);
    set({ documents, payments });
  },

  async removeDocument(id) {
    await storage().deleteDocument(id);
    set({ documents: await storage().listDocuments() });
  },

  setToday(today) {
    set({ today });
  },
}));

/* ------------------------------------------------------------------ */
/* Reference data seeding                                              */
/* ------------------------------------------------------------------ */

/**
 * Insert the built-in templates, email templates, rules, views and a starter
 * catalogue the first time Duly runs.
 *
 * Guarded by a lookup rather than a flag: if the design templates already exist,
 * the install has been seeded and must not be seeded again. That matters because
 * a user can delete a built-in template, and re-seeding on every start would put
 * it back.
 */
async function seedReferenceData(): Promise<void> {
  const db = storage();
  const now = new Date().toISOString();

  const existingTemplates = await db.listDesignTemplates();
  if (existingTemplates.length === 0) {
    for (const template of builtinDesignTemplates(now)) await db.saveDesignTemplate(template);
  }

  const existingEmails = await db.listEmailTemplates();
  if (existingEmails.length === 0) {
    for (const template of builtinEmailTemplates(now)) await db.saveEmailTemplate(template);
  }

  const existingPresets = await db.listContentPresets();
  if (existingPresets.length === 0) {
    for (const preset of builtinContentPresets(now)) await db.saveContentPreset(preset);
  }

  const existingRules = await db.listRules();
  if (existingRules.length === 0) {
    for (const rule of builtinRulesAt(now)) await db.saveRule(rule);
  }

  const existingPolicies = await db.listReminderPolicies();
  if (existingPolicies.length === 0) {
    for (const policy of builtinReminderPolicies(now)) await db.saveReminderPolicy(policy);
  }

  const existingFees = await db.listLateFeePolicies();
  if (existingFees.length === 0) {
    for (const fee of builtinLateFeePolicies(now)) await db.saveLateFeePolicy(fee);
  }

  const existingViews = await db.listSavedViews();
  if (existingViews.length === 0) {
    for (const view of builtinSavedViews(now)) await db.saveSavedView(view);
  }

  const existingRates = await db.listCurrencyRates();
  if (existingRates.length === 0) {
    for (const rate of indicativeRates(now.slice(0, 10))) await db.saveCurrencyRate(rate);
  }

  const existingItems = await db.listItems();
  if (existingItems.length === 0) {
    await db.saveItems(starterItems('AUD'));
  }
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** Today in the app's configured time zone, as `YYYY-MM-DD`. */
export function useToday(): string {
  return useAppStore((s) => s.today);
}

export function useActiveProfile(): BusinessProfile | null {
  return useAppStore((s) => s.profiles.find((p) => p.id === s.activeProfileId) ?? null);
}

export function useClient(id: string | null): Client | null {
  return useAppStore((s) => (id ? (s.clients.find((c) => c.id === id) ?? null) : null));
}

/**
 * A client's contacts.
 *
 * The filter is outside the selector on purpose. A selector that builds a new array
 * returns a different reference on every store read, and Zustand compares by
 * reference — so the component re-renders forever. Select the stable slice, derive
 * from it.
 */
export function useClientContacts(clientId: string | null): Contact[] {
  const contacts = useAppStore((s) => s.contacts);
  return useMemo(
    () => (clientId ? contacts.filter((c) => c.clientId === clientId) : []),
    [contacts, clientId],
  );
}

export function useDesignTemplate(id: string | null): DesignTemplate | null {
  return useAppStore((s) => {
    if (!id) return s.designTemplates[0] ?? null;
    return s.designTemplates.find((t) => t.id === id) ?? s.designTemplates[0] ?? null;
  });
}

export function useTaxCode(id: string | null): TaxCode {
  return useAppStore((s) => s.taxCodes.find((t) => t.id === id) ?? s.taxCodes[0] ?? fallbackTaxCode);
}

const fallbackTaxCode: TaxCode = {
  id: 'tax_gst',
  name: 'GST',
  rate: '0.10',
  type: 'gst',
  compound: false,
  label: null,
  includeInBreakdown: true,
  displayOrder: 10,
  active: true,
  builtin: true,
};

/** Documents scoped to the active business, newest first. */
export function useScopedDocuments(type?: string): Document[] {
  const documents = useAppStore((s) => s.documents);
  const profileId = useAppStore((s) => s.activeProfileId);
  return useMemo(
    () =>
      documents.filter(
        (d) => (!profileId || d.profileId === profileId) && (!type || d.type === type) && !d.deletedAt,
      ),
    [documents, profileId, type],
  );
}

/** Whether the output folder has been chosen, for the "auto-file" readiness hint. */
export async function canAutoFile(): Promise<boolean> {
  return platform().capabilities.fileSystemAccess;
}
