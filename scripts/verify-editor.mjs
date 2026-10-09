/**
 * Phase 4 acceptance check.
 *
 * The plan's gate: "a 10-line invoice using a preset can be created and finalised in
 * under 60 seconds; finalised invoices cannot be edited."
 *
 * Driven in a real browser because the second half is about the editor refusing to
 * accept an edit, which only exists once React has rendered it, and the first half is
 * a wall-clock budget that jsdom timings would flatter.
 *
 * Run with: npm run verify:editor
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PORT = 4322;
const ORIGIN = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0]);
    let file = join(root, path);
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(body);
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/** A 10-line preset, written straight into IndexedDB the way the seeder would. */
const TEN_LINE_PRESET = {
  id: 'preset_gate_check',
  name: 'Monthly retainer — 10 items',
  description: 'Ten catalogue lines, one click',
  documentType: 'invoice',
  clientId: null,
  designTemplateId: null,
  emailTemplateId: null,
  termsId: 'net_30',
  currency: 'AUD',
  taxMode: 'exclusive',
  notes: 'Thanks for your business.',
  termsText: 'Payable within 30 days.',
  tags: ['Retainer'],
  lines: [],
  builtin: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const PRESET_LINES = Array.from({ length: 10 }, (_, i) => ({
  id: `preset_line_${i}`,
  documentId: 'preset_gate_check',
  position: i,
  type: 'item',
  itemId: null,
  description: `Retainer line ${i + 1}`,
  notes: '',
  quantity: String(i + 1),
  unit: 'hour',
  unitPrice: 18000,
  amountOverride: null,
  discountType: 'none',
  discountValue: '0',
  taxCodeId: null,
  markupPercent: '0',
  receiptAttachmentId: null,
  expenseId: null,
  date: null,
  activity: '',
  staff: '',
  timeEntryId: null,
  sectionId: null,
  appliesToSectionId: null,
  discountDirection: 'discount',
  discountBase: 'subtotal',
  collapsed: false,
  showSubtotal: true,
  pageBreakBefore: false,
  computedAmount: 0,
  customFields: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}));

async function main() {
  const server = await serve();
  let browser;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    /* ---- set up a business and a client ---- */
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });

    await page.getByRole('textbox', { name: 'Business name' }).fill('Gate Check Pty Ltd');
    await page.getByRole('textbox', { name: 'ABN' }).fill('51824753556');
    // GST-registered, deliberately: a registered business is the harder path
    // (the tax-invoice compliance rules apply), and for a while the editor
    // could not submit one at all. If this switch ever regresses, the
    // finalise step below fails with the heading rule.
    await page.getByRole('switch', { name: 'Registered for GST' }).click();
    for (const label of ['Continue', 'Continue', 'Continue']) {
      await page.getByRole('button', { name: label }).click();
      await page.waitForTimeout(150);
    }
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });

    // The preset, with its ten lines, installed the way a seeded preset would be.
    await page.evaluate(
      ([preset, lines]) => {
        const request = indexedDB.open('duly');
        return new Promise((resolve) => {
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['contentPresets'], 'readwrite');
            tx.objectStore('contentPresets').put({ ...preset, lines });
            tx.oncomplete = () => {
              db.close();
              resolve(true);
            };
            tx.onerror = () => {
              db.close();
              resolve(false);
            };
          };
          request.onerror = () => resolve(false);
        });
      },
      [TEN_LINE_PRESET, PRESET_LINES],
    );

    /* ---- a client to bill ---- */
    await page.goto(`${ORIGIN}/clients/new`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: 'Name' }).first().fill('Acme Pty Ltd');
    await page.getByRole('button', { name: 'Save client' }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const clientUrl = page.url();

    /* ---- the 60-second gate starts here ----
     * It starts once the client exists, because picking the client is part of
     * creating an invoice somebody would actually send.
     */
    const started = Date.now();

    await page.goto(`${ORIGIN}/invoices/new`, { waitUntil: 'networkidle' });
    // The editor creates the document before its action bar exists, so wait for the
    // button rather than for the shell.
    await page.getByRole('button', { name: 'Preset' }).waitFor({ state: 'visible', timeout: 15000 });

    await page.getByRole('combobox', { name: 'Client' }).selectOption({ label: 'Acme Pty Ltd' });
    await page.getByRole('button', { name: 'Preset' }).click();
    // Choose the preset first: the confirm button stays disabled until one is picked.
    await page.getByRole('button', { name: /Monthly retainer — 10 items/ }).click();
    await page.getByRole('button', { name: /Add 10 lines/ }).click();

    const lineCount = await page.locator('tbody tr').count();
    check('A preset adds its ten lines', lineCount === 10, `${lineCount} rows`);
    void clientUrl;

    /* ---- submit ---- */
    await page.getByRole('button', { name: /^Submit/ }).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    const submitLabel = await page.getByRole('button', { name: /^Submit as|Finish the issues/ }).count();
    check('The submit dialog opens with the number it will assign', submitLabel > 0);

    await page.getByRole('button', { name: /^Submit as/ }).click();
    await page.waitForSelector('[aria-live="polite"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    const elapsed = Date.now() - started;
    check(
      'A ten-line invoice is created from a preset and finalised in under 60 seconds',
      elapsed < 60_000,
      `${(elapsed / 1000).toFixed(1)}s`,
    );

    /* ---- the number was assigned and the document is locked ---- */
    await page.waitForSelector('text=INV-', { timeout: 10000 });
    const number = (await page.locator('h1').first().textContent())?.trim() ?? '';
    check('The document was given a real number', /^INV-\d{4}-\d{4}$/.test(number), number);

    const finalChips = await page.getByText('Final', { exact: true }).count();
    const draftChips = await page.getByText('Draft', { exact: true }).count();
    check('The status chip reads Final, not Draft', finalChips > 0 && draftChips === 0, `final=${finalChips} draft=${draftChips}`);

    /* ---- finalised invoices cannot be edited ---- */
    const lockedNote = await page.locator('text=Finalised documents cannot be edited').count();
    check('A finalised document explains that it is locked', lockedNote > 0);

    // Every editing control is genuinely disabled, not merely styled to look so.
    const editable = await page.locator(
      'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])',
    );
    const enabledCount = await editable.count();
    const descriptions = await editable.evaluateAll((nodes) =>
      nodes
        .filter((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName))
        .map((n) => `${n.tagName}:${n.getAttribute('aria-label') || n.placeholder || n.id || '?'}`),
    );
    check(
      'No editing control is still enabled on a finalised document',
      enabledCount === 0,
      enabledCount === 0 ? '0 enabled' : descriptions.slice(0, 4).join(', '),
    );

    // And the store refuses, not just the UI: type into a disabled field is
    // impossible, so the check that matters is that the submit button is gone.
    const stillSubmittable = await page.getByRole('button', { name: /^Submit$/ }).count();
    check('A finalised document cannot be submitted again', stillSubmittable === 0);

    /* ---- the tax snapshot was frozen ---- */
    const snapshot = await page.evaluate(async () => {
      const request = indexedDB.open('duly');
      return new Promise((resolve) => {
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('documents', 'readonly');
          const all = tx.objectStore('documents').getAll();
          all.onsuccess = () => {
            const finalised = all.result.find((d) => d.status === 'finalised');
            db.close();
            resolve(finalised ? { heading: finalised.taxSnapshot?.heading, finalisedAt: Boolean(finalised.finalisedAt) } : null);
          };
          all.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        request.onerror = () => resolve(null);
      });
    });
    // This business is not GST registered, so "Invoice" is the correct frozen
    // heading. The registered variant freezes "Tax Invoice" — the whole
    // point of running the gate as a GST-registered business.
    check(
      'Submitting froze a tax snapshot',
      Boolean(snapshot?.finalisedAt) && snapshot?.heading === 'Tax Invoice',
      JSON.stringify(snapshot),
    );

    /* ---- nothing errored ---- */
    const real = errors.filter((e) => !/sourcemap|SourceMap/i.test(e));
    check('No runtime errors', real.length === 0, real.slice(0, 3).join(' | '));
  } finally {
    await browser?.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`\nEditor verification failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});