/**
 * Files: the output folder, the file-name pattern, and the backup folder.
 *
 * This is the only screen that needs a user gesture for folder access, which is
 * why it is in one place rather than spread across the wizard and the submit
 * dialog. The File System Access API only exists in Chromium browsers, and the
 * permission it grants does not survive a browser restart — so the screen says both
 * things plainly rather than letting a silent fallback look like success.
 */

import { useEffect, useState } from 'react';
import { FolderOpen, HardDriveDownload } from 'lucide-react';
import { files, platform, storage } from '@/adapters';
import { useAppStore } from '@/state/app';
import { getGoogleAccessToken, ensureDriveFolder } from '@/lib/cloudSync';
import { formatDateForFilename } from '@/core/validation/dates';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Panel,
  Select,
  Switch,
  TextInput,
  useToast,
} from '@/ui/components/base';

const TOKENS = [
  ['{number}', 'Document number'],
  ['{client}', 'Client name'],
  ['{date}', 'Issue date'],
  ['{type}', 'Document type'],
  ['{profile}', 'Business code'],
  ['{year}', 'Four-digit year'],
  ['{financial_year}', 'e.g. 2026-27'],
] as const;

export function FilesSection() {
  const { push } = useToast();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const capabilities = useAppStore((s) => s.capabilities);
  const today = useAppStore((s) => s.today);

  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);

  useEffect(() => {
    void storage().estimateSize().then(setUsage);
  }, []);

  if (!settings) return null;
  const set = (changes: Partial<typeof settings>) => void saveSettings({ ...settings, ...changes });

  const chooseOutput = async () => {
    setBusy(true);
    try {
      const ref = await files().chooseOutputFolder();
      if (!ref) return;
      // The handle cannot be serialised back into the database, so only the name is
      // stored; the permission itself is re-requested by the next write.
      await files().saveAs(
        'duly-output-folder.txt',
        `Duly was set to write PDFs into: ${ref.name}\nRe-choose the folder if it cannot find it.`,
      );
      set({ outputFolderName: ref.name, outputFolderHandle: ref.token });
      push({
        tone: 'success',
        title: `Output folder set to ${ref.name}`,
        description: 'Duly will ask again after a browser restart — that is the browser’s rule, not Duly’s.',
      });
    } finally {
      setBusy(false);
    }
  };

  const chooseBackup = async () => {
    setBusy(true);
    try {
      const ref = await files().chooseBackupFolder();
      if (!ref) return;
      set({ backupFolderName: ref.name, backupFolderHandle: ref.token });
      push({ tone: 'success', title: `Backups will be written to ${ref.name}` });
    } finally {
      setBusy(false);
    }
  };

  const patternInvalid = /[\\/:*?"<>|]/.test(settings.fileNamePattern);

  return (
    <div className="space-y-4">
      {!capabilities.fileSystemAccess && (
        <Alert tone="warning" title="This browser cannot write into a folder you choose">
          The File System Access API exists in Chrome and Edge on a computer, and nowhere else, so Duly
          cannot file submitted PDFs into a folder automatically from this browser. Everything else works:
          you can still submit, and export or download a PDF by hand at any time — nothing downloads on
          submit unless you set "After submit" to "Automatically download a PDF". For automatic filing,
          use Chrome or Edge, or the desktop app.
        </Alert>
      )}

      <Panel
        title="Output folder"
        description="Where submitted PDFs are written automatically, with no dialog."
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<FolderOpen className="size-3.5" aria-hidden />}
            loading={busy}
            disabled={!capabilities.fileSystemAccess}
            onClick={() => void chooseOutput()}
          >
            {settings.outputFolderName ? 'Change folder' : 'Choose folder'}
          </Button>
        }
      >
        <p className="text-[13px] text-ink">
          {settings.outputFolderName ? (
            <span className="font-mono">{settings.outputFolderName}</span>
          ) : (
            <span className="text-ink-muted">No folder chosen yet</span>
          )}
        </p>
        <p className="mt-1 text-[12px] text-ink-muted">
          The browser only grants access for the current session, so Duly asks again after a restart. That is
          the browser's rule; there is no way around it and Duly does not pretend otherwise.
        </p>
      </Panel>

      <Panel
        title="When you submit"
        description="What happens after a document is finalised. The default just adds it to the list."
      >
        <div className="grid gap-3">
          <Field label="After submit">
            <Select
              value={settings.onSubmitAction}
              onChange={(e) =>
                saveSettings({
                  ...settings,
                  onSubmitAction: e.target.value as 'submit_only' | 'download_pdf' | 'open_email',
                })
              }
            >
              <option value="submit_only">Just submit</option>
              <option value="download_pdf">Automatically download a PDF</option>
              <option value="open_email">Automatically open my mail app</option>
            </Select>
          </Field>
          <Field
            label="Mail app"
            hint="Which mailbox opens. Gmail, Outlook and Proton Mail open a pre-filled web compose; the OS default opens your computer's mail app."
          >
            <Select
              value={settings.webmailProvider}
              onChange={(e) =>
                saveSettings({
                  ...settings,
                  webmailProvider: e.target.value as 'mailto' | 'gmail' | 'outlook' | 'proton',
                })
              }
            >
              <option value="mailto">My computer's mail app</option>
              <option value="gmail">Gmail</option>
              <option value="outlook">Microsoft Outlook</option>
              <option value="proton">Proton Mail</option>
            </Select>
          </Field>
        </div>
      </Panel>


      <Card>
        <h3 className="eyebrow">File names and folders</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="File-name pattern"
            hint="Tokens are filled in when a document is filed"
            error={patternInvalid ? 'A file name cannot contain / \\ : * ? " < > |' : undefined}
          >
            <TextInput
              monospace
              invalid={patternInvalid}
              value={settings.fileNamePattern}
              onChange={(e) => set({ fileNamePattern: e.target.value })}
            />
          </Field>

          <Field label="Year folder">
            <Select
              value={settings.yearFolderMode}
              onChange={(e) => set({ yearFolderMode: e.target.value as 'calendar' })}
            >
              <option value="calendar">By calendar year, e.g. 2026/</option>
              <option value="financial">By financial year, e.g. 2026-27/</option>
              <option value="none">No year folder</option>
            </Select>
          </Field>
        </div>

        <div className="mt-2">
          <p className="mb-1.5 text-[12px] font-medium text-ink">Tokens</p>
          <ul className="flex flex-wrap gap-2">
            {TOKENS.map(([token, description]) => (
              <li key={token} title={description}>
                <span className="inline-block rounded-[6px] bg-paper-sunken px-2 py-1 font-mono text-[11px] text-accent">
                  {token}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-3 text-[12px] text-ink-muted">
          An invoice for Acme today would be written to{' '}
          <span className="font-mono text-ink">
            {examplePath(settings, formatDateForFilename(today), 'INV-2026-0001', 'Acme')}
          </span>
        </p>

        <div className="mt-3 space-y-2.5 border-t border-rule pt-3">
          <Checkbox
            checked={settings.useBusinessSubFolder}
            label="Give each business its own sub-folder"
            onChange={(useBusinessSubFolder) => set({ useBusinessSubFolder })}
          />
          <Checkbox
            checked={settings.autoFileOnSubmit}
            label="Write the PDF when a document is submitted"
            onChange={(autoFileOnSubmit) => set({ autoFileOnSubmit })}
          />
          <Checkbox
            checked={settings.autoFileOnPayment}
            label="Rewrite the PDF when a payment is recorded"
            onChange={(autoFileOnPayment) => set({ autoFileOnPayment })}
          />
          <Checkbox
            checked={settings.autoFileOnVoid}
            label="Rewrite the PDF when a document is voided"
            onChange={(autoFileOnVoid) => set({ autoFileOnVoid })}
          />
        </div>
      </Card>

      <CloudSyncPanel />

      <Panel
        title="Backups"
        description="A copy of your whole database, written to a folder you choose."
        actions={
          <Button
            size="sm"
            icon={<HardDriveDownload className="size-3.5" aria-hidden />}
            loading={busy}
            disabled={!capabilities.fileSystemAccess}
            onClick={() => void chooseBackup()}
          >
            {settings.backupFolderName ? 'Change backup folder' : 'Choose backup folder'}
          </Button>
        }
      >
        <div className="space-y-2.5">
          <Checkbox
            checked={settings.backupEnabled}
            label="Keep a daily backup"
            onChange={(backupEnabled) => set({ backupEnabled })}
          />
          <Checkbox
            checked={settings.backupOnQuit}
            label="Also take a backup when Duly closes"
            onChange={(backupOnQuit) => set({ backupOnQuit })}
          />
          <Field label="How many backups to keep" className="max-w-xs">
            <TextInput
              type="number"
              min={1}
              max={365}
              value={String(settings.backupKeep)}
              onChange={(e) => set({ backupKeep: Math.max(1, Number(e.target.value) || 30) })}
            />
          </Field>
        </div>

        <p className="mt-3 text-[12px] text-ink-muted">
          Folder:{' '}
          {settings.backupFolderName ? (
            <span className="font-mono text-ink">{settings.backupFolderName}</span>
          ) : (
            <span className="text-ink-faint">none chosen</span>
          )}
          {settings.lastBackupAt && (
            <>
              {' · '}last backup {new Date(settings.lastBackupAt).toLocaleString('en-AU')}
              {settings.lastBackupName && (
                <span className="text-ink-faint"> ({settings.lastBackupName})</span>
              )}
            </>
          )}
        </p>

        <p className="mt-1 text-[12px] text-ink-faint">
          Point this at an iCloud Drive, OneDrive or Google Drive folder and your backups are copied off this
          machine for free. Restoring a backup is in Settings → Data.
        </p>
      </Panel>

      <Card>
        <h3 className="eyebrow">What Duly can and cannot do here</h3>
        <ul className="mt-2 space-y-1 text-[12px] text-ink-muted">
          <li>Platform: {platform().name}</li>
          <li>Write to a chosen folder: {capabilities.fileSystemAccess ? 'yes' : 'no, downloads instead'}</li>
          <li>Send email directly: {capabilities.directMail ? 'yes' : 'no, opens your mail app'}</li>
          <li>
            Keep passwords between sessions: {capabilities.persistentSecrets ? 'yes' : 'no, session only'}
          </li>
          <li>Works with the network off: {capabilities.offline ? 'yes' : 'no'}</li>
          <li>
            Space in use:{' '}
            {usage === null
              ? 'unknown'
              : usage > 1_000_000
                ? `${(usage / 1_000_000).toFixed(1)} MB`
                : `${Math.round(usage / 1000)} kB`}
          </li>
        </ul>
      </Card>
    </div>
  );
}

/** A worked example, because tokens are easy to get wrong and hard to picture. */
function examplePath(
  settings: { fileNamePattern: string; yearFolderMode: string; useBusinessSubFolder: boolean },
  date: string,
  number: string,
  client: string,
): string {
  const parts: string[] = [];
  if (settings.useBusinessSubFolder) parts.push('Business name');
  if (settings.yearFolderMode === 'calendar') parts.push(date.slice(0, 4));
  else if (settings.yearFolderMode === 'financial') {
    const y = Number(date.slice(0, 4));
    parts.push(
      date.slice(5, 7) >= '07' ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`,
    );
  }
  parts.push(client);

  const values: Record<string, string> = {
    number,
    client,
    date,
    day: date.slice(8, 10),
    month: date.slice(5, 7),
    year: date.slice(0, 4),
    type: 'INV',
    profile: 'PRO',
    financial_year: `${date.slice(0, 4)}-${String(Number(date.slice(0, 4)) + 1).slice(2)}`,
  };

  parts.push(
    settings.fileNamePattern.replace(/\{([a-z_]+)\}/gi, (_m, key: string) => values[key.toLowerCase()] ?? ''),
  );

  return parts.filter(Boolean).join('/');
}

/**
 * Cloud sync: submitted invoices uploaded to the user's own Google Drive, so
 * they are not relying on device storage alone. The OAuth client id is the
 * user's — free to create, localhost allowed — and the token is requested
 * without a popup once access has been granted.
 *
 * Proton Drive is honestly not here: Proton has no public Drive API, so the
 * panel says what the alternative is (Proton Mail via Bridge) rather than
 * faking a sync.
 */
function CloudSyncPanel() {
  const { push } = useToast();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const [clientId, setClientId] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) setClientId(settings.cloudClientId);
  }, [settings]);

  if (!settings) return null;

  const connect = async () => {
    const id = clientId.trim();
    if (!id) {
      push({ tone: 'warning', title: 'Paste an OAuth client id first', description: 'Google Cloud Console → APIs & Services → Credentials. Free; localhost is allowed.' });
      return;
    }
    await saveSettings({ ...settings, cloudClientId: id, updatedAt: new Date().toISOString() });
    setTesting(true);
    try {
      const token = await getGoogleAccessToken(id);
      if (!token) {
        push({ tone: 'error', title: 'Could not reach Google', description: 'Check the client id, and that the origin is in its authorised JavaScript origins.' });
        return;
      }
      const folderId = await ensureDriveFolder(token, settings.cloudFolderName || 'Duly');
      if (!folderId) {
        push({ tone: 'error', title: 'Could not create the Drive folder' });
        return;
      }
      await saveSettings({ ...settings, cloudClientId: id, updatedAt: new Date().toISOString() });
      push({ tone: 'success', title: 'Google Drive connected', description: `Submitted invoices upload to ${settings.cloudFolderName || 'Duly'}/ in your Drive.` });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    await saveSettings({ ...settings, cloudClientId: '', updatedAt: new Date().toISOString() });
    setClientId('');
    push({ tone: 'success', title: 'Google Drive disconnected' });
  };

  return (
    <Panel
      title="Cloud sync"
      description="Submitted invoices upload to your own Google Drive, so they are not relying on this device alone."
    >
      <div className="grid gap-3">
        {settings.cloudClientId ? (
          <>
            <p className="text-[13px] text-ink">
              Connected — invoices upload to <span className="font-mono">{settings.cloudFolderName || 'Duly'}</span>/ in your Drive on submit.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Drive folder" inline>
                <TextInput
                  value={settings.cloudFolderName}
                  onChange={(e) => void saveSettings({ ...settings, cloudFolderName: e.target.value, updatedAt: new Date().toISOString() })}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            <Switch
              checked={settings.cloudSyncOnSubmit}
              onChange={(v) => void saveSettings({ ...settings, cloudSyncOnSubmit: v, updatedAt: new Date().toISOString() })}
              label="Upload on submit"
            />
          </>
        ) : (
          <>
            <Field
              label="Google OAuth client id"
              hint="Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). Free; add http://localhost:5183 as an authorised origin."
            >
              <TextInput
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void connect()} loading={testing}>
                Connect Google Drive
              </Button>
            </div>
          </>
        )}
        <Alert tone="info" title="About Proton Drive">
          Proton has no public Drive API — their storage is end-to-end encrypted and closed to third-party apps,
          so no invoicing app can sync to it directly. The Proton option that works is Proton Mail via Bridge
          (Settings → Email accounts), which sends the invoice itself. Files still land on your device first;
          the Drive copy is a second copy, not the only one.
        </Alert>
      </div>
    </Panel>
  );
}
