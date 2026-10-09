/**
 * Shared bits for the setup wizard and the business editor.
 *
 * The wizard's steps and the settings → Businesses editor are the same form at
 * different points in the product's life, so the fields are defined once here and
 * each screen composes them. That keeps "what a business is" in one place rather
 * than in two that drift.
 */

import { useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import type { Address, BusinessProfile, Settings } from '@/core/schemas';
import { formatAbnAsTyping, validateAbn } from '@/core/validation/abn';
import { CURRENCIES } from '@/core/money/currencies';
import { useAppStore } from '@/state/app';
import { ALL_TERMS } from '@/features/documents/editor/terms';
import { Alert, Button, Field, IconButton, Select, TextArea, TextInput } from '@/ui/components/base';
import { extractDominantColours } from '@/ui/hooks/usePreferences';

/* ------------------------------------------------------------------ */
/* Logo and colours                                                    */
/* ------------------------------------------------------------------ */

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_HEIGHT_MM = 60;

/**
 * Logo upload, preview and brand colours.
 *
 * The file is read into a data URL and stored on the profile, so it survives a
 * browser restart with no filesystem permission and needs no separate blob store.
 * PNG, JPEG and SVG are accepted because those are what the plan names; anything
 * else is refused with a reason rather than failing later at PDF render time.
 *
 * Dominant colours come from simple pixel quantising — no AI and no network. They
 * are only ever a suggestion: the user picks, and the Duly interface stays teal
 * whatever the business chooses for its own documents.
 */
export function LogoAndColours({
  draft,
  onPatch,
}: {
  draft: BusinessProfile;
  onPatch: (patch: Partial<BusinessProfile>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError('');

    if (file.size > MAX_LOGO_BYTES) {
      setError('That image is over 2 MB. Please choose a smaller file — a logo should be well under that.');
      return;
    }

    setReading(true);
    try {
      const src = await fileToDataUrl(file);
      const { width, height } = await readImageSize(src);
      const suggested = await extractDominantColours(src);
      onPatch({
        logo: {
          src,
          width,
          height,
          maxHeightMm: draft.logo?.maxHeightMm ?? 18,
          position: draft.logo?.position ?? 'left',
        },
        suggestedColours: suggested.length > 0 ? suggested : draft.suggestedColours,
      });
    } catch {
      setError('That file could not be read as an image.');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-rule bg-paper-sunken">
          {draft.logo?.src ? (
            <img
              src={draft.logo.src}
              alt={`${draft.name || 'Business'} logo`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="size-6 text-ink-faint" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="sr-only"
            aria-label="Choose a logo file"
            onChange={(e) => void read(e.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<Upload className="size-3.5" aria-hidden />}
              loading={reading}
              onClick={() => inputRef.current?.click()}
            >
              {draft.logo?.src ? 'Replace logo' : 'Upload logo'}
            </Button>
            {draft.logo?.src && (
              <IconButton label="Remove logo" onClick={() => onPatch({ logo: null })}>
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            )}
          </div>
          <p className="text-[12px] text-ink-muted">
            PNG, JPEG or SVG, up to 2 MB. It is stored inside your local database, so it travels with your
            backups and never has to be loaded from the network.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </div>

      {draft.logo?.src && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Logo position">
            <Select
              value={draft.logo.position}
              onChange={(e) =>
                onPatch({ logo: { ...draft.logo!, position: e.target.value as 'left' | 'centre' | 'right' } })
              }
            >
              <option value="left">Left</option>
              <option value="centre">Centre</option>
              <option value="right">Right</option>
            </Select>
          </Field>
          <Field label="Maximum height on the page" hint="In millimetres">
            <TextInput
              inputMode="numeric"
              value={String(draft.logo.maxHeightMm)}
              addonAfter="mm"
              onChange={(e) => {
                const mm = Number(e.target.value.replace(/[^0-9.]/g, '')) || 0;
                onPatch({ logo: { ...draft.logo!, maxHeightMm: Math.min(MAX_LOGO_HEIGHT_MM, mm) } });
              }}
            />
          </Field>
        </div>
      )}

      {draft.suggestedColours.length > 0 && (
        <Field label="Colours from your logo" hint="Tap one to use it as your brand colour">
          <div className="flex flex-wrap gap-2">
            {draft.suggestedColours.map((colour) => (
              <button
                key={colour}
                type="button"
                title={`Use ${colour}`}
                onClick={() => onPatch({ brandPrimary: colour, brandAccent: colour })}
                className="flex items-center gap-1.5 rounded-[8px] border border-rule bg-paper-raised px-2 py-1 text-[12px] text-ink transition-colors hover:border-rule-strong"
              >
                <span
                  className="size-4 rounded-[4px] border border-rule"
                  style={{ background: colour }}
                  aria-hidden
                />
                <span className="font-mono">{colour}</span>
              </button>
            ))}
          </div>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ColourField
          label="Primary colour"
          value={draft.brandPrimary}
          onChange={(brandPrimary) => onPatch({ brandPrimary })}
        />
        <ColourField
          label="Accent colour"
          value={draft.brandAccent}
          onChange={(brandAccent) => onPatch({ brandAccent })}
        />
      </div>
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = HEX.test(value);
  return (
    <Field
      label={label}
      hint="Used on your documents. The Duly interface always stays teal."
      error={valid ? undefined : 'Enter a hex colour, e.g. #1F5E5B'}
    >
      <TextInput
        value={value}
        invalid={!valid}
        monospace
        addonBefore={
          <input
            type="color"
            aria-label={`${label} picker`}
            value={valid ? value : '#1F5E5B'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="size-4 cursor-pointer border-0 bg-transparent p-0"
          />
        }
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** Name, legal name, ABN, contact details and address. */
export function BusinessIdentityFields({
  draft,
  onPatch,
}: {
  draft: BusinessProfile;
  onPatch: (patch: Partial<BusinessProfile>) => void;
}) {
  const abn = draft.abn ? validateAbn(draft.abn) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Business name" required hint="What appears in the sidebar and on your documents">
          <TextInput
            value={draft.name}
            placeholder="Acme Consulting"
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </Field>
        <Field label="Legal entity name" hint="Printed on tax invoices when it differs from the trading name">
          <TextInput
            value={draft.legalName}
            placeholder="Acme Consulting Pty Ltd"
            onChange={(e) => onPatch({ legalName: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="ABN"
          hint={abn?.valid ? 'Checksum verified' : 'Checked offline as you type'}
          error={abn && !abn.valid && abn.reason ? abn.reason : undefined}
        >
          <TextInput
            value={formatAbnAsTyping(draft.abn)}
            inputMode="numeric"
            placeholder="12 345 678 901"
            invalid={Boolean(abn && !abn.valid && abn.reason)}
            onChange={(e) => onPatch({ abn: e.target.value.replace(/\D/g, '') })}
          />
        </Field>

        <Field label="Email">
          <TextInput type="email" value={draft.email} onChange={(e) => onPatch({ email: e.target.value })} />
        </Field>

        <Field label="Phone">
          <TextInput value={draft.phone} onChange={(e) => onPatch({ phone: e.target.value })} />
        </Field>
      </div>

      {abn && !abn.valid && abn.suggestedDigit && (
        <Alert tone="warning" title="Was that a typo?">
          If the first ten digits are right, the last one should be {abn.suggestedDigit}.
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => onPatch({ abn: `${draft.abn.slice(0, 10)}${abn.suggestedDigit}` })}
          >
            Use it
          </button>
        </Alert>
      )}

      <Field label="Address" hint="Printed at the top of every document">
        <AddressFields address={draft.address} onChange={(address) => onPatch({ address })} />
      </Field>
    </div>
  );
}

export function AddressFields({
  address,
  onChange,
}: {
  address: Address;
  onChange: (address: Address) => void;
}) {
  return (
    <div className="space-y-2">
      <TextInput
        value={address.line1}
        placeholder="Street address"
        onChange={(e) => onChange({ ...address, line1: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TextInput
          value={address.city}
          placeholder="City"
          onChange={(e) => onChange({ ...address, city: e.target.value })}
        />
        <TextInput
          value={address.state}
          placeholder="State"
          onChange={(e) => onChange({ ...address, state: e.target.value })}
        />
        <TextInput
          value={address.postcode}
          placeholder="Postcode"
          onChange={(e) => onChange({ ...address, postcode: e.target.value })}
        />
        <TextInput
          value={address.country}
          placeholder="Country"
          onChange={(e) => onChange({ ...address, country: e.target.value })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payment details                                                     */
/* ------------------------------------------------------------------ */

/** Bank transfer, PayID and BPAY, printed near the bottom of every document. */
export function PaymentDetailFields({
  draft,
  onPatch,
}: {
  draft: BusinessProfile;
  onPatch: (patch: Partial<BusinessProfile>) => void;
}) {
  const pay = draft.paymentDetails;
  const set = (changes: Partial<BusinessProfile['paymentDetails']>) =>
    onPatch({ paymentDetails: { ...pay, ...changes } });

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-muted">
        These print on every document so a client knows where to send the money. Anything left blank is simply
        not printed.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Account name">
          <TextInput value={pay.accountName} onChange={(e) => set({ accountName: e.target.value })} />
        </Field>
        <Field label="BSB" hint="Six digits, e.g. 062-000">
          <TextInput
            value={pay.bsb}
            inputMode="numeric"
            placeholder="062-000"
            onChange={(e) => set({ bsb: e.target.value.replace(/[^\d-]/g, '') })}
          />
        </Field>
        <Field label="Account number">
          <TextInput
            value={pay.accountNumber}
            inputMode="numeric"
            onChange={(e) => set({ accountNumber: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="PayID" hint="Email, phone or ABN">
          <TextInput value={pay.payId} onChange={(e) => set({ payId: e.target.value })} />
        </Field>
        <Field label="BPAY biller code">
          <TextInput
            value={pay.bpayBillerCode}
            inputMode="numeric"
            onChange={(e) => set({ bpayBillerCode: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="BPAY reference">
          <TextInput value={pay.bpayReference} onChange={(e) => set({ bpayReference: e.target.value })} />
        </Field>
      </div>

      <Field label="Other payment methods" hint="Cash, cheque, or a link to a payment page">
        <TextInput value={pay.other} onChange={(e) => set({ other: e.target.value })} />
      </Field>

      <Field label="Payment terms text" hint="Free text printed near the totals, e.g. payable within 14 days">
        <TextArea
          rows={2}
          value={draft.paymentTermsText}
          onChange={(e) => onPatch({ paymentTermsText: e.target.value })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

/** Currency, terms, default tax code, default template, code, output sub-folder. */
export function BusinessDefaultsFields({
  draft,
  onPatch,
  settings,
}: {
  draft: BusinessProfile;
  onPatch: (patch: Partial<BusinessProfile>) => void;
  settings: Settings | null;
}) {
  const templates = useAppStore((s) => s.designTemplates);
  const taxCodes = useAppStore((s) => s.taxCodes);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Default currency">
        <Select value={draft.defaultCurrency} onChange={(e) => onPatch({ defaultCurrency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Default payment terms">
        <Select value={draft.defaultTerms} onChange={(e) => onPatch({ defaultTerms: e.target.value })}>
          {ALL_TERMS(settings).map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Default tax code" hint="Used while GST registration is off">
        <Select
          value={draft.defaultTaxCodeId}
          onChange={(e) => onPatch({ defaultTaxCodeId: e.target.value })}
        >
          {taxCodes.map((code) => (
            <option key={code.id} value={code.id}>
              {code.label ? `${code.name} (${code.label})` : code.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Default design template">
        <Select
          value={draft.defaultDesignTemplateId ?? ''}
          onChange={(e) => onPatch({ defaultDesignTemplateId: e.target.value || null })}
        >
          <option value="">Studio (default)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Three-letter code" hint="Used by the {PROFILE} number token">
        <TextInput
          value={draft.code}
          maxLength={4}
          monospace
          placeholder="ACM"
          onChange={(e) => onPatch({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
        />
      </Field>

      <Field label="Output sub-folder" hint="One sub-folder per business, under the folder you choose">
        <TextInput
          value={draft.outputSubFolder}
          placeholder="Acme Consulting"
          onChange={(e) => onPatch({ outputSubFolder: e.target.value })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = src;
  });
}
