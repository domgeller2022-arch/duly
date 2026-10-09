/**
 * The item catalogue.
 *
 * One table with inline editing, because the plan's screen inventory has a single
 * row for it — "Table with inline edit, multi-currency prices, import CSV" — and a
 * catalogue is a lookup rather than a document. Editing in place means comparing an
 * item against another never costs a navigation.
 *
 * Prices are the `prices` map the schema already has: one entry per currency, in
 * minor units. The home currency gets its own column; other currencies are added
 * through a small control, because a column per currency would be 180 columns.
 *
 * Inactive items stay in the catalogue and are hidden from every picker in the app,
 * which is the behaviour the plan describes: "inactive items hidden from pickers".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import type { Item } from '@/core/schemas';
import { UNITS } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { getCurrency } from '@/core/money/currencies';
import { itemPriceFor } from '@/core/documents';
import { useAppStore } from '@/state/app';
import {
  Button,
  Card,
  Checkbox,
  CurrencyInput,
  EmptyState,
  Field,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { FilterBar, PageHeader } from '@/ui/components/layout';
import { countLabel, money } from '@/ui/lib/format';
import { CsvImportDialog } from '@/features/import/CsvImportDialog';

export function ItemsScreen({ startNew = false }: { startNew?: boolean }) {
  const { push } = useToast();
  const items = useAppStore((s) => s.items);
  const settings = useAppStore((s) => s.settings);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const saveItem = useAppStore((s) => s.saveItem);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingOtherCurrency, setEditingOtherCurrency] = useState<string | null>(null);
  const addedForNew = useRef(false);

  const currency =
    profiles.find((p) => p.id === activeProfileId)?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((item) => (showInactive ? true : item.active))
      .filter((item) => (category ? item.category === category : true))
      .filter((item) => {
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, search, category, showInactive]);

  /**
   * Save on change rather than on blur.
   *
   * A cell is a small, independent field, and the storage adapter already validates
   * every write, so there is nothing to batch. Blur-saving would lose an edit if the
   * user navigated away mid-cell, which is the failure worth avoiding.
   */
  const save = (item: Item) => {
    void saveItem(item).catch((error: unknown) => {
      push({
        tone: 'error',
        title: 'That item could not be saved',
        description: error instanceof Error ? error.message : '',
      });
    });
  };

  const edit = (item: Item, changes: Partial<Item>) => save({ ...item, ...changes });

  const addItem = async () => {
    const item = newEntity({
      code: '',
      name: '',
      description: '',
      unit: 'each',
      prices: {},
      taxCodeId: null,
      category: '',
      cost: 0,
      active: true,
      customFields: {},
    }) as Item;
    await saveItem(item);
    setSearch('');
    setCategory('');
  };

  // `/items/new` opens the catalogue with a blank row ready to name. Once, because
  // an effect that runs on every render would add a row on every render.
  useEffect(() => {
    if (!startNew || addedForNew.current) return;
    addedForNew.current = true;
    void addItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-print="hide">
      <PageHeader
        title="Item catalogue"
        subtitle={countLabel(rows.length, 'item')}
        actions={
          <>
            <Button icon={<Upload className="size-3.5" aria-hidden />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => void addItem()}
            >
              New item
            </Button>
          </>
        }
        className="mb-4"
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Name, code or description"
        className="mb-3"
      >
        <Select
          aria-label="Filter by category"
          value={category}
          className="w-44"
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant={showInactive ? 'quiet' : 'ghost'}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? 'Hiding inactive' : 'Include inactive'}
        </Button>
      </FilterBar>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Search className="size-7" aria-hidden />}
            title={search || category ? 'Nothing matches' : 'The catalogue is empty'}
            hint={
              search || category
                ? 'Clear the search or choose another category.'
                : 'An item is anything you invoice repeatedly — a day rate, an hourly rate, a product. Add one and it is one keystroke away on every invoice.'
            }
            action={
              search || category ? (
                <Button
                  onClick={() => {
                    setSearch('');
                    setCategory('');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void addItem()}>
                  Add your first item
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Unit</Th>
                <Th>Category</Th>
                <Th align="right">Price ({currency})</Th>
                <Th>Other prices</Th>
                <Th align="center">Active</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  editingOtherCurrency={editingOtherCurrency === item.id}
                  onEdit={(changes) => edit(item, changes)}
                  onToggleOtherCurrency={() =>
                    setEditingOtherCurrency((current) => (current === item.id ? null : item.id))
                  }
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-[12px] text-ink-faint">
        Inactive items stay here and are hidden from every picker in Duly. Edits save when you click away.
      </p>

      {importing && <CsvImportDialog entity="item" onClose={() => setImporting(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One row                                                            */
/* ------------------------------------------------------------------ */

function ItemRow({
  item,
  currency,
  editingOtherCurrency,
  onEdit,
  onToggleOtherCurrency,
}: {
  item: Item;
  currency: string;
  editingOtherCurrency: boolean;
  onEdit: (changes: Partial<Item>) => void;
  onToggleOtherCurrency: () => void;
}) {
  const price = itemPriceFor(item, currency) ?? 0;
  const others = Object.entries(item.prices).filter(([code]) => code !== currency);
  const unnamed = !item.name.trim();

  return (
    <>
      <tr className={unnamed ? 'bg-accent-soft/40' : undefined}>
        <Td>
          <TextInput
            inputSize="sm"
            value={item.name}
            placeholder="Consulting — hourly"
            aria-label={`Name of ${item.name || 'the new item'}`}
            onChange={(e) => onEdit({ name: e.target.value })}
          />
          <TextInput
            inputSize="sm"
            className="mt-1 text-ink-muted"
            value={item.description}
            placeholder="Shown under the name on the invoice"
            aria-label={`Description of ${item.name || 'the new item'}`}
            onChange={(e) => onEdit({ description: e.target.value })}
          />
        </Td>
        <Td>
          <TextInput
            inputSize="sm"
            monospace
            className="w-24"
            value={item.code}
            aria-label={`Code of ${item.name || 'the new item'}`}
            onChange={(e) => onEdit({ code: e.target.value.toUpperCase() })}
          />
        </Td>
        <Td>
          <Select
            plain
            inputSize="sm"
            aria-label={`Unit of ${item.name || 'the new item'}`}
            value={item.unit}
            onChange={(e) => onEdit({ unit: e.target.value })}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </Select>
        </Td>
        <Td>
          <TextInput
            inputSize="sm"
            value={item.category}
            placeholder="Consulting"
            aria-label={`Category of ${item.name || 'the new item'}`}
            onChange={(e) => onEdit({ category: e.target.value })}
          />
        </Td>
        <Td>
          <CurrencyInput
            id={`price-${item.id}`}
            currency={currency}
            value={price}
            ariaLabel={`Price of ${item.name || 'the new item'} in ${currency}`}
            onChange={(minor) => {
              const prices = { ...item.prices };
              if (minor === 0) delete prices[currency];
              else prices[currency] = minor;
              onEdit({ prices });
            }}
          />
        </Td>
        <Td>
          <span className="flex flex-wrap items-center gap-1">
            {others.length === 0 && <span className="text-ink-faint">—</span>}
            {others.map(([code, minor]) => (
              <button
                key={code}
                type="button"
                title={`Remove the ${code} price`}
                onClick={() => {
                  const prices = { ...item.prices };
                  delete prices[code];
                  onEdit({ prices });
                }}
                className="rounded-[6px] bg-paper-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition-colors hover:bg-overdue-soft hover:text-overdue"
              >
                {code} {money(minor, code)}
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={onToggleOtherCurrency}>
              {others.length === 0 ? 'Add' : 'Edit'}
            </Button>
          </span>
        </Td>
        <Td align="center">
          <Checkbox
            checked={item.active}
            label=""
            ariaLabel={`${item.name || 'This item'} is active`}
            onChange={(active) => onEdit({ active })}
          />
        </Td>
      </tr>

      {editingOtherCurrency && (
        <tr>
          <td colSpan={7} className="border-b border-rule bg-paper-sunken/50 px-3 py-2">
            <OtherCurrencyPrices item={item} homeCurrency={currency} onEdit={onEdit} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Prices in other currencies.
 *
 * A catalogue item usually only needs the currencies somebody actually bills in, so
 * this lists the ones already set plus the common ones, and nothing more.
 */
function OtherCurrencyPrices({
  item,
  homeCurrency,
  onEdit,
}: {
  item: Item;
  homeCurrency: string;
  onEdit: (changes: Partial<Item>) => void;
}) {
  const COMMON = ['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'SGD'];
  const candidates = [...new Set([...Object.keys(item.prices), ...COMMON])]
    .filter((code) => code !== homeCurrency)
    .sort();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {candidates.map((code) => (
        <Field key={code} label={code} hint={getCurrency(code).name}>
          <CurrencyInput
            currency={code}
            inputSize="sm"
            value={item.prices[code] ?? 0}
            ariaLabel={`Price of ${item.name || 'the new item'} in ${code}`}
            onChange={(minor) => {
              const prices = { ...item.prices };
              if (minor === 0) delete prices[code];
              else prices[code] = minor;
              onEdit({ prices });
            }}
          />
        </Field>
      ))}
      <datalist id="duly-item-categories" />
    </div>
  );
}
