/**
 * The style guide.
 *
 * Phase 0 is accepted when "the shell loads with the network disabled, switches
 * light/dark, and every base component appears on a style-guide page". This is
 * that page: every component in `ui/components/base.tsx`, every token, both
 * themes.
 *
 * It is reachable at /style-guide in any build, not just development, because a
 * design system nobody can inspect is a design system that drifts.
 */

import { useState } from 'react';
import { Check, Download, Plus, Search, Trash2, Wrench } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  CurrencyInput,
  Dialog,
  Divider,
  EmptyState,
  Field,
  IconButton,
  IndeterminateBar,
  KeyValue,
  Menu,
  MenuItem,
  MenuSeparator,
  NumberInput,
  Panel,
  Progress,
  Row,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Td,
  TextArea,
  TextInput,
  Th,
  Tooltip,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { useAppStore } from '@/state/app';
import { cn } from '@/ui/lib/cn';
import { CURRENCIES } from '@/core/money/currencies';

/* ------------------------------------------------------------------ */
/* Section wrapper                                                     */
/* ------------------------------------------------------------------ */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-6">
      <div className="mb-3">
        <h2 className="font-display text-[17px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr] sm:items-start sm:gap-4">
      <span className="pt-1 text-[11px] tracking-[0.06em] text-ink-faint uppercase">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function StyleGuideScreen() {
  const { push } = useToast();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const [openDialog, setOpenDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState('one');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [minor, setMinor] = useState(123456);
  const [qty, setQty] = useState('7.25');
  const [progress, setProgress] = useState(62);

  const isDark = (settings?.theme ?? 'system') === 'dark';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Style guide"
        subtitle="Every base component, in both themes. Duly looks like quiet stationery: warm paper, ink text, hairline rules and one confident accent."
        actions={
          <>
            <Button
              icon={<Wrench className="size-3.5" aria-hidden />}
              onClick={() => {
                if (!settings) return;
                void saveSettings({ ...settings, theme: isDark ? 'light' : 'dark' });
              }}
            >
              {isDark ? 'Switch to light' : 'Switch to dark'}
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setOpenDialog(true)}
            >
              New thing
            </Button>
          </>
        }
        className="mb-6"
      />

      {/* ---- colour ---- */}
      <Section
        title="Colour"
        description="Warm paper tones, ink text, hairline rules and one accent. Status colours are used sparingly."
      >
        <Card>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Swatch name="Paper" className="bg-paper" />
            <Swatch name="Raised" className="bg-paper-raised" />
            <Swatch name="Sunken" className="bg-paper-sunken" />
            <Swatch name="Rule" className="bg-rule" />
            <Swatch name="Ink" className="bg-ink" />
            <Swatch name="Ink muted" className="bg-ink-muted" />
            <Swatch name="Ink faint" className="bg-ink-faint" />
            <Swatch name="Accent" className="bg-accent" />
            <Swatch name="Paid" className="bg-paid" />
            <Swatch name="Due soon" className="bg-due" />
            <Swatch name="Overdue" className="bg-overdue" />
            <Swatch name="Neutral" className="bg-neutral" />
          </div>
        </Card>
      </Section>

      {/* ---- type ---- */}
      <Section
        title="Type"
        description="Headings in the serif, data in the sans, money in tabular figures so columns of amounts line up."
      >
        <Card className="space-y-3">
          <p className="font-display text-3xl font-semibold tracking-tight text-ink">
            Display · Fraunces 30/600
          </p>
          <p className="font-serif text-2xl font-semibold text-ink">Serif heading · Source Serif 4 24/600</p>
          <p className="font-display text-xl font-semibold text-ink">Section heading · Fraunces 20/600</p>
          <p className="text-[15px] text-ink">
            Body text · Inter 15/400 — the comfortable reading size for a line of prose.
          </p>
          <p className="text-[13px] text-ink-muted">Secondary text · Inter 13/400, in muted ink.</p>
          <p className="eyebrow">Eyebrow · Inter 11/600, letterspaced, uppercase</p>
          <p className="num text-[15px] text-ink">
            Tabular figures · $1,234,567.89 — every digit the same width
          </p>
          <p className="num text-[15px] text-ink">Accounting negative · ($1,234.56)</p>
          <p className="font-mono text-[13px] text-ink-muted">
            Mono · IBM Plex Mono 13/400 — for codes and patterns
          </p>
        </Card>
      </Section>

      {/* ---- shape ---- */}
      <Section
        title="Shape"
        description="8px corners, 1px hairline borders, no heavy shadows, 150ms transitions."
      >
        <Card>
          <Row>
            <div className="flex size-24 items-center justify-center rounded-[4px] border border-rule text-[11px] text-ink-faint">
              4px
            </div>
            <div className="flex size-24 items-center justify-center rounded-[8px] border border-rule text-[11px] text-ink-faint">
              8px
            </div>
            <div className="flex size-24 items-center justify-center rounded-[12px] border border-rule text-[11px] text-ink-faint">
              12px
            </div>
            <div className="flex size-24 items-center justify-center rounded-[16px] border border-rule text-[11px] text-ink-faint">
              16px
            </div>
            <div className="flex size-24 items-center justify-center rounded-[8px] bg-paper-raised shadow-lifted text-[11px] text-ink-faint">
              lifted
            </div>
          </Row>
        </Card>
      </Section>

      {/* ---- buttons ---- */}
      <Section title="Buttons">
        <Specimen label="Variants">
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Danger</Button>
          </Row>
        </Specimen>
        <Specimen label="Sizes">
          <Row>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </Row>
        </Specimen>
        <Specimen label="With icons">
          <Row>
            <Button icon={<Plus className="size-4" aria-hidden />}>New invoice</Button>
            <Button
              icon={<Download className="size-3.5" aria-hidden />}
              iconAfter={<Check className="size-3.5" aria-hidden />}
            >
              Export
            </Button>
          </Row>
        </Specimen>
        <Specimen label="States">
          <Row>
            <Button disabled>Disabled</Button>
            <Button loading>Saving</Button>
            <Button variant="primary" disabled>
              Primary disabled
            </Button>
          </Row>
        </Specimen>
        <Specimen label="Icon buttons">
          <Row>
            <IconButton label="Search">
              <Search className="size-4" aria-hidden />
            </IconButton>
            <IconButton label="Delete" variant="danger">
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
            <IconButton label="Add" size="sm" variant="quiet">
              <Plus className="size-3.5" aria-hidden />
            </IconButton>
          </Row>
        </Specimen>
      </Section>

      {/* ---- inputs ---- */}
      <Section title="Inputs">
        <Card className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Text" hint="A hint sits under the field">
            <TextInput placeholder="Client name" />
          </Field>
          <Field label="Invalid" error="That value could not be read">
            <TextInput invalid defaultValue="12.3.4" />
          </Field>
          <Field label="Required" required>
            <TextInput placeholder="Required" />
          </Field>
          <Field label="Disabled">
            <TextInput disabled defaultValue="Not editable" />
          </Field>
          <Field label="Currency" hint="Integer minor units, never a float">
            <CurrencyInput value={minor} onChange={setMinor} currency="AUD" />
          </Field>
          <Field label="Currency with no decimals" hint="JPY has no minor unit to speak of">
            <CurrencyInput value={4500} onChange={() => {}} currency="JPY" />
          </Field>
          <Field label="Number" hint="Quantities are exact decimal strings">
            <NumberInput value={qty} onChange={setQty} />
          </Field>
          <Field label="Select">
            <Select defaultValue="net_30">
              <option value="due_on_receipt">Due on receipt</option>
              <option value="net_14">Net 14</option>
              <option value="net_30">Net 30</option>
            </Select>
          </Field>
          <Field label="Currency select">
            <Select defaultValue="AUD">
              {CURRENCIES.slice(0, 12).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Textarea">
            <TextArea placeholder="Notes printed on the document" />
          </Field>
        </Card>

        <Card className="space-y-3">
          <Checkbox checked={checked} onChange={setChecked} label="Checkbox" hint="With a hint underneath" />
          <Checkbox checked={false} onChange={() => {}} label="Unchecked" />
          <Switch
            checked={on}
            onChange={setOn}
            label="Switch"
            hint="Used for settings that take effect immediately"
          />
        </Card>
      </Section>

      {/* ---- status ---- */}
      <Section title="Chips, badges and status">
        <Card className="space-y-3">
          <Row>
            <Chip tone="accent">Accent</Chip>
            <Chip tone="paid">Paid</Chip>
            <Chip tone="due">Due in 3 days</Chip>
            <Chip tone="overdue">Overdue</Chip>
            <Chip tone="neutral">Neutral</Chip>
            <Chip tone="muted">Muted</Chip>
          </Row>
          <Row>
            <Badge>12</Badge>
            <Badge className="bg-overdue-soft text-overdue">3</Badge>
            <Chip tone="paid" icon={<Check className="size-3" aria-hidden />}>
              With an icon
            </Chip>
            <Chip tone="neutral" onClick={() => push({ tone: 'info', title: 'That chip is clickable' })}>
              Clickable
            </Chip>
          </Row>
        </Card>
      </Section>

      {/* ---- feedback ---- */}
      <Section title="Alerts">
        <Alert tone="info" title="Informational">
          Something worth knowing, said plainly.
        </Alert>
        <Alert tone="success" title="All checks passed">
          Everything the ATO requires is present.
        </Alert>
        <Alert tone="warning" title="This needs attention">
          A document will not be written until you choose a folder.
        </Alert>
        <Alert tone="error" title="Cannot submit" onDismiss={() => {}}>
          Two lines have no description, so this is not yet a valid tax invoice.
        </Alert>
      </Section>

      <Section title="Empty states">
        <Card className="p-0">
          <EmptyState
            icon={<Search className="size-7" aria-hidden />}
            title="No invoices yet"
            hint="Your first invoice takes a moment to set up. Every one after that should take under a minute."
            action={<Button variant="primary">New invoice</Button>}
          />
        </Card>
      </Section>

      {/* ---- progress ---- */}
      <Section title="Progress">
        <Card className="space-y-3">
          <Field label="Determinate">
            <Progress value={progress} label="Upload progress" />
          </Field>
          <Row>
            <Button size="sm" onClick={() => setProgress((p) => (p >= 100 ? 0 : p + 12))}>
              Advance ({progress}%)
            </Button>
          </Row>
          <Field label="Indeterminate, for a PDF render">
            <IndeterminateBar label="Rendering" />
          </Field>
        </Card>
      </Section>

      {/* ---- navigation ---- */}
      <Section title="Navigation">
        <Card className="space-y-3">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'one', label: 'Details' },
              { id: 'two', label: 'Payments', count: 3 },
              { id: 'three', label: 'History' },
            ]}
          />
          <Row>
            <Menu
              trigger={
                <Button>
                  Open a menu <ChevronPlaceholder />
                </Button>
              }
            >
              <MenuItem onClick={() => {}}>Open</MenuItem>
              <MenuItem onClick={() => {}}>Duplicate</MenuItem>
              <MenuItem onClick={() => {}}>Export PDF</MenuItem>
              <MenuSeparator />
              <MenuItem danger onClick={() => {}}>
                Delete
              </MenuItem>
            </Menu>
            <Tooltip label="Explains what this button does" side="bottom">
              <Button>Hover me</Button>
            </Tooltip>
          </Row>
        </Card>
      </Section>

      {/* ---- data ---- */}
      <Section title="Tables and key/value">
        <Panel title="Documents" description="Money columns are right-aligned and tabular." flush>
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Due</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
                <Th align="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="font-medium">INV-2026-0042</Td>
                <Td>Acme Pty Ltd</Td>
                <Td className="text-ink-muted">05/11/2026</Td>
                <Td numeric>$1,320.00</Td>
                <Td numeric className="font-medium">
                  $1,320.00
                </Td>
                <Td align="center">
                  <Chip tone="due">Due in 3 days</Chip>
                </Td>
              </tr>
              <tr>
                <Td className="font-medium">INV-2026-0041</Td>
                <Td>Beta Industries</Td>
                <Td className="text-ink-muted">01/11/2026</Td>
                <Td numeric>$980.00</Td>
                <Td numeric>
                  <span className="text-ink-faint">—</span>
                </Td>
                <Td align="center">
                  <Chip tone="paid">Paid</Chip>
                </Td>
              </tr>
              <tr>
                <Td className="font-medium">INV-2026-0040</Td>
                <Td>Cobalt Ltd</Td>
                <Td className="text-ink-muted">12/10/2026</Td>
                <Td numeric>($240.00)</Td>
                <Td numeric className="text-overdue">
                  $240.00
                </Td>
                <Td align="center">
                  <Chip tone="overdue">12 days overdue</Chip>
                </Td>
              </tr>
            </tbody>
          </Table>
        </Panel>

        <Card>
          <KeyValue
            items={[
              { label: 'Number', value: 'INV-2026-0042' },
              { label: 'Issue date', value: '06/10/2026' },
              { label: 'Due date', value: '05/11/2026' },
              { label: 'Total', value: '$1,320.00', numeric: true },
            ]}
          />
        </Card>
      </Section>

      {/* ---- layout ---- */}
      <Section title="Layout helpers">
        <Card className="space-y-3">
          <Stack gap={2}>
            <div className="sheet-flat px-3 py-2 text-[13px]">Stack, gap 2</div>
            <div className="sheet-flat px-3 py-2 text-[13px]">Second item</div>
          </Stack>
          <Divider />
          <Row gap={3}>
            <div className="sheet-flat px-3 py-2 text-[13px]">Row</div>
            <div className="sheet-flat px-3 py-2 text-[13px]">Row</div>
          </Row>
          <div className="paper-grain sheet-flat h-16 px-3 py-2 text-[13px]">Paper grain</div>
        </Card>
      </Section>

      {/* ---- density ---- */}
      <Section title="Density">
        <Card>
          <p className="text-[13px] text-ink-muted">
            Comfortable is the default. Compact tightens rows for long itemised invoices, and is a setting
            rather than a separate component.
          </p>
          <div data-density="compact" className="mt-3 space-y-1">
            {['Compact row one', 'Compact row two', 'Compact row three'].map((label) => (
              <div
                key={label}
                className="sheet-flat density-pad flex items-center justify-between px-3 text-[13px]"
              >
                <span>{label}</span>
                <span className="num text-ink-muted">$120.00</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ---- overlays ---- */}
      <Section title="Overlays">
        <Row>
          <Button onClick={() => setOpenDialog(true)}>Open a dialog</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Open a confirmation
          </Button>
        </Row>
      </Section>

      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title="A dialog"
        description="Focus is trapped inside, Escape closes, and the backdrop dims."
        footer={
          <>
            <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpenDialog(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Everything inside the app is reachable from the keyboard. A dialog moves focus to itself on open and
          returns it to whatever opened the dialog on close.
        </p>
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        danger
        title="Void this document?"
        confirmLabel="Void it"
        body="A void document is kept for the audit trail rather than deleted, and it cannot be edited afterwards."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div>
      <div className={cn('h-12 w-full rounded-[6px] border border-rule', className)} aria-hidden />
      <p className="mt-1 text-[11px] text-ink-muted">{name}</p>
    </div>
  );
}

function ChevronPlaceholder() {
  return <span className="text-[10px] text-ink-faint">▾</span>;
}
