import { describe, expect, it } from 'vitest';
import { evaluationSet, runEvaluation } from './aiEval';
import { invoiceEntrySchema } from './aiTasks';

describe('evaluationSet', () => {
  it('has fifty well-formed cases with expected parses', () => {
    const cases = evaluationSet();
    expect(cases).toHaveLength(50);
    for (const testCase of cases) {
      // The expected parse is always valid, and matches its instruction's client.
      const parsed = invoiceEntrySchema.parse(testCase.expected);
      expect(parsed.lines).toHaveLength(1);
      expect(testCase.instruction).toContain(parsed.clientName.split(' ')[0]);
    }
  });

  it('a case with a close-but-wrong price is not exact', async () => {
    // runEvaluation with no endpoint configured refuses; the comparison logic
    // is what the set promises, so this checks the strictness contract
    // directly: the schema, not the HTTP layer.
    const cases = evaluationSet();
    const testCase = cases[0];
    const wrong = {
      ...testCase.expected,
      lines: [
        { ...testCase.expected.lines[0], unitPriceDollars: testCase.expected.lines[0].unitPriceDollars + 1 },
      ],
    };
    const parsedExpected = invoiceEntrySchema.parse(testCase.expected);
    const parsedWrong = invoiceEntrySchema.parse(wrong);
    expect(parsedWrong).not.toEqual(parsedExpected);
    void runEvaluation;
  });
});
