import { describe, expect, it } from 'vitest';
import { buildOutputPath } from './format';

/**
 * The Phase 6 acceptance: submitting an invoice places
 * `2026/Acme/INV-2026-0001 - Acme - 06-10-2026.pdf` in the chosen folder.
 *
 * The one difference is deliberate: `{date}` renders the ISO date rather than
 * the plan's illustrative DMY, because a file manager sorts by name and
 * `2026-10-06` sorts correctly while `06-10-2026` does not.
 */
describe('buildOutputPath', () => {
  it('nests year/client and names by the pattern', () => {
    expect(
      buildOutputPath({
        fileNamePattern: '{number} - {client} - {date}.pdf',
        number: 'INV-2026-0001',
        client: 'Acme',
        date: '2026-10-06',
        yearFolderMode: 'calendar',
      }),
    ).toBe('2026/Acme/INV-2026-0001 - Acme - 2026-10-06.pdf');
  });

  it('uses a financial-year folder when configured', () => {
    expect(
      buildOutputPath({
        fileNamePattern: '{number}.pdf',
        number: 'INV-1',
        client: 'Acme',
        date: '2026-07-01',
        yearFolderMode: 'financial',
        financialYear: '2026-27',
      }),
    ).toBe('2026-27/Acme/INV-1.pdf');
  });

  it('skips empty segments', () => {
    expect(
      buildOutputPath({
        fileNamePattern: '{number}.pdf',
        number: 'INV-1',
        client: '',
        date: '2026-10-06',
        yearFolderMode: 'none',
      }),
    ).toBe('INV-1.pdf');
  });
});
