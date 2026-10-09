/**
 * The client record.
 *
 * Everything about one client in one place: who they are, who to email, the
 * defaults that make a new invoice for them start correct, and what they have been
 * billed. The defaults are shown rather than edited here — they are edited on the
 * client form, and showing them read-only is what makes it obvious that changing
 * one here would not stick.
 *
 * The statistics come from `core/crm.ts`, the same figures the clients list shows,
 * so the two can never disagree.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Mail, Pencil, Phone, Plus, Receipt, Star, Trash2 } from 'lucide-react';
import type { Contact } from '@/core/schemas';
import { contactSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { clientAddresses, clientStats, daysToPayLabel, primaryContact } from '@/core/crm';
import { formatAbn } from '@/core/validation/abn';
import { storage } from '@/adapters';
import { useAppStore, useClient, useClientContacts } from '@/state/app';
import { documentPath } from '@/lib/commands';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  KeyValue,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { countLabel, date, money, statusDescriptor } from '@/ui/lib/format';

export function ClientDetailScreen() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  const client = useClient(clientId ?? null);
  const contacts = useClientContacts(clientId ?? null);
  const documents = useAppStore((s) => s.documents);
  const payments = useAppStore((s) => s.payments);
  const settings = useAppStore((s) => s.settings);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const today = useAppStore((s) => s.today);
  const taxCodes = useAppStore((s) => s.taxCodes);

  const currency =
    profiles.find((p) => p.id === activeProfileId)?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';

  const stats = useMemo(
    () =>
      client
        ? clientStats({ clientId: client.id, documents, payments, profileId: activeProfileId, today })
        : null,
    [client, documents, payments, activeProfileId, today],
  );

  const theirDocuments = useMemo(
    () =>
      documents
        .filter((d) => d.clientId === clientId && !d.deletedAt)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [documents, clientId],
  );

  if (!client) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={<FileText className="size-7" aria-hidden />}
          title="No such client"
          hint="It may have been archived, or the link may be out of date."
          action={<Button onClick={() => navigate('/clients')}>Back to clients</Button>}
        />
      </div>
    );
  }

  const addresses = clientAddresses(client);
  const contact = primaryContact(client, contacts);
  const defaultTax = taxCodes.find((t) => t.id === client.defaultTaxCodeId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6" data-print="hide">
      <PageHeader
        title={client.displayName}
        subtitle={
          client.taxId
            ? `${client.taxIdCountry === 'AU' ? 'ABN' : 'Tax ID'} ${formatAbn(client.taxId)}`
            : undefined
        }
        actions={
          <>
            <Button
              icon={<ArrowLeft className="size-3.5" aria-hidden />}
              onClick={() => navigate('/clients')}
            >
              Back
            </Button>
            <Button
              variant="primary"
              icon={<Pencil className="size-3.5" aria-hidden />}
              onClick={() => navigate(`/clients/${client.id}/edit`)}
            >
              Edit client
            </Button>
            <Button
              icon={<Receipt className="size-3.5" aria-hidden />}
              onClick={() => navigate(`/invoices/new?clientId=${client.id}`)}
            >
              New invoice
            </Button>
          </>
        }
        className="mb-4"
      />

      {client.archived && (
        <div className="mb-4">
          <Chip tone="muted">Archived — hidden from client pickers</Chip>
        </div>
      )}

      {/* ---- the figures ---- */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Lifetime billed"
          value={stats ? money(stats.lifetimeBilled, currency) : money(0, currency)}
        />
        <Tile
          label="Outstanding"
          value={stats ? money(stats.outstanding, currency) : money(0, currency)}
          tone={stats && stats.outstanding > 0 ? 'overdue' : undefined}
        />
        <Tile label="Invoices" value={String(stats?.invoiceCount ?? 0)} />
        <Tile label="Average days to pay" value={daysToPayLabel(stats?.averageDaysToPay ?? null)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---- who they are ---- */}
        <Card>
          <h2 className="eyebrow">Details</h2>
          <div className="mt-2 space-y-3">
            <KeyValue
              items={[
                { label: 'Email', value: client.email || '—' },
                { label: 'Phone', value: client.phone || '—' },
                { label: 'Legal name', value: client.legalName || client.displayName },
                {
                  label: 'Tags',
                  value: client.tags.length > 0 ? client.tags.join(', ') : '—',
                },
                {
                  label: 'Notes',
                  value: <span className="whitespace-pre-wrap">{client.notes || '—'}</span>,
                },
              ]}
            />

            {addresses.map((address) => (
              <div key={address.label}>
                <p className="text-[12px] font-medium text-ink-muted">{address.label} address</p>
                <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink">{address.lines.join('\n')}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* ---- defaults ---- */}
        <Card>
          <h2 className="eyebrow">Defaults on a new invoice</h2>
          <p className="-mt-1 mb-2 text-[12px] text-ink-muted">
            Applied every time this client is picked. Change them on the client form.
          </p>
          <KeyValue
            items={[
              { label: 'Currency', value: client.defaultCurrency },
              { label: 'Payment terms', value: termsName(client.defaultTermsId) },
              {
                label: 'Tax treatment',
                value: client.defaultTaxCodeId
                  ? defaultTax?.label
                    ? `${defaultTax.name} (${defaultTax.label})`
                    : (defaultTax?.name ?? client.defaultTaxCodeId)
                  : 'Same as the business default',
              },
              { label: 'Standing discount', value: `${client.defaultDiscountPercent}%` },
              { label: 'PO number', value: client.requirePoNumber ? 'Required' : 'Optional' },
              { label: 'Label language', value: client.labelLanguage },
              { label: 'Invoiced by email', value: client.emailInvoices ? 'Yes' : 'No' },
            ]}
          />
        </Card>
      </div>

      {/* ---- contacts ---- */}
      <ContactsPanel clientId={client.id} contacts={contacts} preferredId={contact?.id ?? null} />

      {/* ---- documents ---- */}
      <Panel
        title="Documents"
        description={countLabel(theirDocuments.length, 'document')}
        className="mt-4"
        actions={
          <Button
            size="sm"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => navigate(`/invoices/new?clientId=${client.id}`)}
          >
            New invoice
          </Button>
        }
        flush
      >
        {theirDocuments.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            Nothing billed to this client yet.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Type</Th>
                <Th>Date</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {theirDocuments.map((doc) => {
                const status = statusDescriptor(doc.status);
                return (
                  <tr
                    key={doc.id}
                    className="cursor-pointer transition-colors hover:bg-paper-sunken"
                    onClick={() => navigate(documentPath(doc))}
                  >
                    <Td className="font-mono">{doc.number || doc.draftNumber || '—'}</Td>
                    <Td className="text-ink-muted">{doc.type.replace('_', ' ')}</Td>
                    <Td>{date(doc.issueDate, settings)}</Td>
                    <Td numeric>{money(doc.totals.total, doc.currency)}</Td>
                    <Td numeric>
                      {doc.totals.balance > 0 ? (
                        <span className="font-medium text-overdue">
                          {money(doc.totals.balance, doc.currency)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td>
                      <Chip tone={status.tone}>{status.label}</Chip>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* ---- payments ---- */}
      <PaymentsPanel clientId={client.id} documents={theirDocuments} settings={settings} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'overdue' }) {
  return (
    <div className="sheet px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">{label}</p>
      <p
        className={
          tone === 'overdue'
            ? 'num font-display text-lg font-semibold text-overdue'
            : 'num font-display text-lg font-semibold text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Contacts.
 *
 * A contact is who an invoice goes to, so the row that matters is the one marked
 * as receiving invoices, and which side of To and CC they belong on. Everything else
 * is a person at the same company.
 */
function ContactsPanel({
  clientId,
  contacts,
  preferredId,
}: {
  clientId: string;
  contacts: Contact[];
  preferredId: string | null;
}) {
  const { push } = useToast();
  const saveContact = useAppStore((s) => s.saveContact);
  const saveClient = useAppStore((s) => s.saveClient);
  const clients = useAppStore((s) => s.clients);
  const client = clients.find((c) => c.id === clientId);

  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const add = () => {
    setEditing(
      newEntity({
        clientId,
        name: '',
        role: '',
        email: '',
        phone: '',
        receivesInvoices: true,
        field: 'to',
        isPrimary: contacts.length === 0,
      }) as Contact,
    );
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      push({ tone: 'warning', title: 'A contact needs a name' });
      return;
    }
    const next = contactSchema.parse({ ...editing });
    await saveContact(next);

    // A contact marked primary becomes the client's invoice contact, so the editor
    // and the send path cannot disagree about who receives invoices.
    if (next.isPrimary && client && client.invoiceContactId !== next.id) {
      await saveClient({ ...client, invoiceContactId: next.id });
    }
    setEditing(null);
    push({ tone: 'success', title: 'Contact saved' });
  };

  const remove = async () => {
    if (!deleting) return;
    await storage().deleteContact(deleting.id);
    if (client?.invoiceContactId === deleting.id) {
      await saveClient({ ...client, invoiceContactId: null });
    }
    await useAppStore.getState().refresh();
    setDeleting(null);
    push({ tone: 'info', title: 'Contact removed' });
  };

  return (
    <Panel
      title="Contacts"
      description="Who invoices go to, and who is copied."
      className="mt-4"
      actions={
        <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={add}>
          Add a contact
        </Button>
      }
      flush
    >
      {contacts.length === 0 && editing === null && (
        <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
          No contacts yet. With one, Duly knows whose inbox an invoice goes to.
        </p>
      )}

      {contacts.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Sends</Th>
              <Th align="center">Receives invoices</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <Td>
                  <span className="font-medium text-ink">{contact.name}</span>
                  {contact.isPrimary && (
                    <Star className="ml-1.5 inline size-3 text-accent" aria-label="Primary contact" />
                  )}
                  {contact.id === preferredId && (
                    <Chip tone="accent" className="ml-1.5">
                      Invoices go here
                    </Chip>
                  )}
                  {contact.role && <span className="block text-[11px] text-ink-faint">{contact.role}</span>}
                </Td>
                <Td>
                  {contact.email ? (
                    <span className="flex items-center gap-1">
                      <Mail className="size-3 text-ink-faint" aria-hidden />
                      {contact.email}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>
                <Td>
                  {contact.phone ? (
                    <span className="flex items-center gap-1">
                      <Phone className="size-3 text-ink-faint" aria-hidden />
                      {contact.phone}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>
                <Td>
                  <Chip tone={contact.field === 'to' ? 'accent' : 'muted'}>
                    {contact.field.toUpperCase()}
                  </Chip>
                </Td>
                <Td align="center">
                  <Checkbox
                    checked={contact.receivesInvoices}
                    label=""
                    ariaLabel={`${contact.name} receives invoices`}
                    onChange={(receivesInvoices) =>
                      void saveContact({ ...contact, receivesInvoices, updatedAt: new Date().toISOString() })
                    }
                  />
                </Td>
                <Td align="right">
                  <IconButton label={`Edit ${contact.name}`} onClick={() => setEditing(contact)}>
                    <Pencil className="size-3.5" aria-hidden />
                  </IconButton>
                  <IconButton label={`Remove ${contact.name}`} onClick={() => setDeleting(contact)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <div className="border-t border-rule bg-paper-sunken/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <TextInput
                value={editing.name}
                placeholder="Accounts payable"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <TextInput
                value={editing.role}
                placeholder="Accounts"
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <TextInput
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </Field>
            <Field label="Sends invoices to">
              <Select
                value={editing.field}
                onChange={(e) => setEditing({ ...editing, field: e.target.value as Contact['field'] })}
              >
                <option value="to">To — the main recipient</option>
                <option value="cc">CC — copied</option>
                <option value="bcc">BCC — copied, unseen</option>
              </Select>
            </Field>
            <div className="flex items-end gap-4 pb-1.5">
              <Checkbox
                checked={editing.receivesInvoices}
                label="Receives invoices"
                onChange={(receivesInvoices) => setEditing({ ...editing, receivesInvoices })}
              />
              <Checkbox
                checked={editing.isPrimary}
                label="Primary"
                onChange={(isPrimary) => setEditing({ ...editing, isPrimary })}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()}>
              Save contact
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title={`Remove ${deleting?.name ?? 'this contact'}?`}
        confirmLabel="Remove"
        danger
        body="Their invoices and payment history are kept. Duly will fall back to another contact."
      />
    </Panel>
  );
}

function PaymentsPanel({
  clientId,
  documents,
  settings,
}: {
  clientId: string;
  documents: readonly { id: string; number: string; currency: string }[];
  settings: ReturnType<typeof useAppStore.getState>['settings'];
}) {
  const payments = useAppStore((s) => s.payments).filter((p) => p.documentId);

  const theirs = useMemo(() => {
    const ids = new Set(documents.map((d) => d.id));
    return payments.filter((p) => ids.has(p.documentId)).sort((a, b) => b.date.localeCompare(a.date));
  }, [payments, documents]);

  void clientId;

  return (
    <Panel
      title="Payments received"
      description="Every payment recorded against this client's invoices."
      className="mt-4"
      flush
    >
      {theirs.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-muted">Nothing paid yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Invoice</Th>
              <Th>Method</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {theirs.map((payment) => {
              const doc = documents.find((d) => d.id === payment.documentId);
              return (
                <tr key={payment.id}>
                  <Td>{date(payment.date, settings)}</Td>
                  <Td className="font-mono">{doc?.number || '—'}</Td>
                  <Td className="text-ink-muted">{payment.method.replace('_', ' ')}</Td>
                  <Td numeric>{money(payment.amount, doc?.currency ?? 'AUD')}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function termsName(id: string): string {
  const names: Record<string, string> = {
    due_on_receipt: 'Due on receipt',
    net_7: 'Net 7',
    net_14: 'Net 14',
    net_30: 'Net 30',
    net_60: 'Net 60',
    end_next_month: 'End of next month',
  };
  return names[id] ?? id.replace(/_/g, ' ');
}
