/**
 * Tax codes.
 *
 * The Australian defaults are built in and can be renamed, deactivated or given a
 * printed marker, but not deleted — every document references them by id, and a
 * deleted code would leave an invoice pointing at nothing. Custom rates exist for
 * overseas clients, which is why the rate is free text rather than a fixed list.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { TaxCode, TaxCodeType } from '@/core/tax/tax';
import { formatRate, ROUNDING_METHODS } from '@/core/tax/tax';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { useAppStore } from '@/state/app';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';

const TYPE_LABELS: { id: TaxCodeType; label: string; hint: string }[] = [
  { id: 'gst', label: 'Taxable', hint: 'Adds tax at the rate below — Australian GST is 10%' },
  { id: 'gst_free', label: 'GST-free', hint: 'No tax, but the document must say why' },
  { id: 'input_taxed', label: 'Input taxed', hint: 'No tax on the sale; the buyer claims it back' },
  { id: 'export', label: 'Export (zero rated)', hint: 'No tax on a sale outside Australia' },
  { id: 'compound', label: 'Compound', hint: 'Tax on the already-taxed amount' },
  { id: 'custom', label: 'Custom rate', hint: 'Any rate you enter' },
  { id: 'zero', label: 'No tax', hint: 'No tax and no printed reason' },
];

export function TaxCodesSection() {
  const { push } = useToast();
  const taxCodes = useAppStore((s) => s.taxCodes);
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const saveTaxCode = useAppStore((s) => s.saveTaxCode);
  const removeTaxCode = useAppStore((s) => s.removeTaxCode);

  const [deleting, setDeleting] = useState<TaxCode | null>(null);

  const sorted = [...taxCodes].sort((a, b) => a.displayOrder - b.displayOrder);

  const save = async (code: TaxCode) => {
    await saveTaxCode(code);
    await storage().saveAuditLog(
      newEntity({
        entity: 'tax_code',
        entityId: code.id,
        action: 'update',
        summary: `Updated tax code ${code.name}`,
        actor: 'user',
      }),
    );
  };

  const add = async () => {
    const code: TaxCode = {
      id: `tax_${Date.now().toString(36)}`,
      name: 'New rate',
      rate: '0',
      type: 'custom',
      compound: false,
      label: null,
      includeInBreakdown: true,
      displayOrder: (sorted.at(-1)?.displayOrder ?? 0) + 10,
      active: true,
      builtin: false,
    };
    await saveTaxCode(code);
    push({ tone: 'success', title: 'Tax code added', description: 'Give it a name and a rate.' });
  };

  const remove = async () => {
    if (!deleting) return;
    await removeTaxCode(deleting.id);
    setDeleting(null);
    push({ tone: 'info', title: 'Tax code removed' });
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Tax codes"
        description="A code decides whether a line is taxed, and what the document must say about it."
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => void add()}
          >
            Add a code
          </Button>
        }
        flush
      >
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th align="right">Rate</Th>
              <Th>Treatment</Th>
              <Th>Marker</Th>
              <Th align="center">Shown</Th>
              <Th align="center">Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((code) => (
              <tr key={code.id}>
                <Td>
                  <TextInput
                    inputSize="sm"
                    value={code.name}
                    aria-label={`Name for ${code.name}`}
                    onChange={(e) => void save({ ...code, name: e.target.value })}
                  />
                </Td>
                <Td align="right">
                  <TextInput
                    inputSize="sm"
                    className="num text-right font-mono"
                    value={code.rate}
                    aria-label={`Rate for ${code.name}`}
                    onChange={(e) =>
                      void save({ ...code, rate: e.target.value.replace(/[^0-9.]/g, '') || '0' })
                    }
                  />
                </Td>
                <Td>
                  <Select
                    plain
                    inputSize="sm"
                    aria-label={`Treatment for ${code.name}`}
                    value={code.type}
                    onChange={(e) => {
                      const type = e.target.value as TaxCodeType;
                      void save({ ...code, type, compound: type === 'compound' });
                    }}
                  >
                    {TYPE_LABELS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <TextInput
                    inputSize="sm"
                    className="w-14 text-center"
                    value={code.label ?? ''}
                    placeholder="—"
                    aria-label={`Printed marker for ${code.name}`}
                    onChange={(e) => void save({ ...code, label: e.target.value || null })}
                  />
                </Td>
                <Td align="center">
                  <Checkbox
                    checked={code.includeInBreakdown}
                    label=""
                    ariaLabel={`Show ${code.name} in the tax breakdown`}
                    onChange={(v) => void save({ ...code, includeInBreakdown: v })}
                  />
                </Td>
                <Td align="center">
                  <Checkbox
                    checked={code.active}
                    label=""
                    ariaLabel={`${code.name} is active`}
                    onChange={(v) => void save({ ...code, active: v })}
                  />
                </Td>
                <Td align="right">
                  {!code.builtin && (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setDeleting(code)}
                    >
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Card>
        <h3 className="eyebrow">GST rounding</h3>
        <p className="-mt-1 mb-3 text-[12px] text-ink-muted">
          The ATO allows two methods. Both produce the same total for most invoices; they differ when a rate
          lands on a half-cent.
        </p>
        <div className="space-y-2">
          {ROUNDING_METHODS.map((method) => (
            <label
              key={method.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-rule p-3 transition-colors hover:border-rule-strong"
            >
              <input
                type="radio"
                name="rounding"
                checked={settings?.roundingMethod === method.id}
                onChange={() => settings && void saveSettings({ ...settings, roundingMethod: method.id })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-[13px] font-medium text-ink">{method.name}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">{method.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-ink-faint">
          GST 10% on $1,000 of exclusive sales is {formatRate('0.1')} — the default is the ATO's total invoice
          rule.
        </p>
      </Card>

      <Card>
        <h3 className="eyebrow">Tax invoice checks</h3>
        <div className="mt-2 space-y-2.5">
          <Checkbox
            checked={settings?.enforceTaxInvoiceRules ?? true}
            label="Block submitting a tax invoice that is missing required details"
            hint="The ATO requires seven details below $1,000 and a buyer identity at $1,000 and above."
            onChange={(v) => settings && void saveSettings({ ...settings, enforceTaxInvoiceRules: v })}
          />
          <Checkbox
            checked={settings?.warnOnMissingBuyerIdentity ?? true}
            label="Warn rather than block when the buyer identity is missing"
            onChange={(v) => settings && void saveSettings({ ...settings, warnOnMissingBuyerIdentity: v })}
          />
          <Checkbox
            checked={settings?.showNoGstNoteWhenUnregistered ?? true}
            label="Print “No GST has been charged” when a business is not registered"
            onChange={(v) => settings && void saveSettings({ ...settings, showNoGstNoteWhenUnregistered: v })}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title={`Remove ${deleting?.name ?? 'this tax code'}?`}
        confirmLabel="Remove"
        danger
        body="Documents already using it keep it. New documents will not be able to choose it."
      />
    </div>
  );
}
