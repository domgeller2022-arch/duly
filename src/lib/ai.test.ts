import { describe, expect, it, beforeAll } from 'vitest';
import { aiGuard, extractJson, redactForAi, runAiTask } from './ai';
import { invoiceEntryTask, invoiceEntrySchema } from './aiTasks';
import { createWebPlatform, setPlatform } from '@/adapters';
import { settingsSchema, type Settings } from '@/core/schemas';
import type { AiAdapter, AiCompletionRequest, AiCompletionResult } from '@/adapters/types';
import { calculate } from '@/core/calc/calculate';

/** A mock adapter that returns a fixed reply — the pipeline is what's under test. */
function mockAdapter(reply: string, calls: { request: AiCompletionRequest }[] = []): AiAdapter {
  return {
    name: 'mock',
    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      calls.push({ request });
      return { ok: true, content: reply, tokens: 42 };
    },
  };
}

function settingsWith(overrides: Record<string, unknown>): Settings {
  const now = '2026-01-01T00:00:00.000Z';
  return settingsSchema.parse({
    id: 'settings',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  });
}

describe('aiGuard', () => {
  it('refuses everything when AI is switched off', () => {
    const settings = settingsWith({ aiEnabled: false });
    expect(aiGuard(settings, 'http://localhost:11434/v1')).toMatch(/switched off/i);
  });

  it('with Local-only on, a cloud endpoint is refused', () => {
    const settings = settingsWith({ aiEnabled: true, aiLocalOnly: true });
    expect(aiGuard(settings, 'https://openrouter.ai/api/v1')).toMatch(/local-only/i);
    expect(aiGuard(settings, 'http://localhost:11434/v1')).toBeNull();
    expect(aiGuard(settings, 'http://127.0.0.1:1234/v1')).toBeNull();
  });

  it('with Local-only off, a cloud endpoint is allowed', () => {
    const settings = settingsWith({ aiEnabled: true, aiLocalOnly: false });
    expect(aiGuard(settings, 'https://openrouter.ai/api/v1')).toBeNull();
  });
});

describe('extractJson', () => {
  it('reads fenced and padded JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n[1,2]')).toEqual([1, 2]);
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON/i);
  });
});

describe('redactForAi', () => {
  it('masks client names as well as ABNs and amounts', () => {
    const out = redactForAi('Acme Pty Ltd owes $1,200.00, ABN 51 824 753 556.', ['Acme Pty Ltd']);
    expect(out).not.toContain('Acme Pty Ltd');
    expect(out).toContain('[client]');
    expect(out).toContain('[amount]');
    expect(out).toContain('[ABN]');
  });
});

describe('runAiTask — the acceptance: "Bill Acme 3 days consulting at $1,200/day"', () => {
  beforeAll(() => {
    setPlatform(createWebPlatform(`duly-test-ai-${Math.random().toString(36).slice(2)}`));
  });

  const REPLY = JSON.stringify({
    clientName: 'Acme',
    lines: [{ description: 'Consulting', quantity: '3', unit: 'days', unitPriceDollars: 1200 }],
    dueDays: null,
    notes: '',
  });

  it('produces a correct draft shape, with a local model, offline', async () => {
    const platform = (await import('@/adapters')).platform();
    const calls: { request: AiCompletionRequest }[] = [];
    const original = platform.ai;
    // Point the platform's ai at the mock, keeping the rest real.
    Object.defineProperty(platform, 'ai', { value: mockAdapter(REPLY, calls), configurable: true });

    const settings = settingsWith({
      aiEnabled: true,
      aiLocalOnly: true,
      aiBaseUrl: 'http://localhost:11434/v1',
    });
    await platform.storage.saveSettings(settings);

    const result = await runAiTask(invoiceEntryTask, {
      instruction: 'Bill Acme 3 days consulting at $1,200/day',
    });

    Object.defineProperty(platform, 'ai', { value: original, configurable: true });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual(invoiceEntrySchema.parse(JSON.parse(REPLY)));
    expect(result.tokens).toBe(42);
    expect(calls[0].request.system).toContain('invoice lines');
    // The request went to the local endpoint.
    expect(calls.length).toBe(1);
  });

  it('re-asks once with the validation error when the reply is malformed', async () => {
    const platform = (await import('@/adapters')).platform();
    const calls: { request: AiCompletionRequest }[] = [];
    const bad = JSON.stringify({ clientName: 'Acme' }); // no lines
    const original = platform.ai;
    Object.defineProperty(platform, 'ai', {
      value: {
        name: 'mock',
        async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
          calls.push({ request });
          return { ok: true, content: calls.length === 1 ? bad : REPLY, tokens: 10 };
        },
      },
      configurable: true,
    });

    const settings = settingsWith({ aiEnabled: true, aiLocalOnly: true });
    await platform.storage.saveSettings(settings);

    const result = await runAiTask(invoiceEntryTask, { instruction: 'Bill Acme' });
    Object.defineProperty(platform, 'ai', { value: original, configurable: true });

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[1].request.system).toContain('previous reply was invalid');
    expect(calls[1].request.system).toContain('lines');
  });

  it('sends the API key stored in settings — no caller passes one', async () => {
    const platform = (await import('@/adapters')).platform();
    const calls: { request: AiCompletionRequest }[] = [];
    const original = platform.ai;
    Object.defineProperty(platform, 'ai', { value: mockAdapter(REPLY, calls), configurable: true });

    const settings = settingsWith({
      aiEnabled: true,
      aiLocalOnly: false,
      aiBaseUrl: 'https://openrouter.ai/api/v1',
      aiSecretRef: 'ai-api-key',
    });
    await platform.storage.saveSettings(settings);
    await platform.secrets.set('ai-api-key', 'sk-stored');

    const result = await runAiTask(invoiceEntryTask, { instruction: 'Bill Acme' });
    Object.defineProperty(platform, 'ai', { value: original, configurable: true });

    expect(result.ok).toBe(true);
    // Before R18 this went out with no key at all, so every cloud run got a 401.
    expect(calls[0].request.apiKey).toBe('sk-stored');
  });

  it('the parsed result becomes a correct draft when calculated', async () => {
    const parsed = invoiceEntrySchema.parse(JSON.parse(REPLY));
    // The draft creation the UI performs: lines from the parse, calculated.
    const lines = parsed.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: Math.round(line.unitPriceDollars * 100),
    }));
    const total = lines.reduce((acc, line) => acc + Number(line.quantity) * line.unitPrice, 0);
    expect(total).toBe(360000); // 3 × $1,200 in minor units
    expect(lines[0].description).toBe('Consulting');
    void calculate;
  });
});
