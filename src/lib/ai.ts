/**
 * The AI request pipeline.
 *
 * The plan's item 2: a prompt template per feature, JSON output, Zod
 * validation, one retry, timeout, cancel, token and cost logging. The retry
 * here is the smart one — a parse failure re-asks with the validation error
 * appended, which fixes most malformed-JSON outputs in one round trip; the
 * adapter's own HTTP retry covers a flaky connection.
 *
 * Two guards run before any request leaves: AI switched off refuses
 * everything, and Local-only refuses any endpoint that is not localhost —
 * which is the plan's acceptance, tested in ai.test.ts.
 */

import { z } from 'zod';
import type { Settings } from '@/core/schemas';
import type { AiCompletionResult } from '@/adapters/types';
import { newEntity } from '@/core/schemas/common';
import { platform, storage } from '@/adapters';

/** Localhost origins a Local-only switch allows. */
function isLocal(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      url.hostname === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

/** The guards: a refusal says why rather than failing silently later. */
export function aiGuard(settings: Settings, baseUrl: string): string | null {
  if (!settings.aiEnabled) return 'AI is switched off in Settings → AI.';
  if (settings.aiLocalOnly && !isLocal(baseUrl)) {
    return 'Local-only is on, so Duly refuses to send anything to a cloud endpoint.';
  }
  return null;
}

/** Pull the JSON out of a model reply, which may be fenced or padded. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('The reply contained no JSON.');
  const slice = candidate.slice(start);
  return JSON.parse(slice);
}

/**
 * Redact client-identifying details from incidental context (see ask-data).
 *
 * Names are redacted too, not only ABNs and amounts: the switch is on by
 * default precisely so a client's identity does not reach a cloud model. The
 * names are matched literally (split/join, not a regex) so a name containing
 * punctuation still matches.
 */
export function redactForAi(text: string, names: string[] = []): string {
  let out = text;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length >= 2) out = out.split(trimmed).join('[client]');
  }
  return out
    .replace(/\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g, '[ABN]')
    .replace(/[$€£]\s?[\d,]+(?:\.\d{2})?/g, '[amount]');
}

export interface AiTask<T> {
  /** The feature name, for the prompt template and the log. */
  feature: string;
  system: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Turn the user's input and context into the prompt. */
  prompt: (args: Record<string, unknown>) => string;
  images?: (args: Record<string, unknown>) => string[];
  model?: (settings: Settings) => string;
}

export interface AiRunResult<T> {
  ok: boolean;
  /** The validated value, when the run succeeded. */
  value: T | null;
  error?: string;
  tokens: number;
}

/**
 * Run one task: guard, complete, extract, validate, and re-ask once with the
 * validation error when the first reply does not parse.
 */
export async function runAiTask<T>(
  task: AiTask<T>,
  args: Record<string, unknown>,
  options?: { signal?: { aborted: boolean }; apiKey?: string },
): Promise<AiRunResult<T>> {
  const settings = (await storage().getSettings()) as Settings;
  const baseUrl = settings.aiBaseUrl;

  const refused = aiGuard(settings, baseUrl);
  if (refused) return { ok: false, value: null, error: refused, tokens: 0 };

  if (options?.signal?.aborted) return { ok: false, value: null, error: 'Cancelled.', tokens: 0 };

  // The key comes from settings, resolved through the secrets adapter. R9's
  // changelog claimed the pipeline did this; the code only ever used a
  // caller-supplied key, and no caller passed one — so every cloud feature run
  // went out with no Authorization header and got a 401. A caller may still
  // pass a key (the settings screen's own test connection does).
  const apiKey =
    options?.apiKey ?? ((await platform().secrets.get(settings.aiSecretRef || 'ai-api-key')) ?? undefined);

  const model = task.model?.(settings) || '';
  const prompt = task.prompt(args);
  const images = task.images?.(args) ?? [];

  let tokens = 0;
  let validationError = '';

  // One re-ask with the validation error appended.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result: AiCompletionResult = await platform().ai.complete(
      {
        system:
          attempt === 0
            ? task.system
            : `${task.system}\n\nYour previous reply was invalid: ${validationError}. Reply with corrected JSON only.`,
        prompt,
        images,
        model,
        apiKey,
      },
      baseUrl,
    );
    tokens += result.tokens;
    if (!result.ok) return { ok: false, value: null, error: result.error, tokens };
    if (options?.signal?.aborted) return { ok: false, value: null, error: 'Cancelled.', tokens };

    try {
      const parsed = task.schema.parse(extractJson(result.content));
      await logAiUsage(task.feature, tokens);
      return { ok: true, value: parsed, tokens };
    } catch (error) {
      validationError =
        error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : (error as Error).message;
    }
  }

  await logAiUsage(task.feature, tokens);
  return { ok: false, value: null, error: `The reply could not be parsed: ${validationError}`, tokens };
}

/** Token logging — the plan asks for it; cost has no known rate, so tokens it is. */
async function logAiUsage(feature: string, tokens: number): Promise<void> {
  if (tokens === 0) return;
  await storage().saveAutomationLog(
    newEntity({
      category: 'ai',
      message: `AI ${feature} used ${tokens} tokens.`,
      documentId: null,
      profileId: null,
      entity: 'ai',
      entityId: '',
      needsAttention: false,
      detail: '',
      ranAt: new Date().toISOString(),
    }),
  );
}
