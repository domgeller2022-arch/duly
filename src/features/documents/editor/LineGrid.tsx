/**
 * The line-item grid.
 *
 * Every line type in one keyboard-first grid: item and time lines with quantity,
 * unit, price and discount; expense lines entered as an amount with an optional
 * markup; discount and surcharge lines; and section headings and notes that group
 * and annotate without carrying a value.
 *
 * Keyboard is the primary input, because that is what makes the second invoice
 * fast: Tab moves across a row, Enter at the end of the last row adds the next
 * one, and typing in the description opens the catalogue with Enter to accept.
 */

import { useCallback, useMemo, useRef } from 'react';
import { AlertCircle, ChevronRight, GripVertical, Hash, Percent, Plus, Trash2, Type } from 'lucide-react';
import type { DocumentLine } from '@/core/schemas';
import type { CalculationResult } from '@/core/calc/calculate';
import { useEditorStore } from './editorStore';
import { createLine, insertDiscount, insertNote, insertSection, type CatalogueMatch } from '@/core/documents';
import {
  Badge,
  Button,
  Chip,
  CurrencyInput,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  NumberInput,
  Select,
  TextInput,
  Tooltip,
} from '@/ui/components/base';
import { money } from '@/ui/lib/format';
import { cn } from '@/ui/lib/cn';

/* ------------------------------------------------------------------ */
/* Column visibility                                                   */
/* ------------------------------------------------------------------ */

export interface ColumnSet {
  position: boolean;
  details: boolean;
  quantity: boolean;
  unit: boolean;
  unitPrice: boolean;
  discount: boolean;
  taxCode: boolean;
  taxAmount: boolean;
  amount: boolean;
}

const LINE_TYPE_LABELS: Record<DocumentLine['type'], string> = {
  item: 'Item',
  time: 'Time',
  expense: 'Expense',
  section: 'Section',
  note: 'Note',
  discount: 'Discount',
};

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

let dragLineId: string | null = null;

