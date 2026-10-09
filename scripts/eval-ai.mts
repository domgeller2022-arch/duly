/**
 * The AI evaluation runner.
 *
 * The plan's item 5: the 50-request set run against the configured model, so
 * accuracy is measured before you trust it. Reads the endpoint from the
 * environment, writes the settings, and prints the outcome.
 *
 * Usage: AI_BASE_URL=... AI_MODEL=... [AI_KEY=...] npx tsx scripts/eval-ai.mts [limit]
 */

import { createWebPlatform, setPlatform } from '../src/adapters';
import { settingsSchema } from '../src/core/schemas';
import { runEvaluation } from '../src/lib/aiEval';
import { evaluationSet } from '../src/lib/aiEval';

const baseUrl = process.env.AI_BASE_URL ?? 'http://localhost:11434/v1';
const model = process.env.AI_MODEL ?? '';
const apiKey = process.env.AI_KEY;
const limit = Number(process.argv[2] ?? '50');

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseUrl) && process.env.AI_ALLOW_CLOUD !== '1') {
  console.error('Refusing a cloud endpoint without AI_ALLOW_CLOUD=1 — the Local-only rule, applied to this script too.');
  process.exit(2);
}

const platform = createWebPlatform(`duly-eval-${Math.random().toString(36).slice(2)}`);
setPlatform(platform);

const now = '2026-01-01T00:00:00.000Z';
await platform.storage.saveSettings(
  settingsSchema.parse({
    id: 'settings',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    aiEnabled: true,
    aiLocalOnly: true,
    aiBaseUrl: baseUrl,
    aiTextModel: model,
  }),
);

console.log(`Evaluating ${limit} of ${evaluationSet().length} cases against ${baseUrl}${model ? ` (${model})` : ''}…`);
const outcome = await runEvaluation({ apiKey, limit });

console.log('');
console.log(`Cases:          ${outcome.total}`);
console.log(`Client correct: ${outcome.clientCorrect}`);
console.log(`Lines correct:  ${outcome.linesCorrect}`);
console.log(`Exact:          ${outcome.exact} (${Math.round((outcome.exact / outcome.total) * 100)}%)`);
if (outcome.failures.length > 0) {
  console.log('');
  console.log('Failures:');
  for (const failure of outcome.failures.slice(0, 10)) {
    console.log(`  ${failure.instruction}\n    → ${failure.reason}`);
  }
  if (outcome.failures.length > 10) console.log(`  … and ${outcome.failures.length - 10} more`);
}
