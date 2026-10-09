/**
 * Data: JSON export, import, backups and the size of everything.
 *
 * The JSON file is the whole database, and it is the migration path to the desktop
 * build — the plan says "JSON export/import of the whole database (also the bridge
 * to the desktop version later)", so the export has to be complete and the import
 * has to be trustworthy.
 *
 * Two details make it trustworthy. A backup is taken automatically before any
 * import, so a bad file is never the end of the data. And "replace" clears each
 * table before writing, so importing an old export cannot leave orphaned rows from
 * what came before.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, History, Trash2, Upload } from 'lucide-react';
import type { DataSnapshot } from '@/adapters/types';
import { files, storage } from '@/adapters';
import { SchemaTooNewError } from '@/adapters/web/version';
import { useAppStore } from '@/state/app';
import { Alert, Button, ConfirmDialog, Panel, Switch, Table, Td, Th, useToast } from '@/ui/components/base';
import { recalculateDocument } from '@/lib/documentService';
import { countLabel } from '@/ui/lib/format';
import {
  myobContactsCsv,
  myobInvoicesCsv,
  myobPaymentsCsv,
  xeroContactsCsv,
  xeroInvoicesCsv,
  xeroPaymentsCsv,
  gstBasPeriodsCsv,
} from '@/lib/accountant';
import { zipBlob } from '@/lib/exports';
import { platform } from '@/adapters';

export function DataSection() {
  const { push } = useToast();
  const documents = useAppStore((s) => s.documents);
  const clients = useAppStore((s) => s.clients);
  const items = useAppStore((s) => s.items);
  const profiles = useAppStore((s) => s.profiles);
  const attachments = useAppStore((s) => s.attachments);
  const refresh = useAppStore((s) => s.refresh);
  const boot = useAppStore((s) => s.boot);

  const [busy, setBusy] = useState('');
  const [usage, setUsage] = useState<number | null>(null);
  const [backups, setBackups] = useState<
    { id: string; name: string; createdAt: string; sizeBytes: number }[]
  >([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pending, setPending] = useState<{ snapshot: DataSnapshot; fileName: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setUsage(await storage().estimateSize());
    setBackups(await storage().listBackups());
    setPersisted(storage().persisted);
  };

  useEffect(() => {
    void reload();
  }, []);

  const exportJson = async () => {
    setBusy('export');
    try {
      const snapshot = await storage().exportSnapshot();
      const stamp = new Date().toISOString().slice(0, 10);
      await files().saveAs(`duly-backup-${stamp}.json`, JSON.stringify(snapshot, null, 2));
      push({
        tone: 'success',
        title: 'Backup downloaded',
        description: 'Keep it somewhere safe — it is a complete copy of Duly’s data.',
      });
    } finally {
      setBusy('');
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text) as DataSnapshot;
      if (typeof snapshot.schemaVersion !== 'number') throw new Error('That file has no schema version');
      setPending({ snapshot, fileName: file.name });
    } catch (error) {
      push({
        tone: 'error',
        title: 'That file could not be read',
        description: error instanceof Error ? error.message : 'It may not be a Duly backup.',
      });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImport = async (mode: 'replace' | 'merge') => {
    if (!pending) return;
    setBusy('import');
    try {
      const result = await storage().importSnapshot(pending.snapshot, mode);
      setPending(null);
      await refresh();
      await boot();
      await reload();
      push({
        tone: 'success',
        title: mode === 'replace' ? 'Database replaced' : 'Records merged in',
        description: `${result.imported} imported${result.skipped ? `, ${result.skipped} skipped` : ''}. A backup was taken first.`,
      });
    } catch (error) {
      push({
        tone: 'error',
        title: 'That import did not finish',
        description:
          error instanceof SchemaTooNewError ? error.message : error instanceof Error ? error.message : '',
      });
    } finally {
      setBusy('');
    }
  };

  const restore = async (id: string) => {
    setBusy('restore');
    try {
      await storage().restoreBackup(id);
      setRestoring(null);
      await boot();
      await reload();
      push({ tone: 'success', title: 'Backup restored' });
    } catch (error) {
      push({
        tone: 'error',
        title: 'That backup could not be restored',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setBusy('');
    }
  };

  const makeBackup = async () => {
    setBusy('backup');
    try {
      await storage().createBackup(`manual-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
      await reload();
      push({
        tone: 'success',
        title: 'Backup taken',
        description: 'Stored inside your database, so it survives.',
      });
    } finally {
      setBusy('');
    }
  };

  const removeBackup = async (id: string) => {
    await storage().deleteBackup(id);
    await reload();
  };

  return (
    <div className="space-y-4">
      <Panel
        title="What is in your database"
        description={
          persisted === false
            ? 'Everything Duly holds, all on this machine. The browser has not granted durable storage, so it may evict data under storage pressure — keep a JSON export.'
            : 'Everything Duly holds, all on this machine. Durable storage is granted; the browser will not evict it.'
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Count label="Businesses" value={profiles.length} />
          <Count label="Clients" value={clients.length} />
          <Count label="Items" value={items.length} />
          <Count label="Documents" value={documents.length} />
          <Count label="Attachments" value={attachments.length} />
          <Count
            label="Space used"
            value={
              usage === null
                ? '—'
                : usage > 1_000_000
                  ? `${(usage / 1_000_000).toFixed(1)} MB`
                  : `${Math.round(usage / 1000)} kB`
            }
            text
          />
        </div>
      </Panel>

      <Panel
        title="Export and import"
        description="A single JSON file holding everything. This is also how data moves to the desktop app."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Download className="size-3.5" aria-hidden />}
            loading={busy === 'export'}
            onClick={() => void exportJson()}
          >
            Export a backup
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a backup file to import"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          <Button icon={<Upload className="size-3.5" aria-hidden />} onClick={() => fileRef.current?.click()}>
            Import a backup
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-ink-muted">
          A backup is taken automatically before anything is imported, so a bad file can never be the end of
          your data.
        </p>
      </Panel>

      <AccountantExportPanel />

      <DesktopPanel />

      <Panel
        title="Backups in this database"
        description="Kept inside Duly itself, so they travel with an export."
        actions={
          <Button
            size="sm"
            icon={<History className="size-3.5" aria-hidden />}
            loading={busy === 'backup'}
            onClick={() => void makeBackup()}
          >
            Take one now
          </Button>
        }
        flush
      >
        {backups.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No backups yet. Duly takes one automatically before every import.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Taken</Th>
                <Th>Name</Th>
                <Th align="right">Size</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <Td>{new Date(backup.createdAt).toLocaleString('en-AU')}</Td>
                  <Td className="font-mono text-[12px]">{backup.name}</Td>
                  <Td align="right">
                    {backup.sizeBytes > 1_000_000
                      ? `${(backup.sizeBytes / 1_000_000).toFixed(1)} MB`
                      : `${Math.round(backup.sizeBytes / 1000)} kB`}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setRestoring(backup.id)}>
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="size-3.5" aria-hidden />}
                        onClick={() => void removeBackup(backup.id)}
                      >
                        Delete
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Alert tone="info" title="Passwords are not in the export">
        Email account passwords live in your operating system&apos;s keychain, never in the database, so a
        backup file can never leak a mailbox password. You will type those passwords again on a new machine.
      </Alert>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => void applyImport('replace')}
        title="Replace everything with this file?"
        confirmLabel="Replace"
        danger
        body={
          pending
            ? `${pending.fileName} holds ${countLabel(
                pending.snapshot.businessProfiles?.length ?? 0,
                'business',
                'businesses',
              )}, ${countLabel(pending.snapshot.clients?.length ?? 0, 'client')} and ${countLabel(
                pending.snapshot.documents?.length ?? 0,
                'document',
              )}. Everything currently in Duly is replaced — a backup is taken first.`
            : ''
        }
      />

      <ConfirmDialog
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring && void restore(restoring)}
        title="Restore this backup?"
        confirmLabel="Restore"
        danger
        body="Your current database is replaced by the backup. A backup of the current state is taken first, so this can be undone."
      />
    </div>
  );
}

/**
 * Accountant exports: the CSV layouts Xero and MYOB import, plus the GST
 * summary per BAS period. One ZIP per system, so the accountant gets
 * everything in one file.
 */
