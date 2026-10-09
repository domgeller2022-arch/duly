/**
 * The setup wizard.
 *
 * Four steps, in the order they are actually needed: who you are, how you look,
 * how you get paid, where the files go. A person can reach a usable first invoice
 * after step one and improve the rest later, which is why every step except the
 * first is skippable.
 *
 * One `BusinessProfile` is written at the end, then the app marks onboarding
 * complete and hands over to the dashboard. Nothing else is created: the design
 * templates, tax codes and email templates were seeded at start-up, so the wizard
 * has no reference data of its own to install.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, PartyPopper } from 'lucide-react';
import type { BusinessProfile } from '@/core/schemas';
import { businessProfileSchema, newBusinessProfile } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { useAppStore, useToday } from '@/state/app';
import { defaultTaxCodeFor, withGstChange } from '@/core/validation/gst';
import { isValidAbn } from '@/core/validation/abn';
import { Button, Card, Field, Select, Switch, TextInput, useToast } from '@/ui/components/base';
import {
  BusinessDefaultsFields,
  BusinessIdentityFields,
  LogoAndColours,
  PaymentDetailFields,
} from '@/features/settings/profileFields';

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const STEPS = [
  { id: 'business', title: 'Your business', hint: 'Name, ABN and GST status' },
  { id: 'branding', title: 'Logo and colours', hint: 'How your documents look' },
  { id: 'payment', title: 'Payment details', hint: 'Where clients send the money' },
  { id: 'output', title: 'Files and folders', hint: 'Where Duly writes PDFs and backups' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function SetupWizardScreen() {
  const navigate = useNavigate();
  const { push } = useToast();
  const settings = useAppStore((s) => s.settings);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const templates = useAppStore((s) => s.designTemplates);
  const today = useToday();

  const [step, setStep] = useState<StepId>('business');
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState<BusinessProfile>(() =>
    newBusinessProfile({
      defaultCurrency: (settings?.defaultCurrency ?? 'AUD') as 'AUD',
      defaultTaxCodeId: defaultTaxCodeFor(false),
    }),
  );

  const patch = (changes: Partial<BusinessProfile>) => setDraft((current) => ({ ...current, ...changes }));

  const index = STEPS.findIndex((s) => s.id === step);
  const goTo = (target: StepId) => setStep(target);

  /**
   * Can the wizard finish?
   *
   * Only a name is required. An ABN without GST registration is allowed — plenty
   * of sole traders have one and are not registered, and the ATO only asks for the
   * ABN on documents that actually carry GST.
   */
  const canFinish = draft.name.trim().length > 0;

  const finish = async () => {
    setSaving(true);
    try {
      // Seed the GST history with today's answer, so "registered" is a recorded
      // fact with a date rather than an unstated assumption.
      const registered = draft.gstRegistered;
      const profile = withGstChange(
        businessProfileSchema.parse({
          ...draft,
          updatedAt: new Date().toISOString(),
          onboarded: true,
          // A brand-new business starts with its own numbering sequences.
          defaultTaxCodeId: registered ? defaultTaxCodeFor(true) : draft.defaultTaxCodeId,
        }),
        { registered, from: draft.gstRegisteredFrom ?? today, note: 'Set up in the setup wizard' },
      );

      await storage().saveBusinessProfile(profile);
      await storage().saveAuditLog(
        newEntity({
          entity: 'business_profile',
          entityId: profile.id,
          action: 'create',
          summary: `Set up ${profile.name}`,
          actor: 'user',
        }),
      );

      if (settings) {
        await storage().saveSettings({ ...settings, activeProfileId: profile.id, onboardingComplete: true });
      }
      await useAppStore.getState().refresh();
      await useAppStore.getState().setActiveProfile(profile.id);

      push({
        tone: 'success',
        title: 'Your business is ready',
        description: 'Add a client, then your first invoice takes under a minute.',
      });
      navigate('/');
    } catch (error) {
      push({
        tone: 'error',
        title: 'That business could not be saved',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6" data-print="hide">
      <header className="mb-6">
        <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
          Set up Duly
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Four short steps. Everything stays on this machine, and you can change any of it later.
        </p>
      </header>

      {/* Progress, clickable so a step can be revisited rather than only moved forward. */}
      <ol className="mb-6 flex flex-wrap items-center gap-1.5" aria-label="Setup progress">
        {STEPS.map((s, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => goTo(s.id)}
                aria-current={state === 'current' ? 'step' : undefined}
                className={[
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  state === 'current'
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : state === 'done'
                      ? 'border-rule bg-paper-sunken text-ink hover:border-rule-strong'
                      : 'border-rule text-ink-muted hover:border-rule-strong',
                ].join(' ')}
              >
                {state === 'done' ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <span className="num text-ink-faint">{i + 1}</span>
                )}
                {s.title}
              </button>
            </li>
          );
        })}
      </ol>

      <Card>
        {step === 'business' && (
          <div className="space-y-4">
            <h2 className="font-display text-base font-semibold text-ink">Your business</h2>
            <BusinessIdentityFields draft={draft} onPatch={patch} />

            <div className="rounded-[8px] border border-rule bg-paper-sunken/50 p-3">
              <Switch
                checked={draft.gstRegistered}
                label="Registered for GST"
                hint="On: documents are titled “Tax Invoice” and GST at 10% is applied. Off: they are titled “Invoice” with no GST."
                onChange={(gstRegistered) =>
                  patch({
                    gstRegistered,
                    gstRegisteredFrom: gstRegistered ? today : draft.gstRegisteredFrom,
                    defaultTaxCodeId: gstRegistered ? defaultTaxCodeFor(true) : defaultTaxCodeFor(false),
                  })
                }
              />

              {draft.gstRegistered && !isValidAbn(draft.abn) && (
                <p className="mt-2 text-[12px] text-due">
                  GST registration needs your ABN on every tax invoice. Add it above and the checksum will be
                  checked as you type.
                </p>
              )}

              {draft.gstRegistered && (
                <div className="mt-3">
                  <Field
                    label="Registered from"
                    hint="Documents issued on or after this date carry GST. You can change it later, and anything already issued keeps the treatment it was issued with."
                    className="max-w-xs"
                  >
                    <TextInput
                      type="date"
                      max={today}
                      value={draft.gstRegisteredFrom ?? today}
                      onChange={(e) => patch({ gstRegisteredFrom: e.target.value || today })}
                    />
                  </Field>
                </div>
              )}
            </div>

            <Field label="Default design template" hint="Which template new documents start with">
              <Select
                value={draft.defaultDesignTemplateId ?? ''}
                onChange={(e) => patch({ defaultDesignTemplateId: e.target.value || null })}
              >
                <option value="">Studio (default)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>

            {taxCodes.length === 0 && (
              <p className="text-[12px] text-ink-faint">
                Tax codes are still loading; the default is GST-free.
              </p>
            )}
          </div>
        )}

        {step === 'branding' && (
          <div className="space-y-4">
            <h2 className="font-display text-base font-semibold text-ink">Logo and colours</h2>
            <p className="-mt-2 text-[13px] text-ink-muted">
              Skip this if you have no logo yet — the documents look fine with just your business name.
            </p>
            <LogoAndColours draft={draft} onPatch={patch} />
          </div>
        )}

        {step === 'payment' && (
          <div className="space-y-4">
            <h2 className="font-display text-base font-semibold text-ink">Payment details</h2>
            <PaymentDetailFields draft={draft} onPatch={patch} />
          </div>
        )}

        {step === 'output' && <OutputStep draft={draft} onPatch={patch} />}
      </Card>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          icon={<ArrowLeft className="size-3.5" aria-hidden />}
          disabled={index === 0}
          onClick={() => goTo(STEPS[Math.max(0, index - 1)].id)}
        >
          Back
        </Button>

        <div className="flex items-center gap-2">
          {index < STEPS.length - 1 ? (
            <Button
              variant="primary"
              iconAfter={<ArrowRight className="size-3.5" aria-hidden />}
              onClick={() => goTo(STEPS[index + 1].id)}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<PartyPopper className="size-3.5" aria-hidden />}
              disabled={!canFinish}
              loading={saving}
              onClick={() => void finish()}
            >
              Finish setup
            </Button>
          )}
        </div>
      </footer>

      {!canFinish && index === 0 && (
        <p className="mt-2 text-right text-[12px] text-ink-muted">A business name is all that is required.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Output step                                                         */
/* ------------------------------------------------------------------ */

/**
 * Where PDFs and backups go.
 *
 * The folder choice is left to Settings → Files rather than repeated here, because
 * the File System Access API needs a user gesture and this step is reached by a
 * button that would be that gesture — which works, but the handle still lapses at
 * the end of the session and re-asking is clearer in one place. The pattern is
 * captured here because it is a plain text field with no permission at all.
 */
function OutputStep({
  draft,
  onPatch,
}: {
  draft: BusinessProfile;
  onPatch: (patch: Partial<BusinessProfile>) => void;
}) {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const capabilities = useAppStore((s) => s.capabilities);

  const patternValid = /\{[a-z_]+\}|[^/\\:*?"<>|]+/i.test(settings?.fileNamePattern ?? '');

  return (
    <div className="space-y-4">
      <h2 className="font-display text-base font-semibold text-ink">Files and folders</h2>

      <BusinessDefaultsFields draft={draft} onPatch={onPatch} settings={settings} />

      <Field
        label="PDF file-name pattern"
        hint="Tokens: {year} {client} {number} {date} {type} {profile} {financial_year}"
        error={patternValid ? undefined : 'A file name cannot contain / \\ : * ? " < > |'}
      >
        <TextInput
          value={settings?.fileNamePattern ?? ''}
          invalid={!patternValid}
          monospace
          onChange={(e) => settings && void saveSettings({ ...settings, fileNamePattern: e.target.value })}
        />
      </Field>

      <p className="text-[12px] text-ink-muted">
        {capabilities.fileSystemAccess
          ? 'You will choose the folder Duly writes into from Settings → Files, just after this.'
          : 'This browser cannot write into a folder you choose, so PDFs will download instead. Chrome or Edge on a computer can — see Settings → Files.'}
      </p>

      <p className="text-[12px] text-ink-faint">
        The example above would write{' '}
        <span className="font-mono text-ink-muted">
          {examplePath(
            settings?.fileNamePattern ?? '',
            draft.name || 'Acme',
            'INV-2026-0001',
            todayOr(new Date()),
          )}
        </span>
      </p>
    </div>
  );
}

function todayOr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A short concrete example of the pattern, because tokens are easy to get wrong. */
function examplePath(pattern: string, client: string, number: string, date: string): string {
  const [y, m, d] = date.split('-');
  const values: Record<string, string> = {
    number,
    client: client || 'Acme',
    date,
    day: d,
    month: m,
    year: y,
    type: 'INV',
    profile: 'PRO',
    financial_year: `${y}-${Number(y) + 1}`,
  };
  return pattern.replace(/\{([a-z_]+)\}/gi, (_match, key: string) => values[key.toLowerCase()] ?? '');
}
