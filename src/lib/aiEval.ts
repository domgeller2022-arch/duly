/**
 * The evaluation set.
 *
 * The plan's item 5: 50 sample requests with expected results, run against
 * each configured model to compare accuracy before you trust it. The requests
 * are generated from a fixed grid — ten clients, five services — so every run
 * sees the same fifty, and each has the parse that a correct model returns.
 *
 * The 30 sample receipts need real receipt photos, which cannot be fabricated
 * usefully here; the vision eval runs the same way once photos exist in
 * `eval-receipts/` (one JPEG per receipt, named by its expected supplier).
 */

import { invoiceEntrySchema, type InvoiceEntryResult } from './aiTasks';
import { runAiTask } from './ai';
import { invoiceEntryTask } from './aiTasks';

const CLIENTS = [
  'Acme Pty Ltd',
  'Borealis Group',
  'Cedar & Sons',
  'Delta Industries',
  'Evergreen Care',
  'Franklin Legal',
  'Granite Build',
  'Harbour Dental',
  'Ironbark Energy',
  'Juniper Studio',
];

const SERVICES = [
  { description: 'Consulting', unit: 'days', hours: 3, price: 1200 },
  { description: 'Website maintenance', unit: 'hours', hours: 7.5, price: 150 },
  { description: 'Installation labour', unit: 'hours', hours: 4, price: 180 },
  { description: 'Site inspection', unit: 'visit', hours: 1, price: 450 },
  { description: 'Emergency callout', unit: 'visit', hours: 2, price: 850 },
];

export interface EvalCase {
  instruction: string;
  expected: InvoiceEntryResult;
}

/** The fifty: ten clients across five services, deterministic order. */
export function evaluationSet(): EvalCase[] {
  const cases: EvalCase[] = [];
  for (let c = 0; c < CLIENTS.length; c++) {
    for (let s = 0; s < SERVICES.length; s++) {
      const client = CLIENTS[c];
      const service = SERVICES[s];
      const instruction =
        s % 2 === 0
          ? `Bill ${client} ${service.hours} ${service.unit === 'visit' ? 'visit' : service.unit} of ${service.description.toLowerCase()} at $${service.price.toLocaleString('en-AU')}/${service.unit}`
          : `Bill ${client} for ${service.description.toLowerCase()} — ${service.hours} ${service.unit} at $${service.price}/${service.unit}`;
      cases.push({
        instruction,
        expected: invoiceEntrySchema.parse({
          clientName: client,
          lines: [
            {
              description: service.description,
              quantity: String(service.hours),
              unit: service.unit,
              unitPriceDollars: service.price,
            },
          ],
          dueDays: null,
          notes: '',
        }),
      });
    }
  }
  return cases;
}

export interface EvalOutcome {
  total: number;
  /** Client matched exactly. */
  clientCorrect: number;
  /** Lines matched: same description, quantity, unit and price. */
  linesCorrect: number;
  /** Both right — what "accuracy" means here. */
  exact: number;
  failures: { instruction: string; reason: string }[];
}

/**
 * Run the set against the configured endpoint.
 *
 * Comparison is strict: a case counts as correct only when the client and
 * every line field match the expected parse, because an amount that is close
 * is still wrong on an invoice.
 */
export async function runEvaluation(options?: {
  apiKey?: string;
  signal?: { aborted: boolean };
  limit?: number;
}): Promise<EvalOutcome> {
  const cases = evaluationSet().slice(0, options?.limit ?? 50);
  const outcome: EvalOutcome = {
    total: cases.length,
    clientCorrect: 0,
    linesCorrect: 0,
    exact: 0,
    failures: [],
  };

  for (const testCase of cases) {
    const result = await runAiTask(invoiceEntryTask, { instruction: testCase.instruction }, options);
    if (!result.ok || !result.value) {
      outcome.failures.push({ instruction: testCase.instruction, reason: result.error ?? 'no result' });
      continue;
    }
    const clientOk = result.value.clientName.toLowerCase() === testCase.expected.clientName.toLowerCase();
    const expectedLine = testCase.expected.lines[0];
    const gotLine = result.value.lines[0];
    const linesOk =
      result.value.lines.length === 1 &&
      gotLine !== undefined &&
      gotLine.description === expectedLine.description &&
      Number.parseFloat(gotLine.quantity) === Number.parseFloat(expectedLine.quantity) &&
      gotLine.unit === expectedLine.unit &&
      gotLine.unitPriceDollars === expectedLine.unitPriceDollars;

    if (clientOk) outcome.clientCorrect += 1;
    if (linesOk) outcome.linesCorrect += 1;
    if (clientOk && linesOk) outcome.exact += 1;
    else outcome.failures.push({ instruction: testCase.instruction, reason: 'parse did not match' });
  }

  return outcome;
}