export function LineGrid({
  columns,
  onAddSection,
  onAddNote,
  onAddDiscount,
}: {
  columns: ColumnSet;
  onAddSection?: () => void;
  onAddNote?: () => void;
  onAddDiscount?: () => void;
}) {
  const document = useEditorStore((s) => s.document);
  const lines = useEditorStore((s) => s.lines);
  const result = useEditorStore((s) => s.result);
  const activeLineId = useEditorStore((s) => s.activeLineId);
  const suggestions = useEditorStore((s) => s.suggestions);
  const collapsedSections = useEditorStore((s) => s.collapsedSections);
  const dirty = useEditorStore((s) => s.dirty);

  const setActiveLine = useEditorStore((s) => s.setActiveLine);
  const addLine = useEditorStore((s) => s.addLine);
  const patchLine = useEditorStore((s) => s.patchLine);
  const removeLine = useEditorStore((s) => s.removeLine);
  const moveLineTo = useEditorStore((s) => s.moveLineTo);
  const duplicateLine = useEditorStore((s) => s.duplicateLine);
  const replaceLines = useEditorStore((s) => s.replaceLines);
  const toggleSection = useEditorStore((s) => s.toggleSection);
  const setDescriptionDraft = useEditorStore((s) => s.setDescriptionDraft);
  const chooseSuggestion = useEditorStore((s) => s.chooseSuggestion);
  const moveSuggestion = useEditorStore((s) => s.moveSuggestion);
  const closeSuggestions = useEditorStore((s) => s.closeSuggestions);

  const locked = document?.status !== 'draft';
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  /** Visible lines, honouring collapsed sections. */
  const visible = useMemo(() => {
    const out: { line: DocumentLine; depth: number }[] = [];
    let depth = 0;

    for (const line of lines) {
      if (line.type === 'section') {
        depth = 0;
        const collapsed = collapsedSections.has(line.id);
        out.push({ line, depth: 0 });
        depth = 1;
        void collapsed;
        continue;
      }
      out.push({ line, depth });
    }

    // Second pass to drop the body of collapsed sections.
    const filtered: { line: DocumentLine; depth: number }[] = [];
    let skipping = false;
    for (const entry of out) {
      if (entry.line.type === 'section') {
        skipping = collapsedSections.has(entry.line.id);
        filtered.push(entry);
        continue;
      }
      if (!skipping) filtered.push(entry);
    }
    return filtered;
  }, [lines, collapsedSections]);

  /** Add the next line after the active one, or append. */
  const addNextLine = useCallback(() => {
    if (!document || locked) return;
    const index = activeLineId ? lines.findIndex((l) => l.id === activeLineId) : lines.length - 1;
    const line = createLine({ document, position: index + 1 });
    addLine(line, index + 1);
    window.setTimeout(() => focusDescription(line.id), 0);
  }, [document, locked, activeLineId, lines, addLine]);

  return (
    <div className="relative" ref={bodyRef}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-rule">
            {columns.position && <ThCell width="28px" />}
            <ThCell>Description</ThCell>
            {columns.quantity && (
              <ThCell width="80px" align="right">
                Qty
              </ThCell>
            )}
            {columns.unit && <ThCell width="76px">Unit</ThCell>}
            {columns.unitPrice && (
              <ThCell width="116px" align="right">
                Price
              </ThCell>
            )}
            {columns.discount && (
              <ThCell width="86px" align="right">
                Disc.
              </ThCell>
            )}
            {columns.taxCode && <ThCell width="96px">Tax</ThCell>}
            {columns.amount && (
              <ThCell width="116px" align="right">
                Amount
              </ThCell>
            )}
            <ThCell width="36px" />
          </tr>
        </thead>

        <tbody
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const tr = (e.target as HTMLElement).closest('tr[data-line-id]');
            if (!tr) return;
            const from = lines.findIndex((l) => l.id === (dragLineId ?? dragId.current));
            const to = lines.findIndex((l) => l.id === tr.getAttribute('data-line-id'));
            if (from >= 0 && to >= 0) moveLineTo(from, to);
            dragId.current = null;
          }}
        >
          {visible.map(({ line, depth }, rowIndex) => {
            if (line.type === 'section') {
              return (
                <SectionRow
                  key={line.id}
                  line={line}
                  result={result}
                  locked={locked}
                  collapsed={collapsedSections.has(line.id)}
                  onToggle={() => toggleSection(line.id)}
                  onPatch={(patch) => patchLine(line.id, patch)}
                  columns={columns}
                />
              );
            }

            if (line.type === 'note') {
              return (
                <NoteRow
                  key={line.id}
                  line={line}
                  locked={locked}
                  onPatch={(patch) => patchLine(line.id, patch)}
                  onRemove={() => removeLine(line.id)}
                />
              );
            }

            if (line.type === 'discount') {
              return (
                <DiscountRow
                  key={line.id}
                  line={line}
                  result={result}
                  locked={locked}
                  onPatch={(patch) => patchLine(line.id, patch)}
                  onRemove={() => removeLine(line.id)}
                />
              );
            }

            const comp = result?.lines.get(line.id);
            const incomplete = result?.incompleteLineIds.includes(line.id);
            const isActive = activeLineId === line.id;

            return (
              <tr
                key={line.id}
                data-line-id={line.id}
                className={cn(
                  'group border-b border-rule transition-colors',
                  isActive && 'bg-accent-soft/30',
                  depth > 0 && 'bg-paper-sunken/40',
                  !locked && 'hover:bg-paper-sunken/60',
                )}
              >
                {/* Drag handle / row menu */}
                <td
                  className="w-7 py-1 pl-1 align-middle"
                  draggable={!locked}
                  onDragStart={() => {
                    dragId.current = line.id;
                    dragLineId = line.id;
                  }}
                  onDragEnd={() => {
                    dragId.current = null;
                    dragLineId = null;
                  }}
                >
                  <RowMenu
                    line={line}
                    locked={locked}
                    onDuplicate={() => duplicateLine(line.id)}
                    onRemove={() => removeLine(line.id)}
                    onAddBelow={() => {
                      const line2 = document ? createLine({ document, position: rowIndex + 1 }) : null;
                      if (line2) addLine(line2, rowIndex + 1);
                    }}
                    onAddSection={() => replaceLines(insertSection(lines, rowIndex, 'New section'), 'Add section')}
                    onAddNote={() => replaceLines(insertNote(lines, rowIndex, ''), 'Add note')}
                    onAddDiscount={() =>
                      replaceLines(insertDiscount(lines, rowIndex, { kind: 'discount', percent: '5' }), 'Add discount')
                    }
                  />
                </td>

                {/* Description with catalogue autocomplete */}
                <td className="py-1 pr-2 align-middle">
                  <div className="relative">
                    <TextInput
                      data-field="description"
                      data-autocomplete={suggestions.length > 0 ? 'true' : 'false'}
                      value={line.description}
                      disabled={locked}
                      placeholder={
                        line.type === 'time'
                          ? 'What was done?'
                          : line.type === 'expense'
                            ? 'What was the expense?'
                            : 'Describe the work or product'
                      }
                      onFocus={() => setActiveLine(line.id)}
                      onChange={(e) => {
                        setActiveLine(line.id);
                        setDescriptionDraft(line.id, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (suggestions.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            moveSuggestion(1);
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            moveSuggestion(-1);
                            return;
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            chooseSuggestion(
                              suggestions[useEditorStore.getState().autocompleteIndex] ?? suggestions[0],
                            );
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            closeSuggestions();
                            return;
                          }
                        }

                        if (e.key === 'Enter') {
                          // Enter on the description starts the next line, which
                          // is what makes typing a whole invoice a single pass.
                          e.preventDefault();
                          addNextLine();
                        }
                      }}
                      onBlur={() => window.setTimeout(closeSuggestions, 120)}
                      className={cn(incomplete && 'border-due')}
                    />

                    {incomplete && (
                      <Tooltip label="This line has no description" side="bottom">
                        <span className="absolute top-1/2 right-6 -translate-y-1/2 text-due">
                          <AlertCircle className="size-3.5" aria-hidden />
                        </span>
                      </Tooltip>
                    )}

                    {suggestions.length > 0 && (
                      <CatalogueList
                        onChoose={(match) => {
                          chooseSuggestion(match);
                          window.setTimeout(() => focusDescription(line.id), 0);
                        }}
                      />
                    )}
                  </div>

                  {line.notes && (
                    <TextInput
                      value={line.notes}
                      disabled={locked}
                      onChange={(e) => patchLine(line.id, { notes: e.target.value })}
                      placeholder="Extra detail, printed under the description"
                      className="mt-1 h-6 text-[11px]"
                    />
                  )}
                </td>

                {/* Quantity */}
                {columns.quantity && (
                  <td className="py-1 pr-2 align-middle">
                    {line.type === 'expense' ? (
                      <span className="block text-right text-[12px] text-ink-faint">—</span>
                    ) : (
                      <NumberInput
                        value={line.quantity}
                        disabled={locked}
                        ariaLabel={`Quantity for ${line.description || 'line'}`}
                        onChange={(value) => patchLine(line.id, { quantity: value })}
                        className="h-7 text-[12px]"
                      />
                    )}
                  </td>
                )}

                {/* Unit */}
                {columns.unit && (
                  <td className="py-1 pr-2 align-middle">
                    <Select
                      inputSize="sm"
                      plain
                      disabled={locked}
                      value={line.unit}
                      aria-label={`Unit for ${line.description || 'line'}`}
                      onChange={(e) => patchLine(line.id, { unit: e.target.value })}
                      className="h-7 border-transparent bg-transparent px-1 text-[12px] hover:border-rule"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                  </td>
                )}

                {/* Unit price or amount */}
                {columns.unitPrice && (
                  <td className="py-1 pr-2 align-middle">
                    {line.type === 'expense' ? (
                      <CurrencyInput
                        value={line.amountOverride ?? 0}
                        currency={document?.currency ?? 'AUD'}
                        disabled={locked}
                        ariaLabel={`Amount for ${line.description || 'expense'}`}
                        onChange={(minor) => patchLine(line.id, { amountOverride: minor })}
                        className="h-7 text-[12px]"
                      />
                    ) : (
                      <CurrencyInput
                        value={line.unitPrice}
                        currency={document?.currency ?? 'AUD'}
                        disabled={locked}
                        ariaLabel={`Unit price for ${line.description || 'line'}`}
                        onChange={(minor) => patchLine(line.id, { unitPrice: minor })}
                        className="h-7 text-[12px]"
                      />
                    )}
                  </td>
                )}

                {/* Discount */}
                {columns.discount && (
                  <td className="py-1 pr-2 align-middle">
                    {line.type === 'expense' ? (
                      <ExpenseMarkupInput
                        value={line.markupPercent}
                        disabled={locked}
                        onChange={(value) => patchLine(line.id, { markupPercent: value })}
                      />
                    ) : (
                      <LineDiscountInput
                        line={line}
                        disabled={locked}
                        onPatch={(patch) => patchLine(line.id, patch)}
                      />
                    )}
                  </td>
                )}

                {/* Tax code */}
                {columns.taxCode && (
                  <td className="py-1 pr-2 align-middle">
                    <TaxCodeSelect
                      line={line}
                      disabled={locked}
                      onChange={(taxCodeId) => patchLine(line.id, { taxCodeId })}
                    />
                  </td>
                )}

                {/* Amount */}
                {columns.amount && (
                  <td className="py-1 pr-2 text-right align-middle">
                    <span className="num text-[13px] font-medium text-ink">
                      {money(comp?.gross ?? 0, document?.currency ?? 'AUD')}
                    </span>
                    {comp && comp.tax !== 0 && (
                      <span className="num block text-[10px] text-ink-faint">
                        {line.taxCodeId === 'tax_gst'
                          ? `GST ${money(comp.tax, document?.currency ?? 'AUD')}`
                          : 'no tax'}
                      </span>
                    )}
                  </td>
                )}

                <td className="w-8 py-1 pr-1 align-middle">
                  {!locked && (
                    <IconButton
                      label={`Remove ${line.description || 'line'}`}
                      size="sm"
                      onClick={() => removeLine(line.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ---- add row ---- */}
      {!locked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={addNextLine}>
            Add line
          </Button>
          {onAddSection && (
            <Button
              size="sm"
              variant="ghost"
              icon={<GripVertical className="size-3.5" aria-hidden />}
              onClick={onAddSection}
            >
              Section
            </Button>
          )}
          {onAddNote && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Type className="size-3.5" aria-hidden />}
              onClick={onAddNote}
            >
              Note
            </Button>
          )}
          {onAddDiscount && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Percent className="size-3.5" aria-hidden />}
              onClick={onAddDiscount}
            >
              Discount
            </Button>
          )}
          {dirty && <Badge className="ml-auto bg-due-soft text-due">Unsaved</Badge>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row menu                                                            */
/* ------------------------------------------------------------------ */

function RowMenu({
  line,
  locked,
  onDuplicate,
  onRemove,
  onAddBelow,
  onAddSection,
  onAddNote,
  onAddDiscount,
}: {
  line: DocumentLine;
  locked: boolean;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddBelow: () => void;
  onAddSection: () => void;
  onAddNote: () => void;
  onAddDiscount: () => void;
}) {
  return (
    <Menu
      align="start"
      trigger={
        <span className="flex h-6 w-6 cursor-grab items-center justify-center rounded-[4px] text-ink-faint opacity-40 transition-opacity hover:bg-paper-sunken hover:opacity-100">
          <GripVertical className="size-3.5" aria-hidden />
        </span>
      }
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
        {LINE_TYPE_LABELS[line.type]}
      </div>
      <MenuSeparator />
      {!locked && (
        <>
          <MenuItem icon={<Plus className="size-3.5" aria-hidden />} onClick={onAddBelow}>
            Add line below
          </MenuItem>
          <MenuItem icon={<Hash className="size-3.5" aria-hidden />} onClick={onAddSection}>
            Add section here
          </MenuItem>
          <MenuItem icon={<Type className="size-3.5" aria-hidden />} onClick={onAddNote}>
            Add note here
          </MenuItem>
          <MenuItem icon={<Percent className="size-3.5" aria-hidden />} onClick={onAddDiscount}>
            Add discount {line.type === 'section' ? '(applies to the section above)' : 'here'}
          </MenuItem>
          <MenuItem onClick={onDuplicate}>Duplicate this line</MenuItem>
          <MenuSeparator />
        </>
      )}
      {!locked && (
        <MenuItem danger icon={<Trash2 className="size-3.5" aria-hidden />} onClick={onRemove}>
          Remove line
        </MenuItem>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------------ */
/* Section row                                                         */
/* ------------------------------------------------------------------ */

function SectionRow({
  line,
  result,
  locked,
  collapsed,
  onToggle,
  onPatch,
  columns,
}: {
  line: DocumentLine;
  result: CalculationResult | null;
  locked: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<DocumentLine>) => void;
  columns: ColumnSet;
}) {
  const section = result?.sections.find((s) => s.id === line.id);
  const document = useEditorStore((s) => s.document);

  return (
    <tr data-line-id={line.id} className="border-b border-rule bg-paper-sunken/70">
      <td
        className="w-7 py-1 pl-1"
        draggable={!locked}
        onDragStart={() => {
          dragLineId = line.id;
        }}
        onDragEnd={() => {
          dragLineId = null;
        }}
      />
      <td className="py-1.5 pr-2" colSpan={countValueColumns(columns) + 1}>
        <div className="flex items-center gap-2">
          <IconButton label={collapsed ? 'Expand section' : 'Collapse section'} size="sm" onClick={onToggle}>
            <ChevronRight
              className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
              aria-hidden
            />
          </IconButton>
          <TextInput
            value={line.description}
            disabled={locked}
            aria-label="Section heading"
            placeholder="Section heading"
            onChange={(e) => onPatch({ description: e.target.value })}
            className="h-7 max-w-sm bg-transparent px-1 font-medium"
          />
          {line.showSubtotal && section && section.subtotal !== 0 && (
            <span className="num ml-auto text-[12px] text-ink-muted">
              {money(section.subtotal, document?.currency ?? 'AUD')}
            </span>
          )}
        </div>
      </td>
      {columns.position && <td />}
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Note row                                                            */
/* ------------------------------------------------------------------ */

function NoteRow({
  line,
  locked,
  onPatch,
  onRemove,
}: {
  line: DocumentLine;
  locked: boolean;
  onPatch: (patch: Partial<DocumentLine>) => void;
  onRemove: () => void;
}) {
  return (
    <tr data-line-id={line.id} className="group border-b border-rule">
      <td
        className="w-7 py-1 pl-1"
        draggable={!locked}
        onDragStart={() => {
          dragLineId = line.id;
        }}
        onDragEnd={() => {
          dragLineId = null;
        }}
      />
      <td className="py-1 pr-2" colSpan={8}>
        <div className="flex items-center gap-2">
          <Type className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <TextInput
            value={line.description}
            disabled={locked}
            aria-label="Note text"
            placeholder="A note printed on the document — no amount"
            onChange={(e) => onPatch({ description: e.target.value })}
            className="h-7 flex-1 border-transparent bg-transparent px-1 italic"
          />
          {!locked && (
            <IconButton
              label="Remove note"
              size="sm"
              onClick={onRemove}
              className="opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Discount row                                                        */
/* ------------------------------------------------------------------ */

function DiscountRow({
  line,
  result,
  locked,
  onPatch,
  onRemove,
}: {
  line: DocumentLine;
  result: CalculationResult | null;
  locked: boolean;
  onPatch: (patch: Partial<DocumentLine>) => void;
  onRemove: () => void;
}) {
  const document = useEditorStore((s) => s.document);
  const comp = result?.lines.get(line.id);
  const appliesToSection = Boolean(line.appliesToSectionId);

  return (
    <tr data-line-id={line.id} className="group border-b border-rule bg-due-soft/25">
      <td
        className="w-7 py-1 pl-1"
        draggable={!locked}
        onDragStart={() => {
          dragLineId = line.id;
        }}
        onDragEnd={() => {
          dragLineId = null;
        }}
      />
      <td className="py-1 pr-2" colSpan={4}>
        <div className="flex items-center gap-2">
          <Percent className="size-3.5 shrink-0 text-due" aria-hidden />
          <TextInput
            value={line.description}
            disabled={locked}
            aria-label="Discount description"
            placeholder={line.discountDirection === 'surcharge' ? 'Surcharge' : 'Discount'}
            onChange={(e) => onPatch({ description: e.target.value })}
            className="h-7 max-w-xs border-transparent bg-transparent px-1"
          />
          <NumberInput
            value={line.discountValue}
            disabled={locked}
            ariaLabel="Discount percentage"
            onChange={(value) => onPatch({ discountValue: value })}
            className="h-7 w-16 text-[12px]"
          />
          <span className="text-[12px] text-ink-muted">%</span>
          <Select
            inputSize="sm"
            plain
            disabled={locked}
            value={line.discountDirection}
            aria-label="Discount or surcharge"
            onChange={(e) => onPatch({ discountDirection: e.target.value as 'discount' | 'surcharge' })}
            className="h-7 w-32 border-transparent bg-transparent px-1 text-[12px]"
          >
            <option value="discount">Discount</option>
            <option value="surcharge">Surcharge</option>
          </Select>
          {appliesToSection && <Chip tone="due">This section only</Chip>}
        </div>
      </td>
      <td className="py-1 pr-2 text-right align-middle" colSpan={3}>
        <span className="num text-[13px] font-medium text-ink">
          {money(comp?.documentDiscountShare ?? comp?.sectionDiscountShare ?? 0, document?.currency ?? 'AUD')}
        </span>
      </td>
      <td className="w-8 py-1 pr-1">
        {!locked && (
          <IconButton
            label="Remove discount"
            size="sm"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </IconButton>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Cell inputs                                                         */
/* ------------------------------------------------------------------ */

function LineDiscountInput({
  line,
  disabled,
  onPatch,
}: {
  line: DocumentLine;
  disabled: boolean;
  onPatch: (patch: Partial<DocumentLine>) => void;
}) {
  if (line.discountType === 'none') {
    return (
      <IconButton
        label="Add a line discount"
        size="sm"
        disabled={disabled}
        onClick={() => onPatch({ discountType: 'percent', discountValue: '10' })}
        className="w-full"
      >
        <span className="text-[11px] text-ink-faint">Add</span>
      </IconButton>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <NumberInput
        value={line.discountValue}
        disabled={disabled}
        ariaLabel="Line discount"
        onChange={(value) => onPatch({ discountValue: value })}
        className="h-7 w-14 text-[12px]"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPatch({ discountType: line.discountType === 'percent' ? 'fixed' : 'percent' })}
        className="shrink-0 rounded-[4px] px-1 text-[11px] text-ink-muted hover:bg-paper-sunken"
        title={
          line.discountType === 'percent'
            ? 'Percentage — click for a fixed amount'
            : 'Fixed amount — click for a percentage'
        }
      >
        {line.discountType === 'percent' ? '%' : '$'}
      </button>
    </div>
  );
}

function ExpenseMarkupInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <NumberInput
        value={value}
        disabled={disabled}
        ariaLabel="Markup percentage"
        onChange={onChange}
        className="h-7 w-12 text-[12px]"
        placeholder="0"
      />
      <span className="shrink-0 text-[11px] text-ink-faint">%</span>
    </div>
  );
}

function TaxCodeSelect({
  line,
  disabled,
  onChange,
}: {
  line: DocumentLine;
  disabled: boolean;
  onChange: (taxCodeId: string | null) => void;
}) {
  const taxCodes = useEditorStore((s) => s.taxCodes);
  return (
    <Select
      inputSize="sm"
      plain
      disabled={disabled}
      value={line.taxCodeId ?? ''}
      aria-label="Tax code"
      onChange={(e) => onChange(e.target.value || null)}
      className="h-7 border-transparent bg-transparent px-1 text-[12px] hover:border-rule"
    >
      <option value="">Document default</option>
      {taxCodes
        .filter((c) => c.active)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.label ? `${c.name} (${c.label})` : c.name}
          </option>
        ))}
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Catalogue autocomplete                                              */
/* ------------------------------------------------------------------ */

function CatalogueList({ onChoose }: { onChoose: (match: CatalogueMatch) => void }) {
  const suggestions = useEditorStore((s) => s.suggestions);
  const index = useEditorStore((s) => s.autocompleteIndex);

  if (suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      className="sheet animate-rise absolute top-full left-0 z-30 mt-0.5 max-h-64 w-full min-w-72 overflow-y-auto scroll-quiet p-1"
    >
      {suggestions.map((match, i) => (
        <button
          key={`${match.kind}-${match.label}-${i}`}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(match);
          }}
          onMouseEnter={() => useEditorStore.setState({ autocompleteIndex: i })}
          className={cn(
            'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left',
            i === index ? 'bg-accent-soft' : 'hover:bg-paper-sunken',
          )}
        >
          <Badge className={match.kind === 'item' ? 'bg-accent-soft text-accent' : undefined}>
            {match.kind === 'item' ? 'Catalogue' : 'Recent'}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{match.label}</span>
          {match.detail && <span className="shrink-0 text-[11px] text-ink-faint">{match.detail}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cell chrome                                                         */
/* ------------------------------------------------------------------ */

function ThCell({
  children,
  width,
  align = 'left',
}: {
  children?: React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'px-1 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-faint uppercase',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

const UNITS = ['each', 'hour', 'day', 'week', 'month', 'km', 'kg', 'm²', 'm³', 'item', 'fixed'];

function focusDescription(lineId: string): void {
  const row = document.querySelector(`[data-line-id="${lineId}"]`);
  const input = row?.querySelector<HTMLInputElement>('input[data-field="description"]');
  input?.focus();
  input?.select();
}

/** Columns that carry a value, for a section row's colSpan. */
function countValueColumns(columns: ColumnSet): number {
  let count = 1; // description
  if (columns.quantity) count += 1;
  if (columns.unit) count += 1;
  if (columns.unitPrice) count += 1;
  if (columns.discount) count += 1;
  if (columns.taxCode) count += 1;
  if (columns.amount) count += 1;
  return count;
}
