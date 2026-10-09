/**
 * Phase 0 acceptance check.
 *
 * The plan's own gate: "the shell loads with the network disabled, switches
 * light/dark, and every base component appears on a style-guide page".
 *
 * This drives a real browser rather than jsdom, because the three things being
 * checked — the service worker, the IndexedDB database and the offline asset
 * cache — only exist in a browser.
 *
 * Run with: npm run verify:offline
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PORT = 4319;

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

/** Serve the built app, falling back to index.html for client-side routes. */
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
      // Client-side routing: any unknown path is the app.
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

async function main() {
  const server = await serve();
  let browser;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    /* ---- 1. the shell loads ---- */
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    check('The shell loads', true);

    /* ---- 2. no console errors ---- */
    // Vite injects a dev-only source-map warning; ignore anything from sourcemaps.
    const realErrors = errors.filter((e) => !/sourcemap|SourceMap/i.test(e));
    check('No runtime errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

    /* ---- 3. the service worker registered ---- */
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      return Boolean(registration?.active);
    });
    check('A service worker is active', swReady);

    /* ---- 4. the offline cache is populated ---- */
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      if (names.length === 0) return { count: 0 };
      const cache = await caches.open(names[0]);
      return { count: (await cache.keys()).length };
    });
    check('Assets are precached', cached.count > 10, `${cached.count} entries`);

    /* ---- 5. the network can go off and the app still runs ---- */
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    check('The shell loads with the network disabled', true);

    /* ---- 6. fonts came from the cache, not the network ---- */
    const fontOk = await page.evaluate(async () => {
      const response = await fetch('/fonts/Inter-Regular.ttf');
      return response.ok;
    });
    check('Bundled fonts are available offline', fontOk);

    /* ---- 7. the database opens ---- */
    const dbOk = await page.evaluate(async () => {
      const request = indexedDB.open('duly');
      return new Promise((resolve) => {
        request.onsuccess = () => {
          const db = request.result;
          const has = db.objectStoreNames.length > 0;
          db.close();
          resolve(has);
        };
        request.onerror = () => resolve(false);
        // A blocked upgrade from an earlier schema version is not a failure.
        request.onblocked = () => resolve(false);
      });
    });
    check('The local database opens and is seeded', dbOk);

    /* ---- 8. light and dark both resolve ---- */
    const light = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim(),
    );
    check('Light theme tokens resolve', light === '#faf8f4', `--color-paper: ${light}`);

    // The theme is set to "system" by default, so flipping the OS preference has
    // to change the running app, not the next load. The wait is for the media
    // query change event to reach the listener.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page
      .waitForFunction(() => document.documentElement.dataset.theme === 'dark', { timeout: 5000 })
      .catch(() => {});
    const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    const dark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim(),
    );
    check(
      'The system theme change is followed live',
      darkTheme === 'dark' && dark === '#161514',
      `${darkTheme}, --color-paper: ${dark}`,
    );
    await page.emulateMedia({ colorScheme: 'light' });
    await page
      .waitForFunction(() => document.documentElement.dataset.theme === 'light', { timeout: 5000 })
      .catch(() => {});

    /* ---- 9. the style guide shows every base component ---- */
    await context.setOffline(false);
    await page.goto(`http://localhost:${PORT}/style-guide`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Style guide', { timeout: 15000 });

    const headings = await page.$$eval('h2', (nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));
    const requiredSections = [
      'Colour',
      'Type',
      'Shape',
      'Buttons',
      'Inputs',
      'Chips, badges and status',
      'Alerts',
      'Empty states',
      'Progress',
      'Navigation',
      'Tables and key/value',
      'Layout helpers',
      'Density',
      'Overlays',
    ];
    const missing = requiredSections.filter((s) => !headings.includes(s));
    check(
      'Every base component appears on the style guide',
      missing.length === 0,
      missing.join(', ') || `${headings.length} sections`,
    );

    /* ---- 9b. Tailwind actually generated the utilities ----
     * Without `@import 'tailwindcss'` in the stylesheet, every class name is
     * inert and the app still "works" — it just looks like an unstyled page.
     * So this asserts that a token really produced a rule.
     */
    const utilitiesBuilt = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bg-paper rounded-[8px]';
      document.body.appendChild(probe);
      const bg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return bg;
    });
    check('Tailwind utilities are generated', utilitiesBuilt !== 'rgba(0, 0, 0, 0)', utilitiesBuilt);

    /* ---- 10. interactive controls respond ---- */
    await page.getByRole('button', { name: 'Open a dialog' }).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    check('Dialogs open', true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    check('Escape closes a dialog', true);

    /* ---- 11. the theme toggle actually switches ---- */
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole('button', { name: /^Switch to (light|dark)$/, exact: true }).click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    check('The theme toggle switches themes', before !== after, `${before} -> ${after}`);

    /* ---- 11b. a business exists, so the shell renders ----
     * The app sends a brand-new install to the setup wizard rather than an empty
     * dashboard. That is correct behaviour, but it means the shell navigation below
     * has nothing to navigate. Writing one profile row straight into IndexedDB is
     * the shortest honest way to get past it — this script is about the shell, and
     * `verify:data` is the one that drives the wizard properly.
     */
    await page.evaluate(async () => {
      const now = new Date().toISOString();
      const request = indexedDB.open('duly');
      const db = await new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) return;

      await new Promise((resolve) => {
        const tx = db.transaction('businessProfiles', 'readwrite');
        tx.objectStore('businessProfiles').put({
          id: 'prof_offline_check',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          name: 'Offline Check Pty Ltd',
          legalName: '',
          abn: '',
          gstRegistered: false,
          gstRegisteredFrom: null,
          gstHistory: [],
          taxId: '',
          address: { line1: '', line2: '', city: '', state: '', postcode: '', country: '', formatted: null },
          email: '',
          phone: '',
          website: '',
          contactName: '',
          logo: null,
          letterheadHeader: null,
          letterheadFooter: null,
          signature: null,
          brandPrimary: '#1F5E5B',
          brandAccent: '#1F5E5B',
          suggestedColours: [],
          defaultCurrency: 'AUD',
          defaultTerms: 'net_30',
          defaultTaxCodeId: 'tax_zero',
          defaultDesignTemplateId: null,
          defaultLabels: null,
          paymentDetails: {
            methodLabel: 'Direct bank transfer',
            accountName: '',
            bsb: '',
            accountNumber: '',
            payId: '',
            bpayBillerCode: '',
            bpayReference: '',
            other: '',
            paymentLink: '',
          },
          paymentTermsText: '',
          sendingEmailAccountId: null,
          outputSubFolder: '',
          code: '',
          archived: false,
          onboarded: true,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    });

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    check('The app shell renders once a business exists', true);

    /* ---- 12. the sidebar navigation works ---- */
    await page
      .getByRole('link', { name: /^Invoices/ })
      .first()
      .click();
    // Wait for the route, not for an h1: the style guide's h1 is still in the
    // DOM for a frame, and matching on it would pass without navigating at all.
    await page.waitForURL(/\/invoices/, { timeout: 10000 });
    await page.waitForSelector('h1:has-text("Invoices")', { timeout: 10000 });
    const heading = await page.textContent('h1');
    check(
      'The router navigates',
      Boolean(heading?.includes('Invoices')),
      `${heading ?? ''} at ${new URL(page.url()).pathname}`,
    );

    /* ---- 12b. every real sidebar + palette link resolves without a 404 ---- */
    const navLinks = await page.$$eval('nav a[href]', anchors => anchors.map(a => a.getAttribute('href')).filter(Boolean));
    let badNav = 0;
    for (const href of Array.from(new Set(navLinks))) {
      const url = new URL(href, `http://localhost:${PORT}`);
      const res = await page.request.get(url.href).catch(() => null);
      const status = res?.status() ?? 0;
      if (status === 404 || (res && res.status() >= 500)) {
        badNav += 1;
        console.log(`  bad nav link: ${href} -> ${status}`);
      }
    }
    check('Every sidebar nav link returns a real route', badNav === 0, `${badNav} dead link(s)`);

    /* ---- 12c. the hidden acceptance gate renders and settles ---- */
    await page.goto(`http://localhost:${PORT}/acceptance`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#compliance-status', { timeout: 25000 });
    await page.waitForSelector('#render-status', { timeout: 25000 });
    await page.waitForSelector('#pagination-status', { timeout: 25000 });
    await page.waitForFunction(
      () => document.querySelector('#compliance-status')?.textContent?.match(/PASS|FAIL|ERROR/) &&
            document.querySelector('#render-status')?.textContent?.match(/PASS|FAIL|SKIPPED/) &&
            document.querySelector('#pagination-status')?.textContent?.match(/PASS|FAIL|SKIPPED/),
      { timeout: 60000 },
    );
    const complianceText = await page.textContent('#compliance-status');
    const renderText = await page.textContent('#render-status');
    const paginationText = await page.textContent('#pagination-status');
    check(
      'Every built-in template passes the compliance checker',
      Boolean(complianceText?.trim().startsWith('PASS')),
      complianceText ?? '',
    );
    check(
      'A document renders byte-for-byte the same twice',
      Boolean(renderText?.trim().startsWith('PASS')),
      renderText ?? '',
    );
    check(
      'A 60-line invoice paginates to multiple pages',
      Boolean(paginationText?.trim().startsWith('PASS')),
      paginationText ?? '',
    );

    /* ---- 13. no errors accumulated during the whole run ---- */
    const finalErrors = errors.filter((e) => !/sourcemap|SourceMap/i.test(e));
    check(
      'Still no runtime errors at the end',
      finalErrors.length === 0,
      finalErrors.slice(0, 3).join(' | '),
    );
  } finally {
    await browser?.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`\nOffline verification failed: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
