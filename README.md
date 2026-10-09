# Duly

**Invoices, duly done.**

Offline-first invoicing for Australian businesses. Every feature works with the
network cable unplugged, there are no subscriptions and no accounts, and your
data never leaves your machine.

---

## What it is

Duly is a local-first invoicing app built from a single TypeScript codebase that
runs as a web app, ships as a desktop app for macOS and Windows (Tauri), and
builds for Android (Tauri). One renderer, one storage model, one PDF — the phone
and the desktop produce the same document.

| Principle                                   | What it means in practice                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Offline-first, local-only**               | The service worker precaches every asset. IndexedDB holds the data. There is no server.                           |
| **Free forever**                            | Only MIT, Apache-2.0 and OFL dependencies. No paid APIs, no cloud database, no telemetry.                         |
| **Fast to the second invoice**              | The first takes setup. Every one after that should take under a minute, via clients, catalogue items and presets. |
| **Automate with rules, not AI**             | Deterministic if-then rules you can read and edit. AI is an optional add-on, off by default.                       |
| **One renderer, one truth**                 | The on-screen preview and the exported PDF come from the same view model and the same layout engine.              |
| **Australian by default, global by design** | AUD, GST and ABN out of the box; every ISO 4217 currency and any tax rate.                                        |
| **Your data is portable**                   | One database, plus full JSON export and automatic backups.                                                        |

## Status

The plan, phases 0–10, is implemented. See [`CHANGELOG.md`](CHANGELOG.md) for
the full audit trail of what was built and verified.

| Phase | Scope                                                    | Status                              |
| ----- | -------------------------------------------------------- | ----------------------------------- |
| 0     | Foundations, design system, app shell, offline PWA       | **Complete**                        |
| 1     | Data layer, seed data, setup wizard, settings            | **Complete**                        |
| 2     | Clients, contacts, ABN validation, item catalogue        | **Complete**                        |
| 3     | Calculation engine and unit tests                        | **Complete** — 431 tests            |
| 4     | Document editor and lifecycle                            | **Complete**                        |
| 5     | PDF renderer and template studio                         | **Complete** — 21/21 offline checks |
| 6     | Output: files, exports, email, email templates           | **Complete**                        |
| 7     | Automation, dashboard, reports, bank import              | **Complete**                        |
| 7B    | Time, expenses, projects, retainers, accountant exports  | **Complete**                        |
| 8     | Desktop apps (Tauri) — macOS and Windows                 | **Complete** — builds and bundles   |
| 9     | Android — phone layouts, share sheet, signed APK         | **Complete** — builds and signs     |
| 10    | Duly Assist (optional AI)                                | **Complete** — off by default       |

### What ships

- **Documents**: invoices, quotes, credit notes, delivery notes, pro-formas and
  receipts, with a compliance panel (the ATO tax-invoice rules) before submit.
- **Six design templates** with a live-preview template studio: colours, fonts,
  table columns, renameable labels, header/footer, page setup, payment QR,
  photo grid and custom-field slots. Export and import a template file.
- **Automation**: recurring schedules (idempotent — opening the app late
  produces exactly one draft), overdue flagging, reminder sequences queued for
  your approval, late fees, quote expiry, scheduled sends, a rules engine, and
  an automation log explaining every action.
- **Reports**: aged receivables by client and bucket, income per month, GST per
  quarter and per BAS period — each with a CSV export.
- **Exports**: PDF, CSV, XLSX, DOCX, JSON per document; bulk ZIP from the list;
  Xero and MYOB import layouts for your accountant.
