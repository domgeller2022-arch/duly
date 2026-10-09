/**
 * The client record editor.
 *
 * The defaults block is the part that pays for itself: currency, payment terms,
 * tax treatment, discount, design template and whether a PO number is required.
 * Set them once here and every invoice for this client starts correct.
 *
 * The ABN field validates its checksum as you type, so a typo is caught before it
 * reaches a tax invoice.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import type { Client } from '@/core/schemas';
import { clientSchema, newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { useAppStore } from '@/state/app';
import { storage } from '@/adapters';
import { formatAbnAsTyping, validateAbn } from '@/core/validation/abn';
import { parseAddress } from '@/core/format/address';
import { ALL_TERMS } from '../documents/editor/terms';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  NumberInput,
  Select,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { CustomFieldInputs } from '@/ui/components/custom-fields';

export function ClientEditScreen() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { push } = useToast();

  const clients = useAppStore((s) => s.clients);
  const profiles = useAppStore((s) => s.profiles);
  const settings = useAppStore((s) => s.settings);
  const saveClient = useAppStore((s) => s.saveClient);
  const removeClient = useAppStore((s) => s.removeClient);
  const activeProfileId = useAppStore((s) => s.activeProfileId);

  const isNew = !clientId;
  const existing = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  const [draft, setDraft] = useState<Client>(
    () =>
      existing ??
      newClient({
        defaultCurrency: (profiles.find((p) => p.id === activeProfileId)?.defaultCurrency ??
          settings?.defaultCurrency ??
          'AUD') as 'AUD',
        defaultTermsId: settings?.defaultTermsId ?? 'net_30',
      }),
  );
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) setDraft(existing);
  }, [existing]);

  const abn = useMemo(
    () => (draft.taxIdCountry === 'AU' ? validateAbn(draft.taxId) : null),
    [draft.taxId, draft.taxIdCountry],
  );

  const patch = (changes: Partial<Client>) => setDraft((current) => ({ ...current, ...changes }));

  const save = async () => {
    setSaving(true);
    try {
      const next = clientSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await storage().saveClient(next);
      await saveClient(next);
      await storage().saveAuditLog(
        newEntity({
          entity: 'client',
          entityId: next.id,
          action: isNew ? 'create' : 'update',
          summary: `${isNew ? 'Added' : 'Updated'} ${next.displayName}`,
          actor: 'user',
        }),
      );
      push({ tone: 'success', title: isNew ? 'Client added' : 'Client saved' });
      navigate(`/clients/${next.id}`);
    } catch (error) {
      push({
        tone: 'error',
        title: 'The client could not be saved',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await removeClient(draft.id);
    setShowDelete(false);
    push({ tone: 'info', title: 'Client archived', description: 'Their invoices are untouched.' });
    navigate('/clients');
  };

  const taxCodes = useAppStore((s) => s.taxCodes);
  const templates = useAppStore((s) => s.designTemplates);
  const emailTemplates = useAppStore((s) => s.emailTemplates);
  const customFields = useAppStore((s) => s.customFields);
  // Filtered outside the selector: a `filter` inside one returns a new array every
  // call, and Zustand compares by reference, so the store would notify forever.
  const clientFields = useMemo(() => customFields.filter((f) => f.entity === 'client'), [customFields]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6" data-print="hide">
      <PageHeader
        title={isNew ? 'New client' : draft.displayName || 'Edit client'}
        subtitle={
          isNew ? 'Everything except the name is optional — you can fill the rest in later.' : undefined
        }
        actions={
          <>
            <Button
              icon={<ArrowLeft className="size-3.5" aria-hidden />}
              onClick={() => navigate('/clients')}
            >
              Back
            </Button>
            <Button
              variant="primary"
              icon={<Save className="size-3.5" aria-hidden />}
              onClick={() => void save()}
              loading={saving}
            >
              Save client
            </Button>
          </>
        }
        className="mb-4"
      />

      <div className="space-y-4">
        {/* ---- identity ---- */}
        <Card className="space-y-3">
          <h2 className="eyebrow">Who they are</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <TextInput
                value={draft.displayName}
                placeholder="Acme Pty Ltd"
                onChange={(e) => patch({ displayName: e.target.value })}
              />
            </Field>

            <Field
              label="Legal entity name"
              hint="Printed on the invoice when it differs from the trading name"
            >
              <TextInput value={draft.legalName} onChange={(e) => patch({ legalName: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label={draft.taxIdCountry === 'AU' ? 'ABN' : 'Tax ID'}
              hint={draft.taxIdCountry === 'AU' ? 'Checked as you type' : undefined}
              error={abn && !abn.valid && abn.reason ? abn.reason : undefined}
            >
              <TextInput
                value={draft.taxIdCountry === 'AU' ? formatAbnAsTyping(draft.taxId) : draft.taxId}
                inputMode="numeric"
                placeholder={draft.taxIdCountry === 'AU' ? '12 345 678 901' : undefined}
                invalid={Boolean(abn && !abn.valid && abn.reason)}
                onChange={(e) =>
                  patch({
                    taxId: draft.taxIdCountry === 'AU' ? e.target.value.replace(/\D/g, '') : e.target.value,
                  })
                }
              />
            </Field>

            <Field label="Country">
              <Select value={draft.taxIdCountry} onChange={(e) => patch({ taxIdCountry: e.target.value })}>
                <option value="AU">Australia</option>
                <option value="NZ">New Zealand</option>
                <option value="GB">United Kingdom</option>
                <option value="US">United States</option>
                <option value="EU">European Union</option>
                <option value="OTHER">Elsewhere</option>
              </Select>
            </Field>

            <Field label="Tags" hint="Comma separated — rules can match on them">
              <TextInput
                value={draft.tags.join(', ')}
                placeholder="Overseas, Government"
                onChange={(e) =>
                  patch({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </div>

          {abn && abn.suggestedDigit && (
            <Alert tone="warning" title="Was that a typo?">
              If the first ten digits are right, the last one should be {abn.suggestedDigit}.
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => patch({ taxId: `${draft.taxId.slice(0, 10)}${abn.suggestedDigit}` })}
              >
                Use it
              </button>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Email">
              <TextInput
                type="email"
                value={draft.email}
                onChange={(e) => patch({ email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <TextInput value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
            </Field>
          </div>
        </Card>

        {/* ---- addresses ---- */}
        <Card className="space-y-3">
          <h2 className="eyebrow">Billing address</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Street address">
              <TextInput
                value={draft.billingAddress.line1}
                onChange={(e) =>
                  patch({ billingAddress: { ...draft.billingAddress, line1: e.target.value } })
                }
              />
            </Field>
            <Field label="Address line 2">
              <TextInput
                value={draft.billingAddress.line2}
                onChange={(e) =>
                  patch({ billingAddress: { ...draft.billingAddress, line2: e.target.value } })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="City" className="sm:col-span-2">
              <TextInput
                value={draft.billingAddress.city}
                onChange={(e) => patch({ billingAddress: { ...draft.billingAddress, city: e.target.value } })}
              />
            </Field>
            <Field label="State">
              <TextInput
                value={draft.billingAddress.state}
                onChange={(e) =>
                  patch({ billingAddress: { ...draft.billingAddress, state: e.target.value } })
                }
              />
            </Field>
            <Field label="Postcode">
              <TextInput
                value={draft.billingAddress.postcode}
                onChange={(e) =>
                  patch({ billingAddress: { ...draft.billingAddress, postcode: e.target.value } })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Country">
              <TextInput
                value={draft.billingAddress.country}
                onChange={(e) =>
                  patch({ billingAddress: { ...draft.billingAddress, country: e.target.value } })
                }
              />
            </Field>
            <Field label="Override the whole address" hint="Paste an address exactly as it should print">
              <TextArea
                rows={2}
                value={draft.billingAddress.formatted ?? ''}
                onChange={(e) =>
                  patch({
                    billingAddress: {
                      ...draft.billingAddress,
                      formatted: e.target.value.trim() ? e.target.value : null,
                    },
                  })
                }
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const raw = [
                draft.billingAddress.line1,
                draft.billingAddress.line2,
                draft.billingAddress.city,
                draft.billingAddress.state,
                draft.billingAddress.postcode,
                draft.billingAddress.country,
              ]
                .filter(Boolean)
                .join('\n');
              patch({ billingAddress: parseAddress(raw) });
            }}
          >
            Tidy the address fields
          </Button>
        </Card>

        {/* ---- defaults ---- */}
        <Card className="space-y-3">
          <h2 className="eyebrow">Defaults for new documents</h2>
          <p className="-mt-1 text-[12px] text-ink-muted">
            These apply every time you pick this client on a new invoice. You can still override them on any
            individual document.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Currency">
              <Select
                value={draft.defaultCurrency}
                onChange={(e) => patch({ defaultCurrency: e.target.value })}
              >
                {['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'SGD', 'CHF', 'HKD'].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Payment terms">
              <Select
                value={draft.defaultTermsId}
                onChange={(e) => patch({ defaultTermsId: e.target.value })}
              >
                {ALL_TERMS(settings).map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tax treatment">
              <Select
                value={draft.defaultTaxCodeId ?? ''}
                onChange={(e) => patch({ defaultTaxCodeId: e.target.value || null })}
              >
                <option value="">Same as the business default</option>
                {taxCodes
                  .filter((c) => c.active)
                  .map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.label ? `${code.name} (${code.label})` : code.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Standing discount" hint="Applied to the document subtotal">
              <NumberInput
                value={draft.defaultDiscountPercent}
                ariaLabel="Standing discount percentage"
                onChange={(value) => patch({ defaultDiscountPercent: value })}
              />
            </Field>

            <Field label="Design template">
              <Select
                value={draft.defaultDesignTemplateId ?? ''}
                onChange={(e) => patch({ defaultDesignTemplateId: e.target.value || null })}
              >
                <option value="">Same as the business default</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Email template">
              <Select
                value={draft.defaultEmailTemplateId ?? ''}
                onChange={(e) => patch({ defaultEmailTemplateId: e.target.value || null })}
              >
                <option value="">Same as the business default</option>
                {emailTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Switch
            checked={draft.requirePoNumber}
            onChange={(v) => patch({ requirePoNumber: v })}
            label="Require a PO number"
            hint="The compliance check warns before submitting an invoice for this client without one."
          />

          <Field label="Notes" hint="Private to you — never printed on a document">
            <TextArea value={draft.notes} rows={3} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </Card>

        {/* ---- custom fields ---- */}
        {clientFields.length > 0 && (
          <Card>
            <h2 className="eyebrow">Extra fields</h2>
            <p className="-mt-1 mb-3 text-[12px] text-ink-muted">
              Fields you added in Settings → Custom fields. They are also available to your email templates.
            </p>
            <CustomFieldInputs
              fields={[...clientFields].sort((a, b) => a.displayOrder - b.displayOrder)}
              values={draft.customFields}
              onChange={(key, value) => patch({ customFields: { ...draft.customFields, [key]: value } })}
            />
          </Card>
        )}

        {/* ---- danger zone ---- */}
        {!isNew && (
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-ink">Archive this client</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  They disappear from pickers but their invoices, payments and history stay exactly as they
                  are.
                </p>
              </div>
              <Button
                variant="danger"
                icon={<Trash2 className="size-3.5" aria-hidden />}
                onClick={() => setShowDelete(true)}
              >
                Archive
              </Button>
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => void remove()}
        title={`Archive ${draft.displayName || 'this client'}?`}
        confirmLabel="Archive"
        danger
        body="Their invoices and payment history are kept. They will no longer appear in client pickers."
      />
    </div>
  );
}
