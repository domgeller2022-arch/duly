/**
 * Locale and formatting.
 *
 * Australian by default: DD/MM/YYYY, `en-AU`, and a financial year starting on 1
 * July. Every one of those is a setting rather than a constant, because a business
 * that invoices an overseas client still wants its own dates at home.
 *
 * Date *storage* never changes. Dates are stored as `YYYY-MM-DD` and this screen
 * only chooses how they are displayed, so switching from DMY to MDY cannot move a
 * stored value or change what a due date means.
 */

import { useAppStore } from '@/state/app';
import { Card, Field, Select, Switch, TextInput } from '@/ui/components/base';
import { date } from '@/ui/lib/format';

const TIME_ZONES = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Hobart',
  'Pacific/Auckland',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'UTC',
];

const LOCALES = [
  { id: 'en-AU', label: 'English (Australia)' },
  { id: 'en-NZ', label: 'English (New Zealand)' },
  { id: 'en-GB', label: 'English (United Kingdom)' },
  { id: 'en-US', label: 'English (United States)' },
  { id: 'de-DE', label: 'German (Germany)' },
  { id: 'fr-FR', label: 'French (France)' },
  { id: 'es-ES', label: 'Spanish (Spain)' },
  { id: 'it-IT', label: 'Italian (Italy)' },
  { id: 'nl-NL', label: 'Dutch (Netherlands)' },
  { id: 'ja-JP', label: 'Japanese (Japan)' },
  { id: 'zh-CN', label: 'Chinese (Simplified)' },
];

export function LocaleSection() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const today = useAppStore((s) => s.today);

  if (!settings) return null;
  const set = (changes: Partial<typeof settings>) => void saveSettings({ ...settings, ...changes });

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="eyebrow">Dates</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date format" hint={`Today would read as ${date(today, settings)}`}>
            <Select
              value={settings.dateFormat}
              onChange={(e) => set({ dateFormat: e.target.value as 'DMY' })}
            >
              <option value="DMY">06/10/2026 — day first</option>
              <option value="MDY">10/06/2026 — month first</option>
              <option value="YMD">2026/10/06 — year first</option>
              <option value="ISO">2026-10-06 — ISO</option>
            </Select>
          </Field>

          <Field label="Time zone" hint="Which day “today” means, and when schedules fire">
            <Select value={settings.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
              {/* A zone the browser knows about but this list does not still shows. */}
              {TIME_ZONES.includes(settings.timeZone) ? null : (
                <option value={settings.timeZone}>{settings.timeZone}</option>
              )}
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="eyebrow">Numbers and addresses</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Number and date locale">
            <Select value={settings.locale} onChange={(e) => set({ locale: e.target.value })}>
              {LOCALES.map((locale) => (
                <option key={locale.id} value={locale.id}>
                  {locale.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Address format on documents">
            <Select
              value={settings.addressFormat}
              onChange={(e) => set({ addressFormat: e.target.value as 'structured' })}
            >
              <option value="structured">One line per part</option>
              <option value="single_line">Everything on one line</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="eyebrow">Financial year</h3>
        <p className="-mt-1 mb-2 text-[12px] text-ink-muted">
          The ATO financial year runs 1 July to 30 June. It sets the {'{FY}'} number token, the financial-year
          folders, and the periods on your GST summary.
        </p>
        <Field label="Starts in" className="max-w-xs">
          <Select
            value={String(settings.financialYearStartMonth)}
            onChange={(e) => set({ financialYearStartMonth: Number(e.target.value) })}
          >
            {[
              ['1', 'January'],
              ['4', 'April'],
              ['7', 'July (Australia)'],
              ['10', 'October'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card>
        <h3 className="eyebrow">Documents</h3>
        <div className="mt-2 space-y-2.5">
          <Switch
            checked={settings.showDraftWatermark}
            label="Show a DRAFT watermark on documents that have not been submitted"
            onChange={(showDraftWatermark) => set({ showDraftWatermark })}
          />
          <Switch
            checked={settings.stampPaidOnPdf}
            label="Stamp invoices as PAID once they are settled"
            onChange={(stampPaidOnPdf) => set({ stampPaidOnPdf })}
          />
          <Switch
            checked={settings.refileOnPayment}
            label="Rewrite the PDF when a payment arrives, so the stamp is current"
            hint="Only matters when the PAID stamp is on and an output folder is chosen."
            onChange={(refileOnPayment) => set({ refileOnPayment })}
          />
          <Switch
            checked={settings.warnOnProgressOver100}
            label="Warn when progress invoicing would exceed the quoted amount"
            onChange={(warnOnProgressOver100) => set({ warnOnProgressOver100 })}
          />
          <Field
            label="Quote validity"
            hint="Days a quote stays valid before it is marked expired"
            className="max-w-xs"
          >
            <TextInput
              type="number"
              min={1}
              max={365}
              value={String(settings.defaultQuoteValidityDays)}
              onChange={(e) => set({ defaultQuoteValidityDays: Number(e.target.value) || 30 })}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
