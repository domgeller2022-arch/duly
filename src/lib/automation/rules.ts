/**
 * Rules applied to open drafts.
 *
 * Rules run on save in the editor and again in the scheduler for drafts that were
 * left open. Either way they return a patch rather than mutating the document, so
 * a rule can never silently rewrite a finalised invoice.
 */

import { evaluateRules, type RuleContext } from '@/core/engines/rules';
import type { Document, DocumentLine } from '@/core/schemas/document';
import { calculate } from '@/core/calc/calculate';
import { storage } from '@/adapters';

export interface RuleApplication {
  documentId: string;
  profileId: string;
  summary: string;
  details: string[];
  /** The patch to apply, if the user accepts it. */
  patch: ReturnType<typeof evaluateRules>['patch'];
}

/** Build the evaluation context for a document from stored records. */
export async function buildRuleContext(
  document: Document,
  editorLines?: DocumentLine[],
): Promise<RuleContext | null> {
  const db = storage();
  const [clients, taxCodes, items, lines] = await Promise.all([
    db.getClient(document.clientId ?? ''),
    db.listTaxCodes(),
    db.listItems({ activeOnly: true }),
    editorLines ? Promise.resolve(editorLines) : db.listDocumentLines(document.id),
  ]);

  if (lines.length === 0 && !document.clientId) return null;

  const result = calculate({ document, lines, payments: [], taxCodes });
  const itemIds = new Set(lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const categories = [...itemIds]
    .map((id) => items.find((i) => i.id === id)?.category ?? '')
    .filter(Boolean)
    .map((c) => c.toLowerCase());

  const profile = await db.getBusinessProfile(document.profileId);

  return {
    client: clients ?? null,
    document,
    lines,
    subtotalMinor: result.subtotal,
    totalMinor: result.total,
    itemCount: result.lineOrder.length,
    categories,
    profileCode: profile?.code ?? '',
  };
}

/**
 * Apply rules to one document.
 *
 * Returns null when nothing matched, so the caller can skip a write entirely
 * rather than touching `updatedAt` on every draft every 15 minutes.
 */
export async function applyRulesToDocument(document: Document): Promise<RuleApplication | null> {
  if (document.status !== 'draft') return null;
  if (document.deletedAt) return null;

  const [rules, context] = await Promise.all([storage().listRules(), buildRuleContext(document)]);
  if (rules.length === 0 || !context) return null;

  const outcome = evaluateRules(rules, context);
  if (outcome.applied.length === 0) return null;

  // Only write when a value actually changed. A rule whose actions match the
  // document as it stands used to rewrite it anyway — every 15 minutes, and
  // behind any editor that had it open.
  const changed = Object.entries(outcome.patch).filter(
    ([key, value]) => (document as unknown as Record<string, unknown>)[key] !== value,
  );
  if (changed.length === 0) return null;

  await storage().saveDocument({ ...document, ...outcome.patch });

  return {
    documentId: document.id,
    profileId: document.profileId,
    summary: `${outcome.applied.length} rule(s) applied to ${document.number || document.draftNumber || 'this draft'}.`,
    details: outcome.log,
    patch: outcome.patch,
  };
}

/** Apply rules to every open draft. Used by the scheduler. */
export async function applyRulesToOpenDrafts(limit = 200): Promise<RuleApplication[]> {
  const documents = await storage().listDocuments({ status: 'draft' });
  const applications: RuleApplication[] = [];

  for (const document of documents.slice(0, limit)) {
    try {
      const applied = await applyRulesToDocument(document);
      if (applied) applications.push(applied);
    } catch {
      // One bad draft must not stop the rest of the pass.
    }
  }

  return applications;
}
