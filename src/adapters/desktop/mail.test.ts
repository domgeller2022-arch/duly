/**
 * A real send must go out as the account's own address, not the business's.
 *
 * The re-audit found every real send used the business profile's email as
 * From, so a Proton Bridge account sent as an address it does not authenticate
 * as — which the relay rejects — and the account's own address never appeared.
 * The adapter resolves the From from the account it is about to authenticate
 * with; this drives `send` with a mock `invoke` and asserts the payload.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokes } = vi.hoisted(() => ({
  invokes: [] as { args: Record<string, unknown> }[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (_command: string, payload: { args: Record<string, unknown> }) => {
    invokes.push(payload);
    return { ok: true, error: null };
  },
}));

import { createWebPlatform, setPlatform } from '@/adapters';
import { DesktopMailAdapter } from './mail';
import { emailAccountSchema } from '@/core/schemas/settings';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-mail-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

describe('DesktopMailAdapter.send', () => {
  it("sends as the account's own address, not the business's", async () => {
    const db = await freshStorage();
    const account = emailAccountSchema.parse(
      newEntity({
        name: 'Bridge',
        provider: 'proton_bridge',
        fromName: 'Bridge Sender',
        fromEmail: 'me@proton.me',
        host: '127.0.0.1',
        port: 1025,
        secure: false,
        starttls: true,
        secretRef: 'smtp:acct',
        pinnedCertificateFingerprint: 'trusted',
      }),
    );
    await db.saveEmailAccount(account);

    invokes.length = 0;
    const adapter = new DesktopMailAdapter();
    const result = await adapter.send({
      accountId: account.id,
      fromName: 'Acme Business',
      fromEmail: 'business@acme.com',
      to: ['client@example.com'],
      subject: 'Invoice',
      body: 'Hi',
      attachments: [],
    });

    expect(result.ok).toBe(true);
    expect(invokes[0].args.fromEmail).toBe('me@proton.me');
    expect(invokes[0].args.fromName).toBe('Bridge Sender');
    expect(invokes[0].args.secretKey).toBe('smtp:acct');
    expect(invokes[0].args.pinnedFingerprint).toBe('trusted');
  });
});
