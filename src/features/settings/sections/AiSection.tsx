/**
 * AI settings.
 *
 * The plan's item 1: presets for Local, OpenRouter and Custom
 * OpenAI-compatible; base URL; key in the OS keychain; model per task (text,
 * vision); Local-only switch; redaction toggle; Test connection.
 *
 * The switch that matters is Local-only (default on): with it on, the
 * pipeline refuses any endpoint that is not localhost, so a cloud key can
 * never leave the machine unnoticed. The key is stored through the secrets
 * adapter — the OS keychain on desktop, session memory on the web, which
 * says so.
 */

import { useEffect, useState } from 'react';
import type { Settings } from '@/core/schemas';
import { platform } from '@/adapters';
import { useAppStore, useActiveProfile } from '@/state/app';
import { Alert, Button, Card, Field, Panel, Select, Switch, TextInput, useToast } from '@/ui/components/base';

const PRESETS = [
  {
    id: 'local',
    name: 'Local (Ollama)',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    hint: 'Runs on this machine. Works offline, and nothing leaves it.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    hint: 'One key, many models. Cloud — needs Local-only off.',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: '',
    needsKey: true,
    hint: 'Any endpoint speaking the /chat/completions shape.',
  },
] as const;

export function AiSection() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);

  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (settings) setBaseUrl(settings.aiBaseUrl);
  }, [settings]);

  if (!settings) return null;

  const patch = async (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes, updatedAt: new Date().toISOString() };
    await saveSettings(next as Settings);
  };

  /** Which preset the current base URL matches, for the select. */
  const preset =
    PRESETS.find((p) => p.baseUrl === settings.aiBaseUrl) ?? (settings.aiBaseUrl ? PRESETS[2] : PRESETS[0]);

  const applyPreset = async (id: (typeof PRESETS)[number]['id']) => {
    const chosen = PRESETS.find((p) => p.id === id)!;
    setBaseUrl(chosen.baseUrl);
    await patch({ aiBaseUrl: chosen.baseUrl });
  };

  const saveKey = async () => {
    if (!apiKey) return;
    const stored = await platform().secrets.set(settings.aiSecretRef || 'ai-api-key', apiKey);
    setApiKey('');
    push({
      tone: stored ? 'success' : 'warning',
      title: stored ? 'API key saved' : 'API key kept for this session only',
      description: stored ? 'It lives in the OS keychain.' : 'The web build has nowhere safe to store it.',
    });
  };

  /** The plan's test connection: one small completion. */
  const test = async () => {
    setTesting(true);
    try {
      const key = apiKey || ((await platform().secrets.get(settings.aiSecretRef || 'ai-api-key')) ?? '');
      const result = await platform().ai.complete(
        {
          system: 'Reply with JSON only: {"answer": string}.',
          prompt: 'Say ready.',
          model: settings.aiTextModel || 'local',
          apiKey: key,
          timeoutMs: 15_000,
        },
        settings.aiBaseUrl,
      );
      push({
        tone: result.ok ? 'success' : 'error',
        title: result.ok ? 'The endpoint answered' : 'Could not reach the endpoint',
        description: result.ok ? `${result.tokens} tokens.` : (result.error ?? ''),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Alert
        tone={settings.aiEnabled ? 'info' : 'warning'}
        title={settings.aiEnabled ? 'AI is on' : 'AI is switched off'}
      >
        {settings.aiEnabled
          ? 'AI only ever drafts — it can never submit, send or record a payment.'
          : 'Every screen works without it. Turn it on to draft invoices from plain language.'}
      </Alert>

      <Panel title="Endpoint" description="One OpenAI-compatible endpoint serves every task.">
        <div className="grid gap-3">
          <Field label="Preset">
            <Select
              value={preset.id}
              onChange={(e) => void applyPreset(e.target.value as (typeof PRESETS)[number]['id'])}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[13px] text-ink-muted">{preset.hint}</p>
          <Field label="Base URL">
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => baseUrl !== settings.aiBaseUrl && void patch({ aiBaseUrl: baseUrl })}
              placeholder="http://localhost:11434/v1"
            />
          </Field>
          <Field label="API key" hint="Stored via the secrets adapter — the OS keychain on desktop.">
            <div className="flex gap-2">
              <TextInput
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={preset.needsKey ? 'Paste the key' : 'Not needed for a local model'}
              />
              <Button size="sm" onClick={() => void saveKey()} disabled={!apiKey}>
                Save key
              </Button>
            </div>
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void test()} disabled={testing}>
              Test connection
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Models" description="A model per task: text for drafting and entry, vision for receipts.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Text model" hint="Invoice entry, email drafting, ask-your-data.">
            <TextInput
              value={settings.aiTextModel}
              onChange={(e) => void patch({ aiTextModel: e.target.value })}
              placeholder="llama3.1:8b"
            />
          </Field>
          <Field label="Vision model" hint="Receipt scans. Empty uses the text model.">
            <TextInput
              value={settings.aiVisionModel}
              onChange={(e) => void patch({ aiVisionModel: e.target.value })}
              placeholder="llama3.2-vision"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Privacy" description="The two switches that decide where your data goes.">
        <div className="grid gap-3">
          <Switch
            checked={settings.aiLocalOnly}
            onChange={(v) => void patch({ aiLocalOnly: v })}
            label="Local-only"
            hint="Refuses any endpoint that is not localhost. A cloud key cannot leave the machine while this is on."
          />
          <Switch
            checked={settings.aiRedact}
            onChange={(v) => void patch({ aiRedact: v })}
            label="Redact client details"
            hint="Client names, ABNs and bank details are replaced with placeholders before a cloud call."
          />
        </div>
      </Panel>

      <Panel title="Cost" description="A running total of this month's AI usage, and an optional cap.">
        <div className="grid gap-3">
          <p className="text-[13px] text-ink-muted">
            This month: {settings.aiSpendTokens.toLocaleString()} tokens
            {settings.aiCostPer1kTokensUsd > 0
              ? `, US$${settings.aiSpendUsd.toFixed(2)} estimated`
              : ' — set a rate to estimate the cost'}
            .
          </p>
          <Field
            label="Cost per 1,000 tokens (USD)"
            hint="Your provider's price. Used only to estimate spend, never sent anywhere."
          >
            <TextInput
              type="number"
              value={String(settings.aiCostPer1kTokensUsd)}
              onChange={(e) => void patch({ aiCostPer1kTokensUsd: Math.max(0, Number(e.target.value) || 0) })}
              placeholder="0"
            />
          </Field>
          <Switch
            checked={settings.aiSpendCapEnabled}
            onChange={(v) => void patch({ aiSpendCapEnabled: v })}
            label="Cap monthly spend"
            hint="Once this month's estimated spend reaches the cap, Duly refuses further cloud calls."
          />
          {settings.aiSpendCapEnabled && (
            <Field label="Monthly cap (USD)">
              <TextInput
                type="number"
                value={String(settings.aiSpendCapUsd)}
                onChange={(e) => void patch({ aiSpendCapUsd: Math.max(0, Number(e.target.value) || 0) })}
                placeholder="10"
              />
            </Field>
          )}
        </div>
      </Panel>

      <Card className="p-4">
        <h2 className="mb-2 font-medium text-ink">What AI can and cannot do</h2>
        <ul className="space-y-1 text-[13px] text-ink-muted">
          <li>Can: draft an invoice from a sentence like "Bill Acme 3 days consulting at $1,200/day".</li>
          <li>
            Can: read a receipt photo into an expense; draft a reminder email; answer questions about your
            data.
          </li>
          <li>
            Cannot: submit a document, send an email, or record a payment — every AI result waits for you.
          </li>
        </ul>
        {profile && <p className="mt-2 text-[12px] text-ink-faint">Drafts are billed from {profile.name}.</p>}
      </Card>
    </div>
  );
}
