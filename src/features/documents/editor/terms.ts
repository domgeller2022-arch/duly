/**
 * The payment-terms list, merged from the built-ins and any the user has added.
 *
 * A custom term is stored as a plain id and a day count, so adding one is not a
 * code change — which is what "Net 45" for an unusual contract requires.
 */

import type { Settings } from '@/core/schemas/settings';
import { DEFAULT_TERMS, type PaymentTerms } from '@/core/schemas/crm';

export function ALL_TERMS(settings: Settings | null): PaymentTerms[] {
  const enabled = settings?.enabledTermIds;
  const builtIn = enabled?.length ? DEFAULT_TERMS.filter((t) => enabled.includes(t.id)) : DEFAULT_TERMS;
  const custom = (settings?.customTerms ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    days: t.days,
    kind: (t.days === null ? 'custom_date' : 'net_days') as PaymentTerms['kind'],
  }));
  return [...builtIn, ...custom];
}

/** True when the settings restrict which terms appear, so the UI can warn. */
export function termsAreRestricted(settings: Settings | null): boolean {
  if (!settings) return false;
  return settings.enabledTermIds.length > 0 && settings.enabledTermIds.length < DEFAULT_TERMS.length;
}