function AccountantExportPanel() {
  const { push } = useToast();
  const documents = useAppStore((s) => s.documents);
  const clients = useAppStore((s) => s.clients);
  const payments = useAppStore((s) => s.payments);

  const exportFor = async (system: 'xero' | 'myob') => {
    try {
      // Scoped to the active business, and calculated through the same
      // service everything else uses — the accountant gets the frozen tax
      // codes an issued document carries, and per-line figures.
      const activeProfile = useAppStore.getState().profiles[0];
      const taxCodes = await storage().listTaxCodes();
      const invoiceBundles = await Promise.all(
        documents
          .filter(
            (d) =>
              d.type === 'invoice' &&
              d.status !== 'draft' &&
              d.status !== 'void' &&
              (!activeProfile || d.profileId === activeProfile.id),
          )
          .map(async (d) => {
            const lines = await storage().listDocumentLines(d.id);
            const { result } = await recalculateDocument({
              document: d,
              lines,
              save: false,
              deriveStatus: false,
            });
            return { document: d, lines, result };
          }),
      );
      const scopedPayments = payments.filter(
        (p) => !activeProfile || documents.find((d) => d.id === p.documentId)?.profileId === activeProfile.id,
      );
      const scopedDocuments = documents.filter((d) => !activeProfile || d.profileId === activeProfile.id);
      const csvs =
        system === 'xero'
          ? [
              { name: 'contacts.csv', data: xeroContactsCsv(clients) },
              { name: 'invoices.csv', data: xeroInvoicesCsv(invoiceBundles, clients, taxCodes) },
              { name: 'payments.csv', data: xeroPaymentsCsv(scopedPayments, documents) },
              { name: 'gst-bas-periods.csv', data: gstBasPeriodsCsv(scopedDocuments) },
            ]
          : [
              { name: 'contacts.csv', data: myobContactsCsv(clients) },
              { name: 'sales.csv', data: myobInvoicesCsv(invoiceBundles, clients, taxCodes) },
              { name: 'payments.csv', data: myobPaymentsCsv(scopedPayments, documents) },
              { name: 'gst-bas-periods.csv', data: gstBasPeriodsCsv(scopedDocuments) },
            ];
      await files().saveAs(`duly-${system}-export.zip`, zipBlob(csvs));
      push({
        tone: 'success',
        title: `${system === 'xero' ? 'Xero' : 'MYOB'} export downloaded`,
        description: `${csvs.length} files. The column layouts are the import formats those systems document.`,
      });
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not export',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  return (
    <Panel
      title="Accountant exports"
      description="Contacts, invoices, payments and the GST summary per BAS period, in the CSV layouts Xero and MYOB import."
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void exportFor('xero')}>Download Xero CSVs</Button>
        <Button onClick={() => void exportFor('myob')}>Download MYOB CSVs</Button>
      </div>
    </Panel>
  );
}

