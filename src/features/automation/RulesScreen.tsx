/**
 * The rules engine screen.
 *
 * The plan's item 5: a condition builder UI, with evaluation on save. Rules
 * run in the editor on save and in the scheduler for drafts left open — they
 * return a patch rather than mutating, so this screen is the builder and the
 * list, and the engine does the rest.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Rule, RuleActionType, RuleCondition, RuleField, RuleOperator } from '@/core/schemas/automation';
import { ruleSchema, RULE_FIELDS, RULE_OPERATORS, RULE_ACTIONS } from '@/core/schemas/automation';
import { newEntity } from '@/core/schemas/common';
import { useAppStore } from '@/state/app';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Panel,
  Select,
  Switch,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';

const FIELD_LABELS: Record<RuleField, string> = {
  'client.tag': 'Client tag',
  'client.country': 'Client country',
  'client.taxId': 'Client tax ID',
  'client.currency': 'Client currency',
  'client.defaultTaxCodeId': 'Client default tax code',
  'document.type': 'Document type',
  'document.currency': 'Document currency',
  'document.total': 'Document total',
  'document.subtotal': 'Document subtotal',
  'document.itemCount': 'Line count',
  'document.profileId': 'Business',
  'line.itemCategory': 'Item category',
  'line.taxCodeId': 'Line tax code',
  'line.type': 'Line type',
  'line.amount': 'Line amount',
};

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  greater_than: 'is greater than',
  less_than: 'is less than',
  in: 'is one of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const ACTION_LABELS: Record<RuleActionType, string> = {
  set_field: 'Set a field',
  set_tax_code: 'Set the tax code',
  set_currency: 'Set the currency',
  set_terms: 'Set the payment terms',
  set_discount_percent: 'Set the discount %',
  set_design_template: 'Set the design template',
  add_line_markup_percent: 'Add a markup % to lines',
  require_po_number: 'Require a PO number',
};

/** Operators that need no value. */
const NO_VALUE_OPERATORS: RuleOperator[] = ['is_empty', 'is_not_empty'];

