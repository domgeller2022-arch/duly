/**
 * Businesses: add, edit, archive, and the GST switch with its effective date.
 *
 * The GST switch is the part worth reading. The plan requires that changing it
 * "applies to new documents and open drafts from the effective date", and that
 * "Duly lists the drafts that will change and asks you to confirm". So the flow is:
 * set the switch, set the date, see exactly which drafts move, then confirm.
 *
 * Nothing already issued changes. A finalised document keeps the GST treatment it
 * was issued with, from its own tax snapshot, and the confirmation dialog says so
 * rather than leaving the user to wonder.
 */

import { useState } from 'react';
import { Archive, Building2, Plus, RotateCcw, Save } from 'lucide-react';
import type { BusinessProfile } from '@/core/schemas';
import { businessProfileSchema, newBusinessProfile } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { useAppStore } from '@/state/app';
import { defaultTaxCodeFor, draftsAffectedByChange, withGstChange } from '@/core/validation/gst';
import {
  Alert,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Field,
  Panel,
  Switch,
  TextInput,
  useToast,
} from '@/ui/components/base';
import {
  BusinessDefaultsFields,
  BusinessIdentityFields,
  LogoAndColours,
  PaymentDetailFields,
} from '../profileFields';

export function BusinessesSection() {
  const { push } = useToast();
  const profiles = useAppStore((s) => s.profiles);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const documents = useAppStore((s) => s.documents);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const setActiveProfile = useAppStore((s) => s.setActiveProfile);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<BusinessProfile | null>(null);

  const editing = draft ?? profiles.find((p) => p.id === editingId) ?? null;

  const patch = (changes: Partial<BusinessProfile>) =>
    setDraft((current) => (current ? { ...current, ...changes } : current));

  const startEditing = (profile: BusinessProfile) => {
    setEditingId(profile.id);
    setDraft(profile);
  };

  const startNew = () => {
    setEditingId(null);
    setDraft(
      newBusinessProfile({
        defaultCurrency: (settings?.defaultCurrency ?? 'AUD') as 'AUD',
        defaultTaxCodeId: defaultTaxCodeFor(false),
      }),
    );
  };

  const close = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const next = businessProfileSchema.parse({ ...editing, updatedAt: new Date().toISOString() });
      await storage().saveBusinessProfile(next);
      await saveProfile(next);
      await storage().saveAuditLog(
        newEntity({
          entity: 'business_profile',
          entityId: next.id,
          action: editingId ? 'update' : 'create',
          summary: `${editingId ? 'Updated' : 'Added'} ${next.name}`,
          actor: 'user',
        }),
      );
      push({ tone: 'success', title: editingId ? 'Business saved' : 'Business added' });
      if (!editingId) await setActiveProfile(next.id);
      close();
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

  const archive = async () => {
    if (!archiving) return;
    const next = { ...archiving, archived: true, updatedAt: new Date().toISOString() };
    await storage().saveBusinessProfile(next);
    await saveProfile(next);
    setArchiving(null);
    push({
      tone: 'info',
      title: `${archiving.name} archived`,
      description: 'Its documents and history stay exactly as they are.',
    });
    if (editingId === archiving.id) close();
  };

  /* ---- list ---- */
  if (!editing) {
    return (
      <div className="space-y-3">
        <Panel
          title="Your businesses"
          description="Each one has its own ABN, GST status, numbering, branding and payment details."
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={startNew}
            >
              Add a business
            </Button>
          }
          flush
        >
          <ul className="divide-y divide-rule">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-rule bg-paper-sunken">
                  {profile.logo?.src ? (
                    <img src={profile.logo.src} alt="" className="size-full object-contain" />
                  ) : (
                    <Building2 className="size-4 text-ink-faint" aria-hidden />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {profile.name}
                    {profile.archived && <span className="ml-2 text-ink-faint">(archived)</span>}
                  </p>
                  <p className="truncate text-[12px] text-ink-muted">
                    {profile.abn ? `ABN ${profile.abn}` : 'No ABN'} · {profile.defaultCurrency}
                    {profile.email ? ` · ${profile.email}` : ''}
                  </p>
                </div>

                <Chip tone={profile.gstRegistered ? 'accent' : 'muted'}>
                  {profile.gstRegistered ? 'GST registered' : 'Not registered'}
                </Chip>

                <Button size="sm" onClick={() => startEditing(profile)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        {profiles.length === 0 && (
          <Alert tone="info" title="No businesses yet">
            Run the setup wizard to add your first one — it takes about a minute.
          </Alert>
        )}
      </div>
    );
  }

  /* ---- editor ---- */
  const isNew = editingId === null;

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">
            {isNew ? 'New business' : editing.name}
          </h2>
          <div className="flex items-center gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Save className="size-3.5" aria-hidden />}
              loading={saving}
              disabled={editing.name.trim().length === 0}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          <Section title="Identity">
            <BusinessIdentityFields draft={editing} onPatch={patch} />
          </Section>

          <GstSwitch profile={editing} today={today} drafts={documents} onPatch={patch} />

          <Section title="Branding">
            <LogoAndColours draft={editing} onPatch={patch} />
          </Section>

          <Section title="Payment details">
            <PaymentDetailFields draft={editing} onPatch={patch} />
          </Section>

          <Section title="Defaults">
            <BusinessDefaultsFields draft={editing} onPatch={patch} settings={settings} />
          </Section>

          {!isNew && (
            <div className="flex items-center justify-between gap-4 border-t border-rule pt-4">
              <div>
                <p className="text-[13px] font-medium text-ink">Archive this business</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  It disappears from the switcher. Its documents, numbers and history are kept.
                </p>
              </div>
              <Button
                variant="danger"
                icon={<Archive className="size-3.5" aria-hidden />}
                onClick={() => setArchiving(editing)}
              >
                Archive
              </Button>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={() => void archive()}
        title={`Archive ${archiving?.name ?? 'this business'}?`}
        confirmLabel="Archive"
        danger
        body="Its documents and number sequences are kept. It will no longer appear in the sidebar switcher."
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* GST switch                                                          */
/* ------------------------------------------------------------------ */

/**
 * The GST registration switch, with its effective date.
 *
 * The draft list is computed live as the date moves, so the consequence is visible
 * before anything is saved. Turning registration on also moves the default tax code
 * to GST, because the plan says the default code follows the switch; turning it off
 * moves it to no-tax.
 */
function GstSwitch({
  profile,
  today,
  drafts,
  onPatch,
}: {
  profile: BusinessProfile;
  today: string;
  drafts: ReturnType<typeof useAppStore.getState>['documents'];
  onPatch: (patch: Partial<BusinessProfile>) => void;
}) {
  const from = profile.gstRegisteredFrom ?? today;
  // The toggle is a change happening today; the user can then move its date
  // with the field below. Toggling at the old effective date used to
  // overwrite the recorded change instead of adding one.
  const next = withGstChange(profile, { registered: !profile.gstRegistered, from: today }, today);

  const affected = draftsAffectedByChange(drafts, {
    profileId: profile.id,
    from,
    registered: !profile.gstRegistered,
  });

  const finalisedUntouched = drafts.filter(
    (d) =>
      d.profileId === profile.id &&
      d.status !== 'draft' &&
      d.status !== 'accepted' &&
      d.status !== 'declined' &&
      d.status !== 'void',
  ).length;

  return (
    <Section title="GST">
      <div className="rounded-[8px] border border-rule bg-paper-sunken/50 p-3">
        <Switch
          checked={profile.gstRegistered}
          label="Registered for GST"
          hint="On: documents are titled “Tax Invoice” and GST at 10% is applied. Off: they are titled “Invoice” with no GST line."
          onChange={(gstRegistered) =>
            onPatch({
              gstRegistered: next.gstRegistered,
              gstRegisteredFrom: next.gstRegisteredFrom,
              gstHistory: next.gstHistory,
              defaultTaxCodeId: defaultTaxCodeFor(gstRegistered),
            })
          }
        />

        <div className="mt-3">
          <Field label="Effective from" hint="Documents issued on or after this date follow the new setting">
            <TextInput
              type="date"
              value={from}
              max={today}
              onChange={(e) => {
                const gstRegisteredFrom = e.target.value || today;
                onPatch({
                  gstRegisteredFrom,
                  gstHistory: withGstChange(
                    profile,
                    { registered: profile.gstRegistered, from: gstRegisteredFrom },
                    today,
                  ).gstHistory,
                });
              }}
            />
          </Field>
        </div>
      </div>

      {affected.length > 0 && (
        <Alert
          tone="warning"
          title={`${affected.length} draft${affected.length === 1 ? '' : 's'} will change`}
        >
          <ul className="mt-1 space-y-0.5">
            {affected.slice(0, 6).map((doc) => (
              <li key={doc.id} className="font-mono text-[12px]">
                {doc.draftNumber || doc.number || 'Unnumbered draft'} · {doc.issueDate}
              </li>
            ))}
            {affected.length > 6 && <li className="text-[12px]">and {affected.length - 6} more…</li>}
          </ul>
        </Alert>
      )}

      {finalisedUntouched > 0 && (
        <p className="text-[12px] text-ink-muted">
          <RotateCcw className="mr-1 inline size-3" aria-hidden />
          {finalisedUntouched} issued document{finalisedUntouched === 1 ? '' : 's'} will not change: each
          keeps the GST treatment it was issued with.
        </p>
      )}
    </Section>
  );
}
