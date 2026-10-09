/**
 * Cloud sync: invoices saved to the user's own Google Drive.
 *
 * The user asked to stop relying on device storage alone. Google Drive is
 * free and has a public API, so this is real: OAuth through Google's
 * Identity Services (a client ID the user creates once, free, with localhost
 * allowed), a token requested with `prompt: ''` — which returns without a
 * popup once the user has granted — and a multipart upload into a "Duly"
 * folder the API creates on first use.
 *
 * Proton Drive is honestly not supported: Proton has no public Drive API —
 * it is end-to-end encrypted and closed to third-party apps. The Proton
 * option that exists is Proton Mail via Bridge, which the email accounts
 * screen sets up. The UI says so rather than faking a sync.
 *
 * Scope: drive.file — the least privilege that works. Duly can only see and
 * create files it made, never the rest of the user's Drive.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Load Google's Identity Services script once; null when offline. */
function loadGis(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) return resolve(true);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleGlobal {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (args: {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string; error?: string }) => void;
        }) => GoogleTokenClient;
      };
    };
  };
}

/**
 * An access token for the Drive API.
 *
 * `prompt: ''` means: no consent popup when the user has already granted.
 * The first connect (from the settings screen, a click) shows the popup once.
 */
export function getGoogleAccessToken(clientId: string): Promise<string | null> {
  return (async () => {
    const loaded = await loadGis();
    if (!loaded) return null;
    const google = (window as unknown as GoogleGlobal).google;
    if (!google?.accounts?.oauth2) return null;

    return new Promise<string | null>((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => resolve(response.access_token ?? null),
      });
      // A token request needs a user gesture; every caller is a click on
      // submit or on the settings' connect button.
      client.requestAccessToken({ prompt: '' });
    });
  })();
}

/** The "Duly" folder: found by name, created when missing. */
export async function ensureDriveFolder(accessToken: string, folderName = 'Duly'): Promise<string | null> {
  const query = encodeURIComponent(
    `name='${folderName.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (found.ok) {
    const data = (await found.json()) as { files?: { id: string }[] };
    if (data.files && data.files.length > 0) return data.files[0].id;
  }

  const created = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }),
  });
  if (!created.ok) return null;
  const data = (await created.json()) as { id?: string };
  return data.id ?? null;
}

/** Upload one file into the folder. Returns the Drive file id. */
export async function uploadToDrive(
  fileName: string,
  data: Blob | string,
  options: { accessToken: string; folderId?: string | null },
): Promise<string | null> {
  const metadata: Record<string, unknown> = { name: fileName };
  if (options.folderId) metadata.parents = [options.folderId];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(
    'file',
    typeof data === 'string' ? new Blob([data], { type: 'application/pdf' }) : data,
  );

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.accessToken}` },
    body: form,
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { id?: string };
  return payload.id ?? null;
}

/**
 * Sync one document: token, folder, upload.
 *
 * Returns a human-readable outcome the automation log records — a failure
 * here never blocks the submit; the file is still on the device.
 */
export async function syncDocumentToDrive(
  fileName: string,
  data: Blob | string,
  options: { clientId: string; folderName?: string },
): Promise<{ ok: boolean; detail: string }> {
  const token = await getGoogleAccessToken(options.clientId);
  if (!token) {
    return {
      ok: false,
      detail: 'Could not reach Google Drive (offline, or the OAuth client id is wrong). The file is still on this device.',
    };
  }
  const folderId = await ensureDriveFolder(token, options.folderName ?? 'Duly');
  const fileId = await uploadToDrive(fileName, data, { accessToken: token, folderId });
  if (!fileId) {
    return { ok: false, detail: 'The upload to Google Drive failed. The file is still on this device.' };
  }
  return { ok: true, detail: `Uploaded to Google Drive (${options.folderName ?? 'Duly'}/${fileName}).` };
}
