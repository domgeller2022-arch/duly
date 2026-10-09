/**
 * The document editor store.
 *
 * One store per open document, holding the draft, its lines, the undo history and
 * the derived calculation. Three decisions shape it:
 *
 * 1. **Autosave at every keystroke.** The draft is written to storage on a short
 *    debounce, so nothing is ever lost and there is no "save" button to forget.
 *
 * 2. **Undo is local and cheap.** Every mutation pushes the previous state onto a
 *    bounded history. Ctrl+Z steps back through edits within this session, which
 *    is what people actually mean by undo.
 *
 * 3. **Totals are always derived, never trusted.** The cached totals on the
 *    document are only ever written from a fresh calculation, and the calculation
 *    runs on every render of changed input.
 */

import { create } from 'zustand';
import type {
  BusinessProfile,
  Client,
  ClientCredit,
  Contact,
  Document,
  DocumentLine,
  Payment,
} from '@/core/schemas';
import { calculate, applyTotals, type CalculationResult } from '@/core/calc/calculate';
import { signatureSchema } from '@/core/schemas/crm';
import { storage } from '@/adapters';
import { newEntity } from '@/core/schemas/common';
import { attachmentSchema } from '@/core/schemas/crm';
import {
  applyClientDefaults,
  createLine,
  createDocument as buildDocument,
  acceptQuote as acceptQuoteRecord,
  depositAmount,
  insertLines,
  moveLine,
  removeLine as removeLineFrom,
  resolveRecipients,
  searchCatalogue,
  type CatalogueMatch,
  type NewDocumentArgs,
} from '@/core/documents';

export interface EditorHistoryEntry {
  document: Document;
  lines: DocumentLine[];
  label: string;
}

export interface EditorState {
  /* ---- the draft ---- */
  documentId: string | null;
  document: Document | null;
  lines: DocumentLine[];

  /* ---- context ---- */
  profile: BusinessProfile | null;
  client: Client | null;
  contacts: Contact[];
  items: import('@/core/schemas').Item[];
  taxCodes: import('@/core/tax/tax').TaxCode[];
  payments: Payment[];
  /** Credit this client holds, for the "apply credit to this invoice" offer. */
  clientCredits: ClientCredit[];

  /* ---- derived ---- */
  result: CalculationResult | null;

  /* ---- editor state ---- */
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  error: string | null;
  /** Selected line id, for keyboard navigation and the row menu. */
  activeLineId: string | null;
  /** Open catalogue suggestions for the active description field. */
  suggestions: CatalogueMatch[];
  autocompleteIndex: number;
  collapsedSections: Set<string>;

  /* ---- history ---- */
  history: EditorHistoryEntry[];
  future: EditorHistoryEntry[];

  /* ---- actions ---- */
  load: (documentId: string) => Promise<void>;
  create: (args: NewDocumentArgs) => Promise<string>;
  reset: () => void;

  update: (patch: Partial<Document>, label?: string) => void;
  setClient: (client: Client | null) => void;

  /** Credit held but not yet applied to any document, in minor units. */
  unappliedCredit: () => number;
  /** Take credit off this invoice, up to what is held. */
  applyCredit: (minor: number) => void;

  addLine: (line: DocumentLine, at?: number) => void;
  addLines: (lines: DocumentLine[], at?: number) => void;
  addItemLine: (item: import('@/core/schemas').Item, at?: number) => void;
  patchLine: (lineId: string, patch: Partial<DocumentLine>) => void;
  patchAllLines: (patch: (line: DocumentLine) => Partial<DocumentLine>, label?: string) => void;
  removeLine: (lineId: string) => void;
  moveLineTo: (from: number, to: number) => void;
  duplicateLine: (lineId: string) => void;
  replaceLines: (lines: DocumentLine[], label?: string) => void;

  setActiveLine: (lineId: string | null) => void;
  setDescriptionDraft: (lineId: string, query: string) => void;
  chooseSuggestion: (match: CatalogueMatch) => void;
  moveSuggestion: (delta: number) => void;
  closeSuggestions: () => void;

  toggleSection: (sectionId: string) => void;

