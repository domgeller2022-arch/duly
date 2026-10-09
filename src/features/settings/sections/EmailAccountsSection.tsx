/**
 * Email accounts.
 *
 * The plan's item 3: a setup wizard for Proton Mail (Bridge or SMTP token)
 * and Gmail (app password); trusted Bridge certificate; test send;
 * per-business sending account; outbox with retry.
 *
 * The presets come from `PROVIDER_PRESETS`, so choosing "Proton Mail via
 * Bridge" fills 127.0.0.1:1025 with STARTTLS and marks the certificate as
 * trusted. The password is stored through the secrets adapter — session
 * memory on the web (which says so), the OS keychain on desktop.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EmailAccount, EmailProvider } from '@/core/schemas';
import { emailAccountSchema, EMAIL_PROVIDERS, PROVIDER_PRESETS } from '@/core/schemas/settings';
import { newEntity } from '@/core/schemas/common';
import { platform } from '@/adapters';
import { useAppStore, useActiveProfile } from '@/state/app';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
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
import { date } from '@/ui/lib/format';

export function EmailAccountsSection() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const emailAccounts = useAppStore((s) => s.emailAccounts);
  const profiles = useAppStore((s) => s.profiles);
  const saveEmailAccount = useAppStore((s) => s.saveEmailAccount);
  const removeEmailAccount = useAppStore((s) => s.removeEmailAccount);
  const saveProfile = useAppStore((s) => s.saveProfile);

  const [draft, setDraft] = useState<EmailAccount | null>(null);
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [secretsPersistent, setSecretsPersistent] = useState(false);

  useEffect(() => {
    setSecretsPersistent(platform().secrets.isPersistent);
  }, []);

  const startNew = () => {
    setDraft(emailAccountSchema.parse({ ...newEntity({}), name: 'Gmail' }));
    setPassword('');
  };

  const startEdit = (account: EmailAccount) => {
    setDraft(account);
    setPassword('');
  };

  const applyProvider = (provider: EmailProvider) => {
    if (!draft) return;
    const preset = PROVIDER_PRESETS[provider];
    setDraft({
      ...draft,
      provider,
      name: preset.name,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
      starttls: preset.starttls,
      fromEmail: provider === 'proton_bridge' ? draft.fromEmail : draft.fromEmail,
    });
  };

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = emailAccountSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveEmailAccount(parsed as EmailAccount);
      if (password) {
        const stored = await platform().secrets.set(parsed.secretRef || `smtp:${parsed.id}`, password);
        if (!stored) {
          push({
            tone: 'warning',
            title: 'Password kept for this session only',
            description:
              'The web build has nowhere safe to store it. The desktop build keeps it in the OS keychain.',
          });
        } else {
          push({ tone: 'success', title: 'Password saved to the OS keychain' });
        }
      }
      push({ tone: 'success', title: 'Account saved' });
      setDraft(null);
      setPassword('');
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  /** The plan's test send: one real message, so a wrong port shows now. */
  const test = async () => {
    if (!draft) return;
    setTesting(true);
    try {
      const result = await platform().mail.testAccount({
        host: draft.host,
        port: draft.port,
        secure: draft.secure,
        starttls: draft.starttls,
        username: draft.bridgeGeneratedUsername || draft.fromEmail,
        password: password || ((await platform().secrets.get(draft.secretRef || `smtp:${draft.id}`)) ?? ''),
        fromEmail: draft.fromEmail,
        to: draft.fromEmail || 'test@example.com',
      });
      await saveEmailAccount({
        ...draft,
        lastTestedAt: new Date().toISOString(),
        lastTestSucceeded: result.ok,
        lastTestError: result.error ?? null,
        updatedAt: new Date().toISOString(),
      } as EmailAccount);
      push({
        tone: result.ok ? 'success' : 'warning',
        title: result.ok ? 'Test message sent' : 'The test could not complete',
        description: result.error ?? 'Check the inbox of the address you sent to.',
      });
    } finally {
      setTesting(false);
    }
  };

  const remove = async (id: string) => {
    await removeEmailAccount(id);
    if (draft?.id === id) setDraft(null);
    setConfirmId(null);
    push({ tone: 'success', title: 'Account deleted' });
  };

  const patch = (changes: Partial<EmailAccount>) => setDraft(draft ? { ...draft, ...changes } : draft);

  /** The business this account sends for — one account per business. */
  const sendingFor = (accountId: string) =>
    profiles.find((p) => p.sendingEmailAccountId === accountId)?.name ?? null;

  const setSendingFor = async (accountId: string | null) => {
    if (!profile) return;
    await saveProfile({ ...profile, sendingEmailAccountId: accountId, updatedAt: new Date().toISOString() });
    push({ tone: 'success', title: 'Sending account set for this business' });
  };

  return (
    <div className="grid gap-4">
      <Panel
        title="Email accounts"
        description={
          secretsPersistent
            ? 'Passwords live in the OS keychain. Test each account with a real message.'
            : 'The web build opens your mail app rather than sending directly; passwords are kept for this session only.'
        }
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            Add account
          </Button>
        }
        flush
      >
        {emailAccounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No accounts yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>From</Th>
                <Th>Sends for</Th>
                <Th>Last test</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {emailAccounts.map((account) => (
                <tr
                  key={account.id}
                  className="cursor-pointer hover:bg-paper-sunken"
                  onClick={() => startEdit(account)}
                >
                  <Td className="font-medium text-ink">
                    {account.name} {!account.enabled && <Badge>off</Badge>}
                  </Td>
                  <Td className="text-ink-muted">{account.fromEmail || '—'}</Td>
                  <Td className="text-ink-muted">{sendingFor(account.id) ?? '—'}</Td>
                  <Td>
                    {account.lastTestedAt === null ? (
                      <span className="text-ink-faint">never</span>
                    ) : account.lastTestSucceeded ? (
                      <Chip tone="neutral">
                        passed {date(account.lastTestedAt, useAppStore.getState().settings)}
                      </Chip>
                    ) : (
                      <Chip tone="overdue">failed</Chip>
                    )}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setConfirmId(account.id)}
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
        <Card className="p-4">
          <h2 className="mb-3 font-medium text-ink">
            {emailAccounts.some((a) => a.id === draft.id) ? `Edit ${draft.name}` : 'New account'}
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider" hint={PROVIDER_PRESETS[draft.provider].docsUrl}>
                <Select
                  value={draft.provider}
                  onChange={(e) => applyProvider(e.target.value as EmailProvider)}
                >
                  {EMAIL_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_PRESETS[provider].name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Name">
                <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="From name" hint="Defaults to the business name.">
                <TextInput value={draft.fromName} onChange={(e) => patch({ fromName: e.target.value })} />
              </Field>
              <Field label="From address">
                <TextInput
                  type="email"
                  value={draft.fromEmail}
                  onChange={(e) => patch({ fromEmail: e.target.value })}
                />
              </Field>
              <Field label="Host">
                <TextInput value={draft.host} onChange={(e) => patch({ host: e.target.value })} />
              </Field>
              <Field label="Port">
                <TextInput
                  value={String(draft.port)}
                  onChange={(e) =>
                    patch({ port: Math.max(1, Math.min(65535, Number(e.target.value) || 587)) })
                  }
                />
              </Field>
              {draft.provider === 'proton_bridge' && (
                <Field label="Bridge username" hint="Generated by Bridge — copy it from the Bridge app.">
                  <TextInput
                    value={draft.bridgeGeneratedUsername}
                    onChange={(e) => patch({ bridgeGeneratedUsername: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Password" hint="Stored via the secrets adapter — the OS keychain on desktop.">
                <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox
                checked={draft.provider === 'proton_bridge' || draft.pinnedCertificateFingerprint !== ''}
                label="Trust this server's certificate (local Bridge)"
                disabled={draft.provider === 'proton_bridge'}
                onChange={(v) => patch({ pinnedCertificateFingerprint: v ? 'trusted' : '' })}
              />
              <Switch checked={draft.enabled} onChange={(v) => patch({ enabled: v })} label="Enabled" />
            </div>
            {draft.pinnedCertificateFingerprint && (
              <Field
                label="Certificate fingerprint (SHA-256)"
                hint="From the Bridge app or the mail client's certificate view."
              >
                <TextInput
                  value={
                    draft.pinnedCertificateFingerprint === 'trusted' ? '' : draft.pinnedCertificateFingerprint
                  }
                  onChange={(e) => patch({ pinnedCertificateFingerprint: e.target.value })}
                  placeholder="AA:BB:…"
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save account
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void test()} disabled={testing}>
                Send test message
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setPassword('');
                }}
              >
                Cancel
              </Button>
            </div>
            {profile && (
              <Field label="Sends for this business" hint="Each business sends from its own account.">
                <Select
                  value={profile.sendingEmailAccountId ?? ''}
                  onChange={(e) => void setSendingFor(e.target.value || null)}
                >
                  <option value="">Not set</option>
                  {emailAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.fromEmail || 'no address'})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this account?"
        body="Mail already sent is logged; the keychain entry is kept."
        confirmLabel="Delete"
      />
    </div>
  );
}
