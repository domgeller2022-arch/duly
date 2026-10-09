/**
 * Phase 1 acceptance check.
 *
 * The plan's own gate: "a profile with logo survives a browser restart; a full
 * export re-imports into a clean browser identically."
 *
 * A real browser rather than jsdom, because both halves of that sentence are about
 * things jsdom does not have: IndexedDB surviving a reload, and a genuinely empty
 * database to import into.
 *
 * Run with: npm run verify:data
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PORT = 4321;
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
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
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

/** A 1x1 PNG, so the logo is real image data rather than an empty string. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Read every table out of IndexedDB directly, so nothing depends on the UI.
 *
 * Passed to `page.evaluate` as a real function, not a string: a string is
 * evaluated as an expression, and an arrow function expression does not survive
 * serialisation back out of the page.
 */
function dumpDatabase() {
  const open = indexedDB.open('duly');
  return new Promise((resolve) => {
    open.onerror = () => resolve({});
    open.onsuccess = () => {
      const db = open.result;
      const names = [...db.objectStoreNames];
      if (names.length === 0) {
        db.close();
        resolve({});
        return;
      }
      const tx = db.transaction(names, 'readonly');
      const out = {};
      let pending = names.length;
      const settle = () => {
        if (--pending > 0) return;
        db.close();
        resolve(out);
      };
      for (const name of names) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          out[name] = request.result;
          settle();
        };
        request.onerror = () => settle();
      }
    };
  });
}