  undo: () => void;
  redo: () => void;

  flush: () => Promise<void>;
  reload: () => Promise<void>;
  acceptQuote: (options: {
    signerName: string;
    signerTitle?: string;
    /** Drawn signature as a data URL, when the client signed rather than typed. */
    signatureImage?: string | null;
    /** Attached PDF as a data URL, stored on the quote's attachment list. */
    attachedPdfDataUrl?: string | null;
    attachedPdfName?: string;
    attachedPdfSize?: number;
  }) => Promise<void>;
}

/** Autosave delay. Short enough to feel instant, long enough not to thrash. */
const AUTOSAVE_MS = 600;

/** How many undo steps to keep. Deep enough for a session, bounded for memory. */
const HISTORY_LIMIT = 60;

export const useEditorStore = create<EditorState>((set, get) => {
  let saveTimer: number | null = null;

  function commit(
    patch: Partial<EditorState>,
    options: {
      label?: string;
      history?: boolean;
      documentPatch?: Partial<Document>;
      lines?: DocumentLine[];
    } = {},
  ): void {
    const state = get();

    // Nothing to do, or nothing loaded.
    if (!state.document) return;

    const nextDocument = options.documentPatch
      ? { ...state.document, ...options.documentPatch }
      : { ...state.document, ...(patch.document ?? {}) };
    const nextLines = options.lines ?? patch.lines ?? state.lines;

    // Skip the write entirely when nothing actually changed. This matters: the
    // store is called on every keystroke, and rewriting a document that did not
    // change would churn `updatedAt` and break the dirty-check in the shell.
    const unchanged =
      JSON.stringify(nextDocument) === JSON.stringify(state.document) &&
      JSON.stringify(nextLines) === JSON.stringify(state.lines);
    if (unchanged) return;

    const history =
      options.history === false || !options.label
        ? state.history
        : [...state.history, { document: state.document, lines: state.lines, label: options.label }].slice(
            -HISTORY_LIMIT,
          );

    const result = calculate({
      document: nextDocument,
      lines: nextLines,
      payments: state.payments,
      taxCodes: state.taxCodes,
      roundingMethod: currentRoundingMethod,
      clientCreditAvailable: state.client ? creditFor(state.client) : 0,
      rateToAud: nextDocument.exchangeRateToAud,
    });

    const withTotals = applyTotals({ ...nextDocument }, result);

    set({
      document: withTotals,
      lines: nextLines,
      result,
      dirty: true,
      history,
      future: options.history === false ? state.future : [],
      ...patch,
    });

    scheduleSave();
  }

  function scheduleSave(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void get().flush();
    }, AUTOSAVE_MS);
  }

  return {
    documentId: null,
    document: null,
    lines: [],
    profile: null,
    client: null,
    contacts: [],
    items: [],
    taxCodes: [],
    payments: [],
    clientCredits: [],
    result: null,
    loading: true,
    saving: false,
    dirty: false,
    lastSavedAt: null,
    error: null,
    activeLineId: null,
    suggestions: [],
    autocompleteIndex: 0,
    collapsedSections: new Set(),
    history: [],
    future: [],

    async load(documentId) {
      set({ loading: true, error: null });
      try {
        const db = storage();
        const bundle = await db.getDocumentBundle(documentId);
        if (!bundle) {
          set({ loading: false, error: 'That document could not be found.' });
          return;
        }

        const [profile, client, contacts, items, taxCodes, clientCredits] = await Promise.all([
          db.getBusinessProfile(bundle.document.profileId),
          bundle.document.clientId ? db.getClient(bundle.document.clientId) : Promise.resolve(undefined),
          db.listContacts(bundle.document.clientId ?? undefined),
          db.listItems({ activeOnly: true }),
          db.listTaxCodes(),
          bundle.document.clientId ? db.listClientCredits(bundle.document.clientId) : Promise.resolve([]),
        ]);

        const result = calculate({
          document: bundle.document,
          lines: bundle.lines,
          payments: bundle.payments,
          taxCodes,
          clientCreditAvailable: client ? creditFor(client) : 0,
          rateToAud: bundle.document.exchangeRateToAud,
        });

        set({
          documentId,
          document: bundle.document,
          lines: bundle.lines,
          profile: profile ?? null,
          client: client ?? null,
          contacts,
          items,
          taxCodes,
          payments: bundle.payments,
          clientCredits,
          result,
          loading: false,
          dirty: false,
          history: [],
          future: [],
          lastSavedAt: new Date().toISOString(),
          activeLineId: bundle.lines[0]?.id ?? null,
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'The document could not be opened.',
        });
      }
    },

    async create(args) {
      const { document, lines } = buildDocument(args);
      const result = calculate({ document, lines, payments: [], taxCodes: [] });
      const withTotals = applyTotals({ ...document }, result);

      await storage().saveDocument(withTotals, lines);

      set({
        documentId: document.id,
        document: withTotals,
        lines,
        result,
        loading: false,
        dirty: false,
        history: [],
        future: [],
        activeLineId: lines[0]?.id ?? null,
      });

      return document.id;
    },

    reset() {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      set({
        documentId: null,
        document: null,
        lines: [],
        result: null,
        client: null,
        contacts: [],
        payments: [],
        clientCredits: [],
        loading: false,
        dirty: false,
        history: [],
        future: [],
        suggestions: [],
        activeLineId: null,
      });
    },

    update(patch, label) {
      const { document: current } = get();
      if (!current) return;

      // A finalised document is immutable. The UI disables the fields, but the
      // store refuses too, so a stray keyboard shortcut cannot edit a locked
      // document.
      const isLifecycleChange = patch.status !== undefined;
      if (current.status !== 'draft' && !isLifecycleChange) return;

      commit({}, { label: label ?? 'Edit document', documentPatch: patch });
    },

    setClient(client) {
      const state = get();
      if (!state.document) return;

      const recipients = resolveRecipients(client, state.contacts);
      const next = applyClientDefaults(state.document, client);

      // The credit a client holds is theirs, not the previous client's, so it is
      // re-read rather than carried across.
      if (client && client.id !== state.client?.id) {
        void storage()
          .listClientCredits(client.id)
          .then((credits) => set({ clientCredits: credits }));
      }

      commit(
        { client, ...recipients },
        {
          label: 'Change client',
          documentPatch: {
            ...next,
            to: recipients.to.length ? recipients.to : next.to,
            cc: recipients.cc.length ? recipients.cc : next.cc,
          },
        },
      );
    },

    addLine(line, at) {
      const state = get();
      if (!state.document) return;
      const lines = insertLines(state.lines, [line], at);
      commit({ lines, activeLineId: line.id }, { label: 'Add line', lines });
    },

    addLines(newLines, at) {
      const state = get();
      if (!state.document) return;
      const lines = insertLines(state.lines, newLines, at);
      commit(
        { lines, activeLineId: newLines[newLines.length - 1]?.id ?? state.activeLineId },
        { label: 'Add lines', lines },
      );
    },

    addItemLine(item, at) {
      const state = get();
      if (!state.document) return;
      const line = createLine({ document: state.document, item });
      const lines = insertLines(state.lines, [line], at);
      commit({ lines, activeLineId: line.id }, { label: `Add ${item.name}`, lines });
    },

    patchLine(lineId, patch) {
      const state = get();
      if (!state.document) return;
      if (state.document.status !== 'draft') return;

      const lines = state.lines.map((l) =>
        l.id === lineId ? { ...l, ...patch, updatedAt: new Date().toISOString() } : l,
      );
      commit({ lines }, { label: 'Edit line', lines });
    },

    patchAllLines(patchFn, label) {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      const lines = state.lines.map((l) => ({ ...l, ...patchFn(l) }));
      commit({ lines }, { label: label ?? 'Edit lines', lines });
    },

    removeLine(lineId) {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      const index = state.lines.findIndex((l) => l.id === lineId);
      const lines = removeLineFrom(state.lines, lineId);
      const neighbour = lines[Math.min(index, lines.length - 1)];
      commit({ lines, activeLineId: neighbour?.id ?? null }, { label: 'Remove line', lines });
    },

    moveLineTo(from, to) {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      const lines = moveLine(state.lines, from, to);
      commit({ lines }, { label: 'Reorder lines', lines });
    },

    /** A full replacement that goes through commit — the row menu's section,
        note and discount inserts need it, because a raw setState would skip
        the dirty flag, the recompute and the autosave. */
    replaceLines(lines, label = 'Edit lines') {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      commit({ lines, activeLineId: state.activeLineId }, { label, lines });
    },

    duplicateLine(lineId) {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      const index = state.lines.findIndex((l) => l.id === lineId);
      const original = state.lines[index];
      if (!original) return;

      const copy: DocumentLine = {
        ...original,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const lines = insertLines(state.lines, [copy], index + 1);
      commit({ lines, activeLineId: copy.id }, { label: 'Duplicate line', lines });
    },

    setActiveLine(lineId) {
      set({ activeLineId: lineId });
    },

    setDescriptionDraft(lineId, query) {
      const state = get();
      if (!state.document) return;

      const lines = state.lines.map((l) => (l.id === lineId ? { ...l, description: query } : l));
      const recent = recentDescriptions(state.items, lines);

      set({
        lines,
        suggestions: searchCatalogue(query, state.items, recent, state.document),
        autocompleteIndex: 0,
      });
      // The keystroke itself is not a history entry: holding Ctrl+Z should undo
      // the last structural change, not every character.
      scheduleSave();
    },

    chooseSuggestion(match) {
      const state = get();
      if (!state.document || !state.activeLineId) return;

      const built = match.build();
      const lines = state.lines.map((l) =>
        l.id === state.activeLineId ? { ...built, id: l.id, description: match.label } : l,
      );

      commit({ suggestions: [], autocompleteIndex: 0 }, { label: 'Use catalogue item', lines });
      set({ activeLineId: lines[lines.length - 1]?.id ?? state.activeLineId });
    },

    moveSuggestion(delta) {
      set((s) => ({
        autocompleteIndex: Math.max(0, Math.min(s.suggestions.length - 1, s.autocompleteIndex + delta)),
      }));
    },

    closeSuggestions() {
      set({ suggestions: [], autocompleteIndex: 0 });
    },

    unappliedCredit() {
      const state = get();
      const rows = state.clientCredits
        .filter((c) => c.appliedToDocumentId === null || c.appliedToDocumentId === state.document?.id)
        .filter((c) => c.appliedToDocumentId !== state.document?.id)
        .reduce((sum, c) => sum + Math.max(0, c.amount - c.appliedAmount), 0);
      // A credit held on the client record, set by hand or by an earlier overpayment,
      // counts too — it is the same money.
      return rows + (state.client?.openingCredit ?? 0);
    },

    applyCredit(minor) {
      const state = get();
      if (!state.document || state.document.status !== 'draft') return;
      const available = state.unappliedCredit();
      const take = Math.min(minor, available, Math.max(0, state.result?.total ?? 0));
      if (take <= 0) return;
      commit({}, { label: 'Apply client credit', documentPatch: { clientCreditApplied: take } });
    },

    toggleSection(sectionId) {
      set((s) => {
        const next = new Set(s.collapsedSections);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        return { collapsedSections: next };
      });
    },

    undo() {
      const state = get();
      const previous = state.history[state.history.length - 1];
      if (!previous || !state.document) return;

      set({
        document: previous.document,
        lines: previous.lines,
        history: state.history.slice(0, -1),
        future: [
          { document: state.document, lines: state.lines, label: previous.label },
          ...state.future,
        ].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
      scheduleSave();
    },

    redo() {
      const state = get();
      const next = state.future[0];
      if (!next || !state.document) return;

      set({
        document: next.document,
        lines: next.lines,
        history: [
          ...state.history,
          { document: state.document, lines: state.lines, label: next.label },
        ].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: true,
      });
      scheduleSave();
    },

    async flush() {
      const state = get();
      if (!state.document || !state.dirty) return;
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }

      set({ saving: true });
      try {
        await storage().saveDocument(state.document, state.lines);
        set({ saving: false, dirty: false, lastSavedAt: new Date().toISOString() });
      } catch (error) {
        set({
          saving: false,
          error: error instanceof Error ? error.message : 'The draft could not be saved.',
        });
      }
    },

    async acceptQuote(options) {
      const state = get();
      if (!state.document) return;

      const now = new Date().toISOString();
      const hasSigned = Boolean(options.signatureImage);
      const hasFile = Boolean(options.attachedPdfDataUrl);
      const method = hasFile ? 'attached' : hasSigned ? 'drawn' : 'typed';

      const signatureId = newEntity({}).id;
      const signature = signatureSchema.parse(
        newEntity({
          id: signatureId,
          documentId: state.document.id,
          signerName: options.signerName,
          signerTitle: options.signerTitle ?? '',
          typedName: hasFile || hasSigned ? '' : options.signerName,
          method,
          signedAt: now,
          image: hasSigned ? options.signatureImage! : null,
        }),
      );
      await storage().saveSignature(signature);

      if (hasFile) {
        await storage().saveAttachment(
          attachmentSchema.parse({
            ...newEntity({}),
            ownerType: 'document',
            ownerId: state.document.id,
            fileName: options.attachedPdfName ?? 'signed-quote.pdf',
            mimeType: 'application/pdf',
            sizeBytes: options.attachedPdfSize ?? 0,
            storedPath: options.attachedPdfDataUrl!,
            appendToPdf: false,
            internal: false,
          }),
        );
      }

      const next = acceptQuoteRecord(
        state.document,
        now,
        options.signerName,
        signatureId,
        hasSigned ? options.signatureImage! : null,
      );
      await storage().saveDocument(next);
      commit(
        { document: next, dirty: false },
        { label: 'Quote accepted', history: false, documentPatch: next },
      );
    },

    async reload() {
      const id = get().documentId;
      if (id) await get().load(id);
    },
  };

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Credit available to a document's client, in the document's own currency.
   *
   * Only what has not already been applied somewhere else — a credit spent on last
   * month's invoice is not available again.
   */
  function creditFor(client: Client): number {
    const rows = get()
      .clientCredits.filter((c) => c.appliedToDocumentId === null)
      .reduce((sum, c) => sum + Math.max(0, c.amount - c.appliedAmount), 0);
    return rows + client.openingCredit;
  }

  /** The most recent free-typed descriptions, for the catalogue autocomplete. */
  function recentDescriptions(items: { name: string }[], lines: DocumentLine[]): string[] {
    const known = new Set(items.map((i) => i.name.toLowerCase()));
    return lines.map((l) => l.description).filter((d) => d.trim() && !known.has(d.trim().toLowerCase()));
  }
});