export function RulesScreen() {
  const { push } = useToast();
  const rules = useAppStore((s) => s.rules);
  const saveRule = useAppStore((s) => s.saveRule);
  const removeRule = useAppStore((s) => s.removeRule);

  const [draft, setDraft] = useState<Rule | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const startNew = () => {
    const now = new Date().toISOString();
    setDraft(
      ruleSchema.parse({
        ...newEntity({}),
        createdAt: now,
        updatedAt: now,
        name: 'New rule',
        conditions: [{ field: 'client.country', operator: 'equals', value: '' }],
        actions: [{ type: 'set_tax_code', field: '', value: '' }],
      }),
    );
  };

  const startEdit = (rule: Rule) => setDraft(rule);

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = ruleSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveRule(parsed as Rule);
      push({ tone: 'success', title: 'Rule saved' });
      setDraft(null);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const remove = async (id: string) => {
    await removeRule(id);
    if (draft?.id === id) setDraft(null);
    setConfirmId(null);
    push({ tone: 'success', title: 'Rule deleted' });
  };

  const patch = (changes: Partial<Rule>) => setDraft(draft ? { ...draft, ...changes } : draft);

  const patchCondition = (index: number, changes: Partial<RuleCondition>) => {
    if (!draft) return;
    const conditions = draft.conditions.map((c, i) => (i === index ? { ...c, ...changes } : c));
    patch({ conditions });
  };

  const patchAction = (index: number, changes: Partial<Rule['actions'][number]>) => {
    if (!draft) return;
    const actions = draft.actions.map((a, i) => (i === index ? { ...a, ...changes } : a));
    patch({ actions });
  };

  const conditionsSummary = (rule: Rule): string =>
    rule.conditions
      .map((c) => `${FIELD_LABELS[c.field]} ${OPERATOR_LABELS[c.operator]}${c.value ? ` ${c.value}` : ''}`)
      .join(rule.match === 'all' ? ' AND ' : ' OR ');

  const actionsSummary = (rule: Rule): string =>
    rule.actions.map((a) => `${ACTION_LABELS[a.type]}${a.value ? ` → ${a.value}` : ''}`).join('; ');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Rules"
        subtitle="Conditions evaluated on save — on the draft you are editing, and on drafts the automation finds open."
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            New rule
          </Button>
        }
      />

      <Panel className="mt-4" flush>
        {rules.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No rules yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>If</Th>
                <Th>Then</Th>
                <Th>Fired</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr
                  key={rule.id}
                  className="cursor-pointer hover:bg-paper-sunken"
                  onClick={() => startEdit(rule)}
                >
                  <Td className="font-medium text-ink">
                    {rule.name} {!rule.enabled && <Badge>off</Badge>}{' '}
                    {rule.builtin && <Badge>built-in</Badge>}
                  </Td>
                  <Td className="max-w-72 text-[13px] text-ink-muted">{conditionsSummary(rule)}</Td>
                  <Td className="max-w-64 text-[13px] text-ink-muted">{actionsSummary(rule)}</Td>
                  <Td className="text-ink-muted">{rule.fireCount}</Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setConfirmId(rule.id)}
                    >
                      Delete
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {draft && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 font-medium text-ink">
            {rules.some((r) => r.id === draft.id) ? `Edit ${draft.name}` : 'New rule'}
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Match" hint="Whether every condition must hold, or any one of them.">
                <Select
                  value={draft.match}
                  onChange={(e) => patch({ match: e.target.value as Rule['match'] })}
                >
                  <option value="all">All conditions</option>
                  <option value="any">Any condition</option>
                </Select>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">If</p>
              <div className="grid gap-2">
                {draft.conditions.map((condition, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <Select
                      value={condition.field}
                      onChange={(e) => patchCondition(index, { field: e.target.value as RuleField })}
                      className="max-w-52"
                    >
                      {RULE_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={condition.operator}
                      onChange={(e) => patchCondition(index, { operator: e.target.value as RuleOperator })}
                      className="max-w-44"
                    >
                      {RULE_OPERATORS.map((operator) => (
                        <option key={operator} value={operator}>
                          {OPERATOR_LABELS[operator]}
                        </option>
                      ))}
                    </Select>
                    {!NO_VALUE_OPERATORS.includes(condition.operator) && (
                      <TextInput
                        value={condition.value}
                        onChange={(e) => patchCondition(index, { value: e.target.value })}
                        placeholder="Value"
                        className="max-w-56"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      disabled={draft.conditions.length === 1}
                      onClick={() => patch({ conditions: draft.conditions.filter((_, i) => i !== index) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-3.5" aria-hidden />}
                className="mt-2"
                onClick={() =>
                  patch({
                    conditions: [...draft.conditions, { field: 'client.tag', operator: 'equals', value: '' }],
                  })
                }
              >
                Add condition
              </Button>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                Then
              </p>
              <div className="grid gap-2">
                {draft.actions.map((action, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <Select
                      value={action.type}
                      onChange={(e) => patchAction(index, { type: e.target.value as RuleActionType })}
                      className="max-w-56"
                    >
                      {RULE_ACTIONS.map((actionType) => (
                        <option key={actionType} value={actionType}>
                          {ACTION_LABELS[actionType]}
                        </option>
                      ))}
                    </Select>
                    {action.type === 'set_field' && (
                      <TextInput
                        value={action.field}
                        onChange={(e) => patchAction(index, { field: e.target.value })}
                        placeholder="Field name"
                        className="max-w-44"
                      />
                    )}
                    <TextInput
                      value={action.value}
                      onChange={(e) => patchAction(index, { value: e.target.value })}
                      placeholder="Value"
                      className="max-w-56"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      disabled={draft.actions.length === 1}
                      onClick={() => patch({ actions: draft.actions.filter((_, i) => i !== index) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-3.5" aria-hidden />}
                className="mt-2"
                onClick={() =>
                  patch({ actions: [...draft.actions, { type: 'set_field', field: '', value: '' }] })
                }
              >
                Add action
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Switch checked={draft.enabled} onChange={(v) => patch({ enabled: v })} label="Enabled" />
              <Switch
                checked={draft.stopOnMatch}
                onChange={(v) => patch({ stopOnMatch: v })}
                label="Stop on match"
                hint="Lower-priority rules do not run."
              />
              <Field label="Priority" inline>
                <TextInput
                  value={String(draft.priority)}
                  onChange={(e) => patch({ priority: Number(e.target.value) || 100 })}
                  className="max-w-24"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save rule
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this rule?"
        body="Built-in rules come back when the app re-seeds; custom rules are gone."
        confirmLabel="Delete"
      />
    </div>
  );
}