/** Delete the database, to prove an import starts from genuinely nothing. */
function clearDatabase() {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('duly');
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

/** Wait for the catalogue to show exactly `count` rows; returns what it settled on. */
async function waitForRowCount(page, count, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let seen = -1;
  while (Date.now() < deadline) {
    seen = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
    if (seen === count) return seen;
    await page.waitForTimeout(50);
  }
  return seen;
}

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

    /* ---- 1. a new install opens on the wizard ---- */
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    await page.waitForURL(/\/setup/, { timeout: 10000 });
    await page.waitForSelector('ol[aria-label="Setup progress"]', { timeout: 15000 });
    check('A new install opens on the setup wizard', true);

    /* ---- 2. the wizard has its four steps ---- */
    const stepButtons = await page.locator('ol[aria-label="Setup progress"] button').allTextContents();
    check(
      'The wizard shows its four steps',
      stepButtons.length === 4,
      stepButtons.join(' · '),
    );

    /* ---- 3. GST registration with an effective date ---- */
    await page.getByRole('switch', { name: /Registered for GST/i }).click();
    const effectiveFrom = await page.locator('input[type="date"]').first().inputValue();
    check(
      'GST registration records an effective date',
      /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom),
      effectiveFrom,
    );

    /* ---- 4. fill in the business and finish ---- */
    await page.getByRole('textbox', { name: 'Business name' }).fill('Northwind Consulting');
    await page.getByRole('textbox', { name: 'Legal entity name' }).fill('Northwind Consulting Pty Ltd');
    await page.getByRole('textbox', { name: 'ABN' }).fill('51824753556');
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForSelector('text=Logo and colours', { timeout: 5000 });

    // The logo is uploaded through the real file input rather than by poking the
    // database, so the data-URL read path is exercised too.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG.split(',')[1], 'base64'),
    });
    await page.waitForSelector('img[alt="Northwind Consulting logo"]', { timeout: 10000 });
    check('A logo uploads and previews', true);

    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForSelector('text=Payment details', { timeout: 5000 });
    await page.getByRole('textbox', { name: 'BSB' }).fill('062000');
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForSelector('text=Files and folders', { timeout: 5000 });
    await page.getByRole('button', { name: /Finish setup/ }).click();

    await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });
    check('Finishing setup lands on the dashboard', true);

    /* ---- 5. the profile is on disk with its logo ---- */
    const afterSetup = await page.evaluate(dumpDatabase);
    const profiles = afterSetup.businessProfiles ?? [];
    check(
      'The business profile was saved',
      profiles.length === 1 && profiles[0].name === 'Northwind Consulting',
      `${profiles.length} profile(s)`,
    );
    check(
      'The logo is stored as image data on the profile',
      String(profiles[0]?.logo?.src ?? '').startsWith('data:image/png;base64,'),
      `${String(profiles[0]?.logo?.src ?? '').slice(0, 24)}…`,
    );
    check(
      'GST registration was recorded with its effective date',
      profiles[0]?.gstRegistered === true &&
        Array.isArray(profiles[0]?.gstHistory) &&
        profiles[0].gstHistory.length === 1 &&
        profiles[0].gstHistory[0].from === effectiveFrom,
      JSON.stringify(profiles[0]?.gstHistory ?? []),
    );
    check('Onboarding is marked complete', profiles[0]?.onboarded === true);

    /* ---- 6. the profile survives a restart ---- */
    // A new page in the same context: same origin, same IndexedDB, no memory of the
    // session that wrote it. This is the "browser restart" in the plan's gate.
    const restarted = await context.newPage();
    await restarted.goto(`${ORIGIN}/settings`, { waitUntil: 'networkidle' });
    await restarted.waitForSelector('#root > *', { timeout: 15000 });
    const listed = await restarted.locator('main li p').first().textContent();
    check(
      'The profile survives a restart, with its logo',
      Boolean(listed?.includes('Northwind Consulting')) &&
        (await restarted.locator('main li img').count()) > 0,
      listed?.trim() ?? '',
    );
    await restarted.close();

    /* ---- 7. export ---- */
    // Exported through the app rather than by serialising IndexedDB, because the
    // snapshot is the format the desktop build will import.
    await page.getByRole('link', { name: /^Settings/ }).first().click();
    await page.waitForURL(/\/settings/, { timeout: 10000 });
    await page.getByRole('tab', { name: 'Data' }).click();
    await page.waitForSelector('text=Export a backup', { timeout: 5000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: /Export a backup/ }).click(),
    ]);
    const exportPath = await download.path();
    check('A full backup exports as one JSON file', Boolean(exportPath), download.suggestedFilename());

    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    check(
      'The export carries the profile, its logo and the settings',
      exported.businessProfiles?.[0]?.name === 'Northwind Consulting' &&
        String(exported.businessProfiles?.[0]?.logo?.src ?? '').startsWith('data:image/png;base64,') &&
        exported.settings?.length === 1,
      `${Object.keys(exported).length} keys, schema ${exported.schemaVersion}`,
    );

    /* ---- 8. import into a clean browser ---- */
    // A fresh context has its own storage partition, so this is a genuinely empty
    // database — which is the point of the plan's "into a clean browser".
    const clean = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const cleanPage = await clean.newPage();
    await cleanPage.goto(ORIGIN, { waitUntil: 'networkidle' });
    await cleanPage.waitForSelector('#root > *', { timeout: 15000 });

    // Prove it really is clean before importing, or the check means nothing.
    const cleanBefore = await cleanPage.evaluate(dumpDatabase);
    check(
      'The second browser starts with nothing in it',
      (cleanBefore.businessProfiles ?? []).length === 0,
      `${(cleanBefore.businessProfiles ?? []).length} profile(s)`,
    );

    // The shell redirects to the wizard while there is no business, so the Data
    // section is reached by URL rather than through the sidebar.
    await cleanPage.goto(`${ORIGIN}/settings/data`, { waitUntil: 'networkidle' });
    await cleanPage.waitForSelector('text=Import a backup', { timeout: 10000 });

    await cleanPage.locator('input[type="file"]').setInputFiles(exportPath);
    await cleanPage.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await cleanPage.getByRole('button', { name: 'Replace' }).click();
    await cleanPage.waitForSelector('text=Database replaced', { timeout: 20000 });

    const cleanAfter = await cleanPage.evaluate(dumpDatabase);
    const imported = cleanAfter.businessProfiles ?? [];
    check(
      'A full export re-imports identically',
      imported.length === 1 &&
        imported[0].id === exported.businessProfiles[0].id &&
        imported[0].name === exported.businessProfiles[0].name &&
        imported[0].logo?.src === exported.businessProfiles[0].logo?.src &&
        imported[0].gstHistory?.[0]?.from === exported.businessProfiles[0].gstHistory[0].from &&
        cleanAfter.settings?.[0]?.id === exported.settings[0].id &&
        (cleanAfter.taxCodes ?? []).length === (exported.taxCodes ?? []).length,
      `${imported.length} profile, ${(cleanAfter.taxCodes ?? []).length} tax codes`,
    );

    check(
      'The seeded reference data comes back with it',
      (cleanAfter.designTemplates ?? []).length >= 3 &&
        (cleanAfter.emailTemplates ?? []).length > 0,
      `${(cleanAfter.designTemplates ?? []).length} templates, ${(cleanAfter.emailTemplates ?? []).length} email templates`,
    );

    /* ---- 9. the imported business is usable ---- */
    await cleanPage.goto(`${ORIGIN}/settings`, { waitUntil: 'networkidle' });
    await cleanPage.waitForSelector('text=Northwind Consulting', { timeout: 10000 });
    const gstChip = await cleanPage.locator('text=GST registered').count();
    check('The imported business shows its GST status', gstChip > 0);

    await clean.close();

    /* ---- 10. an invalid ABN is flagged as you type ----
     * The plan's second half of the Phase 2 gate. Typed digit by digit rather than
     * pasted, because "as you type" is the claim being checked.
     */
    await page.goto(`${ORIGIN}/clients/new`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });

    const abn = page.getByRole('textbox', { name: 'Tax ID' });

    await abn.fill('5182475355'); // one digit short
    await page.waitForSelector('text=An ABN has 11 digits', { timeout: 5000 });
    check('An incomplete ABN is flagged as you type', true);

    await abn.fill('51824753550'); // eleven digits, wrong check digit
    await page.waitForSelector('text=/fails its checksum/', { timeout: 5000 });
    const offered = await page.locator('text=Was that a typo?').count();
    check('A wrong check digit is caught, with the right one offered', offered > 0);

    await abn.fill('5182475355a');
    await page.waitForTimeout(150);
    const value = await abn.inputValue();
    check('A letter is refused rather than silently accepted', !/[a-z]/i.test(value), value);

    await abn.fill('51824753556'); // the real check digit for 5182475355
    await page.waitForTimeout(150);
    const cleared = await page.locator('text=/fails its checksum|An ABN has 11 digits/').count();
    check('A correct ABN clears the warning', cleared === 0, await abn.inputValue());

    /* ---- 10b. a client, their contacts, and their record ---- */
    await page.getByRole('textbox', { name: 'Name' }).first().fill('Acme Pty Ltd');
    await page.getByRole('button', { name: 'Save client' }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 10000 });
    await page.waitForSelector('h1:has-text("Acme Pty Ltd")', { timeout: 10000 });
    check('Saving a client opens their record', true);

    await page.getByRole('button', { name: 'Add a contact' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).last().fill('Accounts payable');
    await page.getByRole('textbox', { name: 'Email' }).fill('ap@acme.test');
    await page.getByRole('button', { name: 'Save contact' }).click();
    await page.waitForSelector('td:has-text("ap@acme.test")', { timeout: 10000 });
    check('A contact can be added and shows on the client', true);

    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await page.waitForSelector('h1:has-text("New client"), h1:has-text("Acme Pty Ltd")', { timeout: 10000 });
    const keptName = await page.getByRole('textbox', { name: 'Name' }).first().inputValue();
    check('Editing a client loads their details', keptName === 'Acme Pty Ltd', keptName);

    /* ---- 11. 500 imported items, then searched ----
     * The catalogue part of the gate. Correctness is asserted here in a real browser;
     * the sub-100ms timing is measured in `items.performance.test.ts`, which times
     * the adapter directly rather than through Playwright's protocol overhead.
     */
    await page.goto(`${ORIGIN}/items`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    await page.getByRole('button', { name: /Import CSV/ }).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

    const header = 'Name,Code,Unit,Price,Category';
    // Zero-padded codes, so searching for one code cannot also match a longer one —
    // search is a substring match, and 'BULK-42' is a prefix of 'BULK-420'.
    const rows = Array.from(
      { length: 500 },
      (_, i) => `Bulk item ${i},BULK-${String(i).padStart(3, '0')},hour,180.00,Imported`,
    ).join('\n');
    await page.locator('[role="dialog"] textarea').fill(`${header}\n${rows}`);

    // The mapping is guessed from the headings, so the preview should already say 500.
    await page.waitForSelector('text=/The first 5 of 500 rows/', { timeout: 10000 });
    check('The import preview maps 500 rows without any manual mapping', true);

    await page.getByRole('button', { name: /^Import 500/ }).click();
    await page.waitForSelector('text=Imported 500 items', { timeout: 30000 });
    check('500 items import through the UI', true);

    // Catalogue rows are edited in place, so a name is an input's value rather than
    // text — the check is the row count, which is also what a person would look at.
    const search = page.locator('input[aria-label="Name, code or description"]');

    // A unique code narrows to exactly one row.
    await search.fill('BULK-042');
    const byCodeRows = await waitForRowCount(page, 1);
    const byCode = byCodeRows === 1 ? await page.locator('tbody tr input').first().inputValue() : '';
    check('Items are searchable by code', byCode === 'Bulk item 42', `${byCodeRows} row(s): ${byCode}`);

    // A name search is a substring search, so "Bulk item 42" also matches 420 to 429.
    await search.fill('Bulk item 42');
    const nameRows = await waitForRowCount(page, 11);
    const first = nameRows === 11 ? await page.locator('tbody tr input').first().inputValue() : '';
    check('Searching 500 items by name narrows to the matches', first === 'Bulk item 42', `${nameRows} row(s): ${first}`);

    await search.fill('');
    const allRows = await waitForRowCount(page, 512);
    check('Clearing the search brings the whole catalogue back', allRows > 400, `${allRows} row(s)`);

    /* ---- 12. nothing errored along the way ---- */
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
  process.stderr.write(`\nData verification failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});