/**
 * The ATO rounding method in force.
 *
 * Module-level rather than part of the store because it is a setting, not
 * document state: it is set once at load and applies to every recalculation until
 * the user changes it in Settings.
 */
let currentRoundingMethod: 'total_invoice' | 'taxable_sale' = 'total_invoice';

export function setEditorRoundingMethod(method: 'total_invoice' | 'taxable_sale'): void {
  currentRoundingMethod = method;
}

export function editorRoundingMethod(): 'total_invoice' | 'taxable_sale' {
  return currentRoundingMethod;
}

/* ------------------------------------------------------------------ */
/* Derived helpers for the editor UI                                   */
/* ------------------------------------------------------------------ */

/** The deposit amount requested, in minor units. */
export function requestedDeposit(state: Pick<EditorState, 'document' | 'result'>): number {
  if (!state.document || !state.result) return 0;
  return depositAmount(state.result.total, state.document.deposit);
}

/** Whether the document is locked and cannot be edited. */
export function isLocked(state: Pick<EditorState, 'document'>): boolean {
  return Boolean(state.document && state.document.status !== 'draft');
}

/** Lines with no description, which block finalising only as a warning. */
export function incompleteLines(state: Pick<EditorState, 'result'>): string[] {
  return state.result?.incompleteLineIds ?? [];
}

export { calculate };