/**
 * Desktop-only settings: launch at login, so schedules and reminders fire on
 * time even when the window is closed. Hidden on the web build, which has no
 * login item concept.
 */
function DesktopPanel() {
  const { push } = useToast();
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);

  useEffect(() => {
    const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!tauri) return;
    void (async () => {
      try {
        setLaunchAtLogin((await platform().autostartIsEnabled?.()) ?? false);
      } catch {
        setLaunchAtLogin(false);
      }
    })();
  }, []);

  if (launchAtLogin === null) return null;

  const toggle = async (value: boolean) => {
    setLaunchAtLogin(value);
    try {
      if (value) await platform().autostartEnable?.();
      else await platform().autostartDisable?.();
    } catch (error) {
      setLaunchAtLogin(!value);
      push({
        tone: 'error',
        title: 'Could not change the login item',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  return (
    <Panel
      title="Desktop"
      description="Runs while the window is closed, so schedules and reminders fire on time."
    >
      <Switch checked={launchAtLogin} onChange={(v) => void toggle(v)} label="Launch at login" />
    </Panel>
  );
}

function Count({ label, value, text }: { label: string; value: string | number; text?: boolean }) {
  return (
    <div className="rounded-[8px] border border-rule px-3 py-2">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">{label}</p>
      <p
        className={
          text ? 'text-[15px] font-medium text-ink' : 'num font-display text-xl font-semibold text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}