- **Business modules**: time tracking with a start/stop timer ("Invoice
  unbilled time" in one action), expenses with GST and receipt photos,
  projects, and retainers with a low-balance alert.
- **Bank import**: CSV, OFX and QIF statements matched to invoices by amount
  and reference, with a review screen to confirm, split or ignore each line.
- **Desktop**: native files (a folder chosen once, silent writes after that),
  SMTP through Proton Mail Bridge, an SMTP token or Gmail, the OS keychain,
  tray, launch-at-login, and installers via GitHub Actions.
- **AI (optional)**: draft an invoice from a sentence, read a receipt photo,
  draft an email, ask your data — every result waits for your review, AI can
  never submit, send or record a payment, and Local-only refuses any endpoint
  that is not localhost.

## Getting started

Requires Node 20 or newer.

```bash
npm install       # also bundles the fonts and generates the icons
npm run dev       # http://localhost:5183
```

Open it in **Chrome or Edge**. Those are the only browsers with the File System
Access API, which is what lets Duly write PDFs silently into a folder you choose.
Everything else works, but auto-filing falls back to a download.

### The desktop app

Requires the Rust toolchain (`rustup`) and, for Android, the SDK's
cmdline-tools, the NDK and `rustup target add aarch64-linux-android`.

```bash
npm run tauri build                                  # macOS: Duly.app + .dmg
npm run tauri build -- --target aarch64-apple-darwin # Apple Silicon
npx tauri android build --apk --target aarch64       # Android: signed APK
```

The desktop app feature-detects Tauri and installs its adapters: native files,
SMTP and the keychain, with the same IndexedDB storage the web uses. The JSON
export in Settings → Data is the one-time importer from a web install.

### Scripts

| Command                  | What it does                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run dev`            | Development server                                                                            |
| `npm run build`          | Typecheck and produce a production build in `dist/`                                           |
| `npm run preview`        | Serve the production build                                                                    |
| `npm test`               | The unit test suite (Vitest)                                                                  |
| `npm run test:watch`     | Tests, re-running on change                                                                   |
| `npm run coverage`       | Tests with a coverage report                                                                  |
| `npm run typecheck`      | TypeScript, no emit                                                                           |
| `npm run lint`           | ESLint                                                                                        |
| `npm run format`         | Prettier, writing changes                                                                     |
| `npm run fonts`          | Bundle the OFL fonts as TTF into `public/fonts`                                               |
| `npm run icons`          | Generate the PWA icons from the SVG mark                                                      |
| `npm run tauri`          | The Tauri CLI (dev, build, android)                                                           |
| `npm run verify:offline` | Build, then drive a real browser to prove the app works offline, including the acceptance gate |
| `npm run verify:data`    | Build, then prove the data layer in a browser: setup, ABN, clients, items, export and restore |
| `npm run verify`         | Both browser checks                                                                           |
| `npx tsx scripts/eval-ai.mts [limit]` | The AI evaluation set against a configured local endpoint                        |

### The acceptance gate

`npm run verify:offline` drives a real browser through the app and asserts, in
the hidden `/acceptance` route, the three renderer criteria: every built-in
template passes the compliance checker with sample data; the same document
renders byte-for-byte the same twice (`creationDate` is pinned to the issue
date); and a 60-line invoice paginates with the repeated table header. The
other checks cover offline rendering, navigation, dialogs and themes.

### The style guide

`/style-guide` shows every base component, every design token and both themes.
It is reachable in any build, because a design nobody can inspect is one that
drifts.

## How it is put together

Four layers. Only the bottom one knows what platform it is on.

```
src/
  core/         Pure TypeScript. Money, tax, calculations, dates, numbering,
                compliance, rules, recurring, merge fields. No DOM, no
                database, no clock.
  renderer/     A document becomes a view model; the view model becomes a PDF.
  adapters/     The platform seams: storage, files, mail, secrets, AI — plus
                the web and desktop implementations.
  ui/           The design system: tokens and base components.
  features/     Screens: documents, clients, items, automation, reports,
                time, expenses, projects, retainers, settings, import.
  state/        The app store and the editor store.
  lib/          Exports, email, automation engines, bank import, AI pipeline,
                time billing, accountant exports.
src-tauri/      The desktop and Android half: window config, the Rust commands
                (SMTP through lettre, the OS keychain, reveal in folder), the
                tray and launch-at-login, and the generated Android project.
```

### The platform adapters

The entire surface between the core and the platform. Moving from web to
desktop means swapping implementations and changing nothing else, because no
feature code touches IndexedDB, the file system, SMTP, the keychain or an AI
endpoint directly.

| Adapter          | Web                                                 | Desktop and Android                 |
| ---------------- | --------------------------------------------------- | ----------------------------------- |
| `StorageAdapter` | IndexedDB (Dexie)                                   | IndexedDB (works in the webview)    |
| `FileAdapter`    | File System Access API, with a download fallback    | Native file system, silent writes   |
| `MailAdapter`    | Save the PDF, copy the message, open the mail app   | SMTP via lettre, or the mail app    |
| `SecretAdapter`  | Session memory, honestly reported as not persistent | OS keychain                         |
| `AiAdapter`      | Any OpenAI-compatible endpoint over HTTP            | The same — HTTP is HTTP             |

## The parts worth reading first

| File                                | Why                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/core/money/money.ts`           | Every amount is an integer count of minor units. No floating point ever touches a stored value. |
| `src/core/calc/calculate.ts`        | The ten calculation rules, in the order the specification fixes them.                           |
| `src/core/validation/compliance.ts` | The ATO tax-invoice rules, each check naming the rule it came from.                             |
| `src/core/engines/recurrence.ts`    | Why opening the app late still produces exactly one invoice.                                    |
| `src/core/engines/rules.ts`         | The rules engine: conditions evaluated on save, a patch rather than a mutation.                 |
| `src/lib/exports.ts`                | The zero-dependency ZIP writer behind CSV, XLSX, DOCX and bulk ZIP.                             |
| `src/lib/bankImport.ts`             | CSV, OFX and QIF statement parsers and the amount-and-reference matcher.                        |
| `src/lib/timeBilling.ts`            | How tracked time and expenses become invoice lines, and how entries never bill twice.           |
| `src/lib/ai.ts`                     | The AI pipeline: guards, extraction, validation, one re-ask, token logging.                     |
| `src/renderer/pdf.tsx`              | The renderer: embedded fonts, repeated table headers, and the byte-for-byte determinism.        |
| `src/renderer/model.ts`             | The single view model the preview and the PDF both read.                                        |

## Licence

MIT for the code. The bundled fonts are SIL Open Font License 1.1: Inter, Source
Serif 4, Fraunces, IBM Plex Sans, IBM Plex Mono and Lora.

Duly is not tax advice. It checks that a document contains what the ATO requires;
you or your accountant remain responsible for the treatment.
