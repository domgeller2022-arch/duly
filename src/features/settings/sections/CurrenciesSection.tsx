/**
 * Currencies and exchange rates.
 *
 * The ISO 4217 table is compiled in, so every currency is available offline with
 * its real decimal places — JPY has none, KWD has three. Rates are maintained by
 * hand or pasted from a CSV you downloaded yourself, because Duly makes no network
 * calls at all. That is a feature: an exchange rate is never silently fetched from
 * somewhere you did not choose.
 */

import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import type { CurrencyRate } from '@/core/schemas';
import { newEntity } from '@/core/schemas/common';
import { CURRENCIES, getCurrency, searchCurrencies } from '@/core/money/currencies';
import { useAppStore } from '@/state/app';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';

export function CurrenciesSection() {
  const { push } = useToast();
  const rates = useAppStore((s) => s.currencyRates);
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const saveCurrencyRate = useAppStore((s) => s.saveCurrencyRate);
  const removeCurrencyRate = useAppStore((s) => s.removeCurrencyRate);

  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<CurrencyRate | null>(null);
  const [importing, setImporting] = useState(false);

  const visible = useMemo(() => searchCurrencies(query).slice(0, 40), [query]);

  const addRate = async () => {
    const rate: CurrencyRate = {
      ...newEntity({
        from: 'NZD',
        to: 'AUD',
        rate: '1',
        effectiveDate: useAppStore.getState().today,
        note: '',
      }),
      source: 'manual',
    };
    await saveCurrencyRate(rate);
    push({ tone: 'success', title: 'Rate added' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="eyebrow">Defaults</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Home currency" hint="Every exchange rate is quoted against this">
            <Select
              value={settings?.homeCurrency ?? 'AUD'}
              onChange={(e) => settings && void saveSettings({ ...settings, homeCurrency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Default currency for new documents">
            <Select
              value={settings?.defaultCurrency ?? 'AUD'}
              onChange={(e) =>
                settings && void saveSettings({ ...settings, defaultCurrency: e.target.value })
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-3 space-y-2.5">
          <Checkbox
            checked={settings?.showAudEquivalent ?? false}
            label="Show an AUD equivalent on foreign-currency documents"
            hint="Informational only. It never changes what the client owes."
            onChange={(v) => settings && void saveSettings({ ...settings, showAudEquivalent: v })}
          />
          <Field label="Where the currency symbol goes">
            <Select
              value={settings?.currencySymbolPosition ?? 'before'}
              onChange={(e) =>
                settings &&
                void saveSettings({
                  ...settings,
                  currencySymbolPosition: e.target.value as 'before' | 'after' | 'code',
                })
              }
              className="max-w-xs"
            >
              <option value="before">Before the amount, e.g. $1,200.00</option>
              <option value="after">After the amount, e.g. 1,200.00 €</option>
              <option value="code">Always show the code, e.g. AUD 1,200.00</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Panel
        title="Exchange rates"
        description="Maintained by you, never fetched. One rate per currency against your home currency."
        actions={
          <>
            <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => void addRate()}>
              Add a rate
            </Button>
            <Button size="sm" onClick={() => setImporting(true)}>
              Paste CSV
            </Button>
          </>
        }
        flush
      >
        {rates.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No exchange rates yet. Add one if you invoice in a currency other than your home currency.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Currency</Th>
                <Th align="right">1 {settings?.homeCurrency ?? 'AUD'} buys</Th>
                <Th>Effective</Th>
                <Th>Source</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {[...rates]
                .sort((a, b) => a.from.localeCompare(b.from))
                .map((rate) => {
                  const meta = getCurrency(rate.from);
                  return (
                    <tr key={rate.id}>
                      <Td>
                        <span className="font-medium">{rate.from}</span>
                        <span className="ml-2 text-ink-muted">{meta.name}</span>
                      </Td>
                      <Td align="right">
                        <TextInput
                          inputSize="sm"
                          className="num text-right font-mono"
                          value={rate.rate}
                          aria-label={`Rate for ${rate.from}`}
                          onChange={(e) =>
                            void saveCurrencyRate({
                              ...rate,
                              rate: e.target.value.replace(/[^0-9.]/g, '') || '0',
                            })
                          }
                        />
                      </Td>
                      <Td>
                        <TextInput
                          type="date"
                          inputSize="sm"
                          value={rate.effectiveDate}
                          aria-label={`Effective date for ${rate.from}`}
                          onChange={(e) => void saveCurrencyRate({ ...rate, effectiveDate: e.target.value })}
                        />
                      </Td>
                      <Td>
                        <span className="text-ink-muted">
                          {rate.source === 'import' ? 'Imported' : 'Entered'}
                        </span>
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Trash2 className="size-3.5" aria-hidden />}
                          onClick={() => setDeleting(rate)}
                        >
                          Remove
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        )}
      </Panel>

      <Card>
        <h3 className="eyebrow">Available currencies</h3>
        <p className="-mt-1 mb-3 text-[12px] text-ink-muted">
          Every ISO 4217 currency, with the decimal places each one actually uses. Amounts are stored as whole
          minor units, so this is what decides whether an invoice can show 1,200 or 1,200.00.
        </p>

        <Field label="Find a currency">
          <TextInput
            value={query}
            placeholder="Search by code or name"
            addonBefore={<Search className="size-3.5" aria-hidden />}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>

        <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {visible.map((currency) => (
            <li
              key={currency.code}
              className="flex items-center justify-between gap-2 rounded-[6px] px-2 py-1"
            >
              <span className="min-w-0">
                <span className="font-mono text-[12px] font-medium text-ink">{currency.code}</span>
                <span className="ml-1.5 truncate text-[12px] text-ink-muted">{currency.name}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-faint">{currency.decimals}dp</span>
            </li>
          ))}
        </ul>
        {query && visible.length === 0 && (
          <p className="mt-2 text-[12px] text-ink-muted">No currency matches “{query}”.</p>
        )}
        {!query && (
          <p className="mt-2 text-[12px] text-ink-faint">
            Showing 40 of {CURRENCIES.length}. Search to see the rest.
          </p>
        )}
      </Card>

      {importing && (
        <PasteRatesDialog
          onClose={() => setImporting(false)}
          onDone={(count) => {
            setImporting(false);
            push({ tone: 'success', title: `${count} rate${count === 1 ? '' : 's'} imported` });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await removeCurrencyRate(deleting.id);
          setDeleting(null);
        }}
        title={`Remove the ${deleting?.from ?? ''} rate?`}
        confirmLabel="Remove"
        danger
        body="Documents already issued keep the rate they used. Future ones will have no rate to convert with."
      />

      <Alert tone="info">
        Rates are kept, not recalculated. The rate printed on a document issued today is still there when you
        read that document next year.
      </Alert>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CSV paste                                                           */
/* ------------------------------------------------------------------ */

/**
 * Paste a CSV of rates.
 *
 * Two columns — currency and rate — with an optional header row. Hand-typed is the
 * normal path; a paste is for the twenty rates nobody wants to type.
 *
 * ponytail: no CSV library. The format is two columns of plain text, so splitting on
 * commas is enough; a full parser would handle quoted fields Duly never sees.
 */
function PasteRatesDialog({ onClose, onDone }: { onClose: () => void; onDone: (count: number) => void }) {
  const saveCurrencyRate = useAppStore((s) => s.saveCurrencyRate);
  const settings = useAppStore((s) => s.settings);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => parseRateCsv(text, settings?.homeCurrency ?? 'AUD'),
    [text, settings?.homeCurrency],
  );

  const run = async () => {
    setBusy(true);
    try {
      for (const row of rows) await saveCurrencyRate(row);
      onDone(rows.length);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RateDialogShell onClose={onClose}>
      <Field
        label="Paste rates"
        hint="One per line: USD,0.6520 or USD = 0.6520. An optional date can follow."
      >
        <textarea
          rows={8}
          value={text}
          placeholder={'USD,0.6520\nEUR,1.0890\nNZD,1.0320'}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-[8px] border border-rule bg-paper-raised px-3 py-2 font-mono text-[12px] text-ink focus:border-accent focus:outline-none"
        />
      </Field>

      {text.trim() && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <Alert tone="warning">
              Nothing readable in that. Each line needs a 3-letter code and a number.
            </Alert>
          ) : (
            <>
              <p className="mb-1.5 text-[12px] font-medium text-ink">
                {rows.length} rate{rows.length === 1 ? '' : 's'} ready to import
              </p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto scroll-quiet text-[12px] text-ink-muted">
                {rows.map((row) => (
                  <li key={row.id} className="font-mono">
                    {row.from} = {row.rate} <span className="text-ink-faint">({row.effectiveDate})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={rows.length === 0} onClick={() => void run()}>
          Import {rows.length > 0 ? rows.length : ''} rates
        </Button>
      </div>
    </RateDialogShell>
  );
}

function RateDialogShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in fixed inset-0 bg-ink/25" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import exchange rates"
        className="sheet animate-scale-in relative z-10 w-full max-w-lg p-5"
      >
        <h2 className="mb-3 font-display text-base font-semibold text-ink">Import exchange rates</h2>
        {children}
      </div>
    </div>
  );
}

/** Parse two-column rate text into rows. A header row or blank lines are ignored. */
function parseRateCsv(text: string, home: string): CurrencyRate[] {
  const today = useAppStore.getState().today;
  const rows: CurrencyRate[] = [];

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const parts = line
      .split(/[,;\t=]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;

    const [code, rateRaw, dateRaw] = parts;
    if (!/^[A-Za-z]{3}$/.test(code)) continue;
    const rate = rateRaw.replace(/[^0-9.]/g, '');
    if (!rate || Number.isNaN(Number(rate))) continue;
    if (code.toUpperCase() === home.toUpperCase()) continue;

    rows.push({
      ...newEntity({
        from: code.toUpperCase(),
        to: home,
        rate,
        effectiveDate: dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : today,
        note: '',
        source: 'import',
      }),
    });
  }

  return rows;
}
