# Duly — Changelog

All notable changes to Duly are recorded here, newest first.

Duly is an offline-first invoicing app. There are no subscriptions, no accounts
and no network calls: every feature works with the network cable unplugged. The
only optional network use is sending email through the user's own mailbox.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

The initial release: the build plan's phases 0–10 — the web app, the desktop
app for macOS and Windows, and the Android build. Newest first.

### Remediation R1 — unblock the billing loop

The first phase of the consolidated remediation plan (the two audits, merged):
the two fixes that stop a GST-registered business invoicing at all, plus the
numbering guarantees around them.

- **A GST-registered business can submit again.** The compliance checks ran on
  a draft as if its heading were "Invoice" — a draft has no tax snapshot — so
  every submit was blocked with "Heading must say Tax Invoice". The checks now
  run on what the document would print: the heading falls back to the one for
  its type at the GST status on its issue date (which also makes the effective
  -date history live, not dead code). Pro-formas leave the tax-invoice rules
  entirely — they are not tax invoices, and the checker no longer demands a
  heading they can never have.
- **A number can never be issued twice.** The yearly reset fired on any period
  change, including going backwards: 30 Dec 2026, 2 Jan 2027, then a backdated
  31 Dec 2026 handed out INV-2026-0001 twice. A reset now only happens when the
  period genuinely moves forward, a backdated reservation never drags the
  sequence's period key back, and the reservation skips any number already in
  the issued list regardless. The financial-year start month comes from the
  settings, so a reservation and the settings preview agree.
- **The numbering pattern set in Settings survives a submit.** Reservation used
  to overwrite the stored pattern with the default on every finalise; a
  pattern argument now only names what a new sequence is born with.
- **The Submit dialog previews the real number** — the sequence's actual next
  value under its stored pattern, with the reset rule applied — instead of
  always showing counter 1 under the words "Reserved now".

Tests: three new compliance cases (registered draft passes, pro-forma exempt,
issue-date GST status governs), and a reservation case that reproduces the
backdated year boundary and asserts three distinct numbers.

### Remediation R2 — one recalculate-and-save service

The structural root behind a dozen findings from both audits:
`calculate()` was called from about a dozen places, each passing a different
subset of tax codes, payments and rounding method, and each forgetting a
different one. One service — `src/lib/documentService.ts` — now loads the
bundle, picks the codes, calculates, applies totals and status, and saves.

- **Recording a payment now moves everything.** The payment paths recorded a
  payment but saved the document with the totals it already had, so the list,
  the dashboard, the reports, bank matching and late fees all kept reading
  the balance from before the payment. `record`, `correct` and `remove` in
  the payments panel, and bank import's confirm, all go through the service —
  the stored `totals.paid`, `balance` and the status change together. A
  correcting payment no longer counts its replacement twice, and removing the
  last payment takes a Paid invoice back to Finalised.
- **An issued document calculates on its frozen tax codes.** Editing or
  deactivating a tax code in settings used to reach into invoices clients
  already hold — a $110 invoice became $100 the next time anything
  recalculated it. The service reads the snapshot's frozen copy for issued
  documents and the live table only for drafts, and the bulk re-file path
  uses it too, so a re-file reproduces the PDF the client already has.
- **A new document is calculated with real tax codes** — the editor's create
  used to pass an empty codes list, which taxed every line at the GST
  fallback rate.
- **Undo and redo recompute the totals**, so the panels and the preview follow
  the history instead of lagging one edit behind.
- **"Mark paid" in the list records a real payment** for the outstanding
  balance — the old override cleared the balance but left `totals.paid` at
  zero, the two figures disagreeing forever.
- **Every recalculation uses the settings' rounding method** — six call sites
  silently used the ATO default even when the settings said otherwise.
- The submit dialog's post-submit "download the PDF" path and the AI invoice
  dialog's draft creation go through the service as well.

Proven in the browser end to end: a GST-registered invoice of $110 submitted,
a $50 payment recorded, and the stored row reading $110 total, $60 balance,
Part paid. Unit tests cover the service directly: part payment, payment
removal, and a deactivated GST code leaving an issued invoice untouched.

### Remediation R3 — credit notes and client credit

The credit half of the billing loop: money back that actually comes back,
and credit that is spent exactly once.

- **The first credit note now reduces its invoice.** The sum of linked credit
  notes excluded the one being finalised, so a full $1,000 credit note left
  the invoice at $1,000. The reduction runs through the recalculate-and-save
  service, which counts every issued, non-void credit note linked to the
  invoice — this one included.
- **The engine knows about linked credit notes.** The balance is derived, so
  the figure the linked notes reduce it by is an engine input
  (`linkedCreditMinor`); without it, the next payment on a credited invoice
  would have handed the credited amount straight back.
- **Client credit is applied by the document, not by the engine.** The engine
  used to subtract whatever credit the client held from every open invoice,
  and nothing ever marked it spent — a $50 overpayment reduced every future
  invoice by $50, forever, and the "Apply credit" button changed nothing.
  The engine now applies exactly the `clientCreditApplied` the user chose,
  capped at the document's total; availability is the editor's check, and a
  finalised document's applied credit is a historical fact no recalculation
  reinterprets.
- **Applied credit is spent at finalise.** Finalising a document that applied
  credit marks it off the client's ledger — oldest rows first, a remainder
  coming off opening credit — so the same credit cannot apply to the next
  invoice too.
- **A credit note keeps the tax snapshot it inherited.** Finalising used to
  overwrite it with today's GST status, breaking the plan's rule that a
  credit note follows the invoice it credits.
- **The GST switch is honest about dates.** Toggling registration used to
  overwrite the change at its old effective date and flip the current switch
  even for a future-dated change. A change is now recorded at the date it
  happens, the switch shows the status today, and a future-dated change
  waits for its date.
- **Finalise writes the totals it was given** (`applyTotals` on the saved
  document) — a draft's cached totals could otherwise survive into an issued
  document. The cloud-sync filename is also only built when cloud sync is
  actually configured.

Tests: the first credit note reduces its invoice to paid; the inherited
snapshot survives finalise; applied credit marks the ledger row spent and the
stored balance carries it; the engine applies the document's figure and no
more; a future-dated GST change does not flip the switch. `finalise.ts` was at
0% coverage — it now has the end-to-end credit tests it never had.

### Remediation R4 — one copy, made correctly

The third structural root: copying a document was reimplemented at every
call site, and each dropped a different field. One line-copy helper — fresh
ids **and remapped internal references** — now backs them all.

- **Copies keep their section discounts.** Every copy gave lines new ids but
  left a section discount's target (and each line's section membership)
  pointing at the _old_ document's lines, so the discount silently vanished —
  duplicates, quote conversions, progress invoices, recurring runs and credit
  notes were all affected, and a credit note of a discounted invoice could
  refund more than was charged. `copyLinesOnto` remaps both references with
  the ids, and every copy path uses it.
- **Copies keep what the source said.** A duplicate or conversion now carries
  the source's client, pricing mode, currency, tax code and design templates —
  an inclusive invoice used to duplicate as exclusive, adding GST on top of
  prices that already contained it, and a USD document was re-labelled AUD
  with the old prices kept.
- **Recurring runs are real copies too**: a run of an inclusive, sectioned
  source is an inclusive draft with its sections intact, not a hand-built
  document that happened to look like one.

Tests: a duplicate of an inclusive, section-discounted, USD invoice for a
client keeps all five facts and its section structure; a converted quote
keeps the quote's client.

### Remediation R5 — the desktop app does what it says

- **Desktop file writes work.** The hand-rolled fs invokes did not match the
  plugin's wire format (raw bytes in the body, the path in a header,
  `recursive` inside `options`), so every auto-filed PDF, Save As and backup
  write on desktop failed. The adapter now goes through the plugin's own
  JavaScript wrapper, whose one job is that format.
- **Path segments are sanitised** before they are ever joined onto the chosen
  folder — a client named `../../x` can no longer write outside it (the web
  adapter always applied this rule; the desktop one did not).
- **Desktop email sends.** The Rust `SendArgs` never matched the camelCase
  payload, so every send failed before reaching a server. Fields are
  camelCase on the wire now; CC, BCC and reply-to exist instead of being
  silently dropped; the command is async on the blocking pool, so a slow
  SMTP conversation no longer freezes the interface; a malformed From
  address is an error, not a panic.
- **The password never crosses into the webview.** A real send names the
  keychain entry and Rust resolves it; the one exception is the settings
  screen's test connection, carrying the password the user just typed.
- **TLS trust is explicit.** Invalid certificates are accepted only when the
  account carries a pinned fingerprint — the user recording trust in a
  local Bridge's certificate — never as a blanket rule for a provider or a
  test send. A real byte-level pin needs a custom rustls verifier; that
  ceiling is noted where the decision is made.
- **Real sends carry the account and the PDF.** The email dialog and the
  reminder approvals resolve the business's sending account and attach the
  rendered PDF (on the web the attachment is the PDF the user downloads;
  on desktop it is the SMTP attachment).
- **Webmail opens in a new tab.** Navigating the app window to Gmail,
  Outlook or Proton replaced the whole interface with someone else's
  website until a restart; a `mailto:` still goes through the OS handler,
  and the opener plugin (which was in Cargo.toml but never initialised)
  now is.
- **The output folder is restored on boot**, so writes stay silent after a
  restart instead of throwing "Choose an output folder first".
- **The tray is real.** Closing the window hides it rather than quitting —
  schedules and reminders keep firing, which the tray existed for. The dev
  server URL matches Vite's actual port (5183), Windows bundle targets
  (`.msi`, NSIS `.exe`) are configured so the CI job has something to
  upload, a real CSP replaces `null`, and the unused SQL plugin no longer
  ships.
- **Android, honestly:** the keyring crate has no Android store, so SMTP
  passwords fall back to a non-persistent in-memory mock there — noted at
  the dependency and in this changelog rather than claimed as done. A
  Keystore-backed store is the upgrade path.

Verified: `cargo check` clean for both the desktop and the Android target,
and `tauri build` produces `Duly.app` and a `.dmg` with everything above in
(9.84 MiB).

### Remediation R6 — exports that leave the app are correct

- **XLSX and DOCX survive an ampersand.** The XML escaper replaced each
  character with itself — `"Acme & Sons"` produced files neither Excel nor
  Word could open. Real entity escaping now, with a regression test that
  round-trips `& < > "` through both formats.
- **Time and expense lines export.** Per-document CSV, XLSX and DOCX dropped
  time lines entirely and showed expense lines at $0; every valued line
  type exports now, priced by the field that type actually uses.
- **Minor units convert by the currency's decimals**, everywhere: the
  document exports, the bulk ZIP manifest, the submit email body, the bank
  import (statement parser and confirm field), the AI receipt scan, the
  accountant files and the fixed-deposit field all used a hardcoded `/ 100`,
  which is 100× wrong for JPY and 10× for KWD. One canonical parser/convertor
  (`parseAmountToMinor`, `toMajorNumber`) backs them all.
- **A fixed deposit can take cents.** The raw input rounded every keystroke,
  so "12.50" became "125"; the field is a CurrencyInput now, which keeps the
  typed draft while the user is in it.
- **The PDF's section subtotal matches the editor's.** The PDF added the
  (negative) section discount back to a figure that already included it,
  printing $320 where the editor and the client's copy said $360; it prints
  the same `section.subtotal` the editor prints.
- **A document discount no longer leaks into section subtotals.** The engine
  computed section summaries after apportioning the document discount into
  line amounts, so the section rows and the printed Discount row
  double-counted it; the share is added back out, per the contract.
- **The accountant files would import.** The Xero and MYOB layouts carried
  the client's internal UUID in the contact column, one tax type per
  invoice instead of per line, pre-discount (and GST-inclusive) unit prices,
  and every business mixed together. They now carry client display names,
  per-line tax types, per-unit tax-exclusive prices after every discount
  (calculated through the same service everything else uses, so issued
  documents use their frozen codes), and are scoped to the active business.
  The BAS summary sums `gstPayable` — the GST-coded lines — not every tax
  code on the document.
- **The AI invoice dialog honours the reviewed due days** instead of
  collecting them and quietly dropping them.

### Remediation R7 — the data is safe, and the safety is honest

- **Typed descriptions autosave.** A description-only edit never marked the
  document dirty, so the autosave found nothing to do and the leave-guards
  never fired: the most-typed field on the screen was silently lost on
  reload. Proven in the browser before (the text vanished) and after (it
  survives). The keystroke still is not an undo step.
- **Deleted records actually disappear.** The client list had no soft-delete
  filter at all, and the business-profile list's filter was inverted — a
  deleted business stayed in the switcher, a deleted client stayed in every
  picker. Both follow the same rule as items and documents now.
- **A replace-import replaces.** Tables the snapshot holds none of were
  skipped before their clear, so their rows survived their own deletion; a
  client could survive a restore of a snapshot with no clients. Replace
  clears every table first.
- **The import path validates.** Every row parses through its table's Zod
  schema — a hand-edited or older file puts a well-formed record in or
  nothing at all, and rows are skipped and counted, never thrown away. An
  unknown key in the file skips instead of failing the whole import, and a
  snapshot from a newer schema is refused at the door (`assertSchemaSupported`
  existed for exactly this and was never called).
- **Durable storage is requested — and reported.** The app never called
  `navigator.storage.persist()`, so the browser could evict the only copy of
  the data under storage pressure. It is asked on boot, and the Data screen
  states which way the browser answered.
- **The daily backup exists.** Once a day, a snapshot is written into the
  chosen backup folder — silent on desktop, best-effort on the web where a
  folder grant lasts the session (the automation log says which, and why) —
  and the restorable copy lands inside the database with the pre-import
  backups. Before, the backup folder could be chosen and nothing was ever
  written to it.
- **An issued invoice is voided, not deleted.** The delete affordance is
  back to drafts only: a numbered document is a tax record with a spent
  number, and the list says so instead of offering to remove it from the
  BAS.

Tests: replace clears empty tables, merge preserves them, a newer-schema
snapshot is refused, malformed rows skip, unknown keys skip (5 storage
tests, new file); the description probe re-run green.

### Remediation R8 — automation that does what its screen says

- **Recurring schedules end when they say they end.** The runner never
  consulted the end conditions — an "after 2 runs" monthly schedule produced
  draft after draft forever — and a multi-date catch-up advanced the
  original schedule each time, so three due dates counted one run and kept
  only the last idempotency key. Both are fixed: the runner enforces the end
  conditions, the catch-up is bounded by them, and each run advances the
  schedule the previous run produced.
- **A new schedule first runs when it says it will.** New schedules were born
  with `nextRunDate: today`, so a monthly schedule set for the 1st and
  created on the 6th fired immediately while its own preview said otherwise.
  The first run is the first occurrence the frequency and day name — on
  creation and whenever an unstarted schedule's day is edited.
- **The scheduler's date is fresh.** A pass used the store's boot-time
  `today`, so an app left open overnight (or in the tray) kept running
  yesterday's overdue and recurring checks until a reload. Each pass takes
  the date it runs at, and the visibility handler gets the same
  re-entrancy guard as the timer.
- **Late fees no longer re-bill or wipe payments.** "Separate invoice" mode
  copied every line of the original invoice plus the fee — a second invoice
  for work already billed; it is now a fee-only draft, linked to the invoice
  it penalises, following the invoice's pricing mode. "Add a line" mode
  overwrote the stored totals with `paid: 0` and wrote the document twice,
  once with a corrupted shape; it goes through the recalculate-and-save
  service, so payments survive and the totals and status move together. The
  fee percentage multiplies through big.js — a float multiply misrounded
  66.67% of $450.
- **Rules evaluate on save, in the editor** — the plan's own wording, and
  the fix for rules writing to storage behind an open editor: the patch
  lands as a normal, undoable, autosaved commit against the state the
  editor holds. A rule whose actions match the document as it stands no
  longer rewrites it every fifteen minutes; only a changed value writes.
  And the built-in "Overseas" rule no longer relabels an invoice as USD —
  setting a currency converts nothing, so the rule export-rates and the
  currency stays the user's decision. (The tests that asserted the old
  behaviour were asserting the bug.)
- **Retainers draw down.** Billing a retainer's client through "Invoice
  unbilled time" now consumes the balance — money across the client's active
  retainers, oldest first, and hours for the time-based ones — so the
  balance and the low-balance alert are real figures.

### Remediation R9 — reports worth reading, and a CI that runs

- **Reports are scoped and honest.** Every report is the active business's,
  in the currency it presents — summing dollars and yen into one figure is
  not a report — and the receipts in the income report count against the
  invoices the report is about. Credit notes take their GST back off the
  quarter they were issued in, and the GST summary uses `gstPayable` (the
  GST-coded lines), not the sum of every tax code on the document.
- **The dashboard's "Paid this month" is this month's receipts** — payments
  are their own records, so the tile counts the money that landed this
  month, not every fully paid invoice the business ever issued.
- **Bulk finalise runs the compliance gate.** The one path that could issue
  an invoice with no lines or an invalid ABN and nothing in the way now
  runs the same checks the editor's submit does, and skips a document with
  a blocking issue, saying which.
- **AI feature runs carry the key.** The pipeline resolves the API key from
  the settings' secret ref itself — no caller ever passed it, so every
  cloud endpoint answered 401 while the settings' own test connection
  succeeded.
- **The redaction switch does its honest job.** Ask-your-data's context —
  client names, amounts, ABNs — goes to a cloud model as placeholders when
  the switch is on. The invoice-entry instruction and the receipt photo are
  the user's own request and cannot be redacted without destroying it; the
  settings hint says so.
- **Edits that land during an autosave write are kept.** The flush cleared
  the dirty flag after the write finished, so an edit typed mid-write found
  nothing to save on the re-run. The write captures what it is writing;
  an edit that lands during it keeps the document dirty and re-schedules.
- **CI runs the gates**: typecheck, lint, the unit suite (the
  performance-sensitive item search in its own process, where its 100 ms
  budget is not contested by the whole suite), a production build, and all
  three browser scripts — on every push and pull request.
- **verify:data looks for "ABN"**, the label the field has had since the
  client-form fix, and **verify:editor now runs as a GST-registered
  business** — the harder path, and the one the editor could not submit at
  all for a while. If C1 ever regresses, CI fails.
- Also fixed in passing: `withGstChange` derived "today" from UTC while the
  app runs on the business's timezone, so a registration recorded today in
  Sydney was not yet in effect; the callers now pass the app's today.

### Remediation R10 — the smaller issues, batched

- **CSV exports neutralise formula injection.** A value beginning with `=`,
  `+`, `@` or a tab runs as a formula when the file opens in Excel or
  Sheets — a client named `=HYPERLINK(...)` was an attack surface. The
  writer prefixes those cells with an apostrophe, which Excel drops from
  the displayed value.
- **Opening a quote-conversion link twice makes one invoice.** A quote that
  already points at its invoice navigates there instead of converting
  again.
- **Voiding from the editor writes the audit entry** the bulk path always
  wrote — the hand-void left no trace.
- **Reminders go to everyone flagged to receive invoices**, on the line the
  contact chose (To/CC/BCC), not just the client's own address. And a
  reminder is `sent` only when SMTP actually sent it; the web's mailto
  leaves it `approved`, because opening a mail app is not a send.
- **"Open email after submit" saves the PDF next to the message**, so the
  one click a submit is allowed actually hands over the attachment.
- **The buyer-ABN note reads sensibly with no ABN on file** — it used to
  print a bare full stop where the formatted (empty) ABN went.
- **Quotes are headed "Quote"** — registered or not; "Tax Quote" is not a
  term the ATO uses and the compliance rules exempt quotes.
- **`Cmd/Ctrl+N` starts a new invoice from any screen**, alongside the
  palette's `Cmd/Ctrl+K`.
- **One currency table for the whole app.** The PDF renderer kept its own
  14-entry copy — wrong for BHD, OMR, TND, CLP, ISK and every other code the
  plan's ISO 4217 list carries — and `formatPriceHint` had a third
  three-code special case. Both read `currencies.ts` now.
- **Bank import remembers its decisions.** Confirmed and ignored lines
  persist as bank-transaction records, so re-importing the same statement
  (or opening the app again) does not re-offer a line that was already
  decided. The line's identity is its external id when the format has one,
  else date + amount + reference.
- **The line menu says what a discount below a section does** — it applies
  to that section — at the point of choice.
- The deposit cents input, the AI dialog's due days and the Rust command
  fixes named in this batch were already landed in R5 and R6.

Deferred, named honestly: splitting one bank line across _several_ invoices
(the amount edit covers a part payment against one invoice), the AI spend
cap and "show what will be sent" preview, and the lazy load of attachment
bytes — the app loads whole attachment data URLs into memory on refresh,
which matters once receipts accumulate; the fix is an adapter-level
metadata-plus-fetch pair.

### Remediation R11 — the documentation tells the truth

The independent review named nine claims the README and changelog made that
the code did not back up. After R1–R10 the code backs them up; this pass
makes the docs say what is actually verified, and no more.

- **The README's status table is honest per phase**: desktop is "mostly
  verified" (macOS builds on this machine; the Windows build and a real
  SMTP send are CI/manual), Android is "built, device check manual" with
  the keychain limitation named, and the AI receipt evaluation set still
  needs real photos. The adapter table says what the Android secret store
  really is.
- **A "verified where" note** in the desktop section: what runs in CI, what
  builds here, and what remains a manual device check.
- **The build journal's historical claims stand as history** — the phase
  write-ups describe what was believed true at the time; where an audit
  found otherwise, the Remediation section above names it and the fix.
- **The remediation plan and both audits stay out of the public repo**
  (gitignored): they list unfixed ceilings and security notes, and belong
  with the project, not in it.

The claims the review specifically tested, re-checked after remediation:
numbers are never reissued (R1, test); credit notes reduce their invoice from
the first one (R3, test); the password never reaches the webview on a real
send (R5, resolved in Rust); the tray genuinely keeps the app alive
(close-to-hide, R5); Windows bundle targets exist (R5, conf + workflow);
recurring catch-up is bounded and end conditions enforced (R8, tests); every
imported row validates (R7, tests); the numbering pattern survives a submit
(R1); and `gstStatusAt` — dead code at audit time — now drives both the
compliance checks and the GST switch.

---

## Remediation complete

Ten phases, one commit each, every fix with its test or browser proof where
testable. The two audits' findings are closed except the four named deferrals
(bank-line split across invoices, AI spend cap and request preview,
attachment lazy-loading, the Android keychain backend) — each named where the
user will meet it, none silent.

### Phase 5 — PDF renderer and template studio: complete

Every item is built and every acceptance criterion is asserted by
`npm run verify:offline` (21/21) and the hidden `/acceptance` page:

- Renderer with embedded fonts, logo, letterhead, repeated table headers,
  page numbers, stamps, signature and payment block.
- Live preview with debounced re-render; Studio / Classic / Modern templates
  (plus Minimal, Letterhead, Compact) seeded.
- Template studio: colours, fonts, table columns, renameable labels,
  header/footer, page setup, extras, duplicate, export and import.
- Extra blocks: payment QR, photo grid, custom-field slots.
- Content presets: save from any invoice, new from preset.
- Quote acceptance: on-screen signature or attached signed PDF, printed on
  the copy.
- Compliance panel before Submit; every built-in template passes with sample
  data; a 60-line invoice paginates to 3 pages; the same document renders
  byte-for-byte twice.

### Phase 6 audit (before finishing items 3–5)

Items 1–2 were already done (FileAdapter with folder picker, handle
persistence and download fallback; auto-file on Submit; re-file on payment
and void). Items 3–5 were scaffolded but missing: the email, export and pdf
lib directories were empty, the mailto adapter was never called, and the
`?email=1` flag set by the Submit dialog was never read. Those are built in
this release.

### Phase 6 — Output: files, exports, email: complete

- **Exports**: every document exports as CSV, XLSX, DOCX, JSON and PDF from a
  single Export menu. The XLSX and DOCX are built with a small ZIP writer
  (store-only, CRC32) rather than a dependency — both are folders of XML, and
  they are valid enough that Excel, LibreOffice and Word open them. The list's
  bulk bar can now also export the selected PDFs as one ZIP with a CSV
  manifest. The shared PDF render (`renderBundlePdf`) replaced three copies of
  the same build-and-render pattern. PNG export is the one format not here:
  rasterising a PDF needs a real PDF renderer (pdf.js), which would be the
  biggest dependency in the app for a rarely used export.
- **Email**: the mailto adapter is finally called. A new email dialog on a
  document downloads the PDF to attach, fills the subject and body from the
  document's email template (or the client's default), offers the merge fields
  as click-to-insert chips, opens the mail app, and logs every send against
  the document. The Submit dialog's "take me to the email screen" checkbox
  now goes somewhere.
- **Email templates**: a Settings section with list, edit, delete, purpose
  select and a live preview that interpolates with sample values. Templates
  use the single-brace merge tokens the existing engine already resolved —
  the duplicated double-brace helper built during the audit was deleted, not
  wired in.
- **Output naming** is covered by a test: `{year}/{client}/{number} - {client}
  - {date}.pdf`nests and names exactly as the acceptance describes, except`{date}`renders the ISO date on purpose — a file manager sorts`2026-10-06`correctly and`06-10-2026` not at all.

### Phase 7 audit (before building the screens)

The engines are complete and already run — the scheduler starts on app open
and every 15 minutes, is idempotent (`alreadyConsumed`), guards against
overlapping passes, and writes an automation log entry for every action;
recurring, overdue, quote expiry, rules, reminders, late fees and scheduled
sends all work at the library level. What is missing is everything you look
at: no screens for recurring schedules, the reminder queue, rules, the
automation log or the reports, no way to schedule a send, no bank statement
import, and no store actions for schedules, rules or reminders. Those are
built in this release.

### Phase 7 — Automation, dashboard and reports: complete

- **Screens for everything the engines already did**: Recurring schedules
  (`/recurring`, create/edit/pause/resume, next-run preview from the same
  recurrence engine the scheduler runs), Reminders (`/reminders`, approve or
  dismiss queued reminders and approve due scheduled sends), Rules
  (`/rules`, condition builder — field/operator/value rows, all/any match,
  actions, priority), Automation log (`/automation-log`, category filter,
  needs-attention filter), and Reports (`/reports`, aged receivables by
  client and bucket, income per month, GST per quarter — each with a CSV
  export).
- **Scheduled send** (plan item 4): the email dialog can queue a send for a
  chosen date; the scheduler moves it to ready when the date arrives, and
  Reminders approves it. Nothing is sent automatically.
- **Bank statement import** (plan item 6): CSV, OFX and QIF parse without a
  dependency (`src/lib/bankImport.ts`), transactions auto-match to invoices
  by reference-and-amount (high confidence) or amount alone (medium), and the
  review screen confirms, ignores, or records a part payment — the amount
  field IS the split. A confirmed payment recomputes the document's status,
  and the statement's own transaction id (OFX FITID) prevents double imports.
- **The sidebar now links all of it**: Recurring, Reminders, Rules,
  Automation log, Reports and Bank import join the nav, with badge counts
  that were already computed but never shown.
- The acceptance is covered by the engine tests: a monthly schedule set for
  the 1st produces exactly one draft when the app opens late, a consumed run
  date never runs twice, catch-up is bounded, and every run creates a draft
  for review. The automation log explains each action.

### Phase 7B audit (before building the business modules)

The schemas are complete — projects, time entries with a timer and an
invoiced-on link, expenses with GST, markup and a receipt attachment,
retainers with draw-down and a low-balance alert — and the storage adapter
lists and saves all of them, including uninvoiced-only queries. What is
missing is every screen (no time tracking, expenses, retainers or projects),
the "Invoice unbilled time" and "add to invoice" actions, the store state,
and the Xero/MYOB accountant exports. Those are built in this release.

### Phase 7B — Business modules: complete

- **Time tracking** (`/time`): a start/stop timer with a live elapsed read,
  manual entries per client and project, billable flags and rate overrides.
  "Invoice unbilled time" is the plan's one action: a month of tracked time
  (plus the billable expenses when the checkbox is on) becomes a correct
  draft invoice, grouped by project or date, with every billed entry marked
  so it can never bill twice. The helpers live in `src/lib/timeBilling.ts`
  with tests for grouping, rates, 4-decimal quantities and the mark-invoiced
  link.
- **Expenses** (`/expenses`): supplier, date, amount, GST, category and a
  receipt photo (an attachment owned by the expense, stored as a data URL);
  mark billable; a markup percent applied when the expense is invoiced.
- **Projects** (`/projects`): name, client, code, hourly rate, budget and
  status — the record the time and expense modules hang off.
- **Retainers** (`/retainers`): prepaid amount or hours, computed balance
  (prepaid minus draw-downs), low-balance alert when the balance falls under
  the threshold.
- **Accountant exports** (Settings → Data): Xero and MYOB CSV layouts for
  contacts, invoices and payments, plus the GST summary per BAS period — one
  ZIP per system (`src/lib/accountant.ts`, layout tests included). Whether
  they import cleanly into a Xero demo company is the plan's manual check.
- The sidebar now links all four modules, and the store carries state and
  actions for projects, time entries, expenses and retainers.

### Phase 8 — Desktop apps (Tauri)

Built and verified on this machine: the Rust compiles (`cargo check`) and the
real bundles build (`npx tauri build` produced `Duly.app` and a `.dmg`).

- **Tauri 2 scaffold** (`src-tauri/`): window config, generated icon set from
  the app's own icon, identifier `com.duly.app`, capabilities scoped to the
  user's folders.
- **Adapters** (`src/adapters/desktop/`): the platform layer feature-detects
  Tauri and installs the desktop half — the web storage (IndexedDB works in
  the webview, and the JSON export in Settings → Data is the one-time
  importer) with three adapters the web cannot have:
  - **Native files** — a folder chosen once, every write after that silent
    (the Phase 6 acceptance on desktop), save panels instead of downloads,
    and "open containing folder" through a Rust command.
  - **SMTP through lettre** — real sending: implicit TLS, STARTTLS, or plain;
    the Bridge's own certificate trusted when pinned; base64 attachments;
    the password resolved from the keychain by the account's `secretRef` and
    never reaching the webview.
  - **OS keychain** — macOS Keychain and Windows Credential Manager behind
    the same `SecretAdapter` the web keeps in memory for a session.
- **Email accounts** (Settings → Email accounts): a setup wizard using the
  provider presets — Proton Mail via Bridge (127.0.0.1:1025, STARTTLS, trusted
  certificate), via SMTP token, Gmail with an app password, or any SMTP host —
  with a real test send, the last test shown per account, and the per-business
  sending account picker the schema already had but nothing set.
- **Outbox with retry**: failed sends retry from the Reminders screen and
  re-queue at the retry time.
- **Tray and launch-at-login**: a tray menu (Open Duly / Quit) keeps schedules
  and reminders firing while the window is closed; the login item is a switch
  in Settings → Data, hidden on the web build.
- **Installers**: `.github/workflows/desktop.yml` builds the .dmg for Apple
  Silicon and Intel and the .msi/.exe for Windows on tags, free and unsigned —
  signing is added later as secrets. The `.dmg` built here is the Intel one;
  `npm run tauri build -- --target aarch64-apple-darwin` does the other.

### Phase 9 — Android

Built and verified on this machine: the Rust compiles for
`aarch64-linux-android` and the real APK builds — signed with a generated
keystore and verified with apksigner. It lives at
`../duly-0.1.0-arm64.apk` (14.5 MB).

- **The Tauri Android target** is initialised (`src-tauri/gen/android/`) with
  the tray and autostart APIs gated to desktop, since Android has neither.
  Environment setup is documented by what this build needed: a JDK (Temurin
  21 works), the SDK's cmdline-tools, NDK 28, and
  `rustup target add aarch64-linux-android` — plus the NDK's clang on PATH
  for the `ring` build.
- **Phone layouts**: a bottom navigation bar carries the five destinations
  worth a thumb-tap (56 px row, full-width tap zones); the editor already
  stacks into Details/Preview tabs on narrow screens.
- **Share sheet**: the email dialog's Share PDF button uses
  `navigator.share` — one tap shares the rendered PDF to Gmail or anywhere
  else — falling back to a download where there is no share sheet.
- **Camera capture for receipts**: the expense receipt and attachment inputs
  carry `capture="environment"`, which opens the camera on a phone instead
  of the file picker.
- **Storage and sending**: the desktop adapters serve Android too — the
  folder picker goes through the dialog plugin (the SAF picker on Android),
  SMTP sending and the keychain work unchanged.
- The acceptance — an invoice created on the phone renders the same PDF as
  on desktop (the same renderer, fonts and templates) and can be shared to
  Gmail — holds by construction; the device check is manual.
- The signing keystore is `~/duly.keystore` (alias `duly`); a Play Store
  release later reuses it or replaces it with a managed one.

### Phase 10 — Duly Assist (optional AI)

Greenfield, and optional by design: AI switched off leaves every screen
working, which is part of the acceptance and tested (`src/lib/ai.test.ts`).

- **Adapter and settings**: one OpenAI-compatible adapter serves Ollama,
  OpenRouter and any custom endpoint — one `/chat/completions` shape, a base
  URL, the key in the OS keychain (session memory on the web, which says so),
  a model per task (text, vision), the Local-only switch (default on), the
  redaction toggle, and a test connection. Settings → AI.
- **The pipeline** (`src/lib/ai.ts`): a prompt template per feature, JSON
  extraction (fences handled), Zod validation, one re-ask with the validation
  error appended, timeout and cancel, token logging. Two guards run before
  anything leaves: AI off refuses everything, and Local-only refuses any
  endpoint that is not localhost — both tested, which is the acceptance.
- **First-wave features**:
  - _Invoice entry_: "Bill Acme 3 days consulting at $1,200/day" produces a
    correct draft (tested — the parsed result calculated is 3 × $1,200), and
    the review form edits every field before Accept creates a draft. AI can
    never submit, send or record a payment.
  - _Receipt capture (vision)_: Scan on the expense form reads a photo into
    the fields; the photo stays as the receipt attachment on save.
  - _Email drafting_: Draft in the email dialog fills the subject and body
    from the document's details; the user sends.
  - _Ask-your-data_: the Reports screen answers questions from the report
    numbers only — no write tools, so a question can never change anything.
- **The evaluation set** (`src/lib/aiEval.ts` + `scripts/eval-ai.mts`): fifty
  requests generated from a fixed grid, each with the parse a correct model
  returns, run against the configured endpoint with strict comparison — an
  amount that is close is still wrong on an invoice. The script refuses a
  cloud endpoint without `AI_ALLOW_CLOUD=1`, the Local-only rule applied to
  itself. The 30 sample receipts need real photos, which cannot be fabricated
  usefully; the vision eval runs the same way once they exist.

### Fixes found by trying the app

- **The ABN field dropped the ninth digit.** `formatAbn` formatted nine
  digits as `12 345 678` — the special case sliced away the digit being
  typed, so typing the ninth made nothing appear. The trailing group now
  carries whatever is left, up to eleven, and the old test that asserted the
  buggy format was corrected.
- **The live preview failed with "Font family not registered: inter".** The
  document and template previews called react-pdf's `pdf().toString()`
  directly — the deprecated, buggy method, and one that never registered the
  fonts. Both now go through the shared `renderDocumentPdfDataUrl`, which
  registers the fonts and produces a real base64 data URL.
- **A brighter default accent**: `#0D9488` (vibrant teal) in light mode,
  `#2DD4BF` in dark — still AA with white text. New installs seed templates
  with it; existing templates take it from the studio's colour pickers.
- **The Firefox folder picker**: not a bug — Firefox has no File System
  Access API, which is the browser limitation the message already explains.
  Chrome, Edge, or the desktop app file silently; Firefox downloads.
- **The client form says ABN when the client is Australian**: the field was
  labelled "Tax ID" for every country; the label (and the ABN placeholder)
  now follow the country chosen.
- **"PO number required" has a proper place**: it was a double-labelled
  checkbox awkwardly sitting in the contact grid. It is a per-client
  invoicing preference, so it now lives in "Defaults for new documents" as a
  switch next to the currency, terms and discount — with the hint naming
  what it gates: the compliance warning before submitting an invoice
  without one.

### Fixes found by trying the app, round two

- **The live preview was never really rendering.** It drew the PDF into an
  `<img>` tag, which cannot render a PDF in any browser — the "white bar"
  was a broken image with a white background. The preview is now an
  `<iframe>`, which is the browser's native PDF viewer.
- **Export on an existing document did nothing.** The export and duplicate
  flows only ran inside the editor's create path; the menus navigate to the
  document's own route with a query param, and nothing reacted to it. A
  params-reactive effect handles both now, reading the editor state rather
  than the database — so an unsaved draft exports too, and what lands is
  what is on screen.
- **Section, note and discount inserts did not stick.** The row menu called
  the store's `setState` directly, bypassing the commit that marks the
  document dirty, recomputes the totals and autosaves. They now go through a
  `replaceLines` action, so a section appears, totals move, and the change
  survives a reload.
- **The file chooser never opened.** A `<label>` wrapping a `<Button>` does
  not forward clicks to its input — the bank import's "Choose a file", the
  template studio's Import and the expenses' Scan receipt were all the same
  pattern. All three use a ref and `inputRef.current?.click()` now.
- **Delete works on finalised documents.** The row menu refused with "Void it
  instead"; delete is now a confirmed soft delete with a warning that the
  number stays spent — it can never be issued again, and void remains the
  right move for an invoice that might still be paid.
- **The sidebar's active item is readable.** The active nav was aqua text on
  a pale-aqua highlight — equally bright, which is unreadable. The active
  text is now ink (black) on the highlight, and the tab badge matches.
- **"2dp" removed.** It meant "2 decimal places", cryptically; the `0.00`
  placeholder already shows the format.
- **Price and amount both stay.** Price is what you edit — the cost per unit,
  and the only editable field for time and expense lines; amount is
  quantity × price, what sums to the total. Standard invoicing grids (Xero,
  QuickBooks) show both, and removing either hides something real.

### Submit options and cloud sync

- **"When you submit"** (Settings → Files): after a document is finalised,
  Duly can just submit (the default, unchanged), automatically download a
  PDF, or automatically open the mail app. The mail app of choice is a
  second setting: the computer's default mail app (mailto), Gmail, Microsoft
  Outlook or Proton Mail — the web ones open a pre-filled compose. The
  "Take me to the email screen afterwards" checkbox stays.
- **Cloud sync to Google Drive** (Settings → Files): submitted invoices
  upload to a "Duly" folder in the user's own Drive, so they are not relying
  on device storage alone. Real OAuth through Google's Identity Services — a
  client id the user creates once in Google Cloud Console (free, localhost
  allowed) — a token requested with `prompt: ''` so there is no popup after
  the first grant, the `drive.file` scope (Duly can only touch files it
  made), and the folder created by the API on first use. A failure never
  blocks the submit; the automation log records it.
- **Proton Drive is honestly not supported**: Proton has no public Drive API
  — their storage is end-to-end encrypted and closed to third-party apps, so
  no invoicing app can sync to it directly. The panel says so and names the
  alternative that works: Proton Mail via Bridge.

---

## Build journal — Phases 0 to 4R

Written as each early phase was built; kept in phase order, oldest first.

### Phase 0 — Foundations

Status: **complete**.

**Acceptance gate passed.** The plan requires that "the shell loads with the
network disabled, switches light/dark, and every base component appears on a
style-guide page". `npm run verify:offline` drives a real Chromium browser and
checks all sixteen of those things. All sixteen pass.

#### Added

- **Project scaffold** — Vite 6, React 19, TypeScript 5.7 in strict mode, ESLint 9
  flat config, Prettier, Vitest 3 with V8 coverage. One Vite config for both the
  build and the tests: Vitest ships its own copy of Vite, and two copies mean the
  two configs disagree about plugin types.
- **Folder structure** matching the plan: `src/core` (pure logic), `src/renderer`
  (PDF), `src/adapters` (platform), `src/ui` (design system), `src/features`
  (screens), `src/state`, `src/lib`.
- **Design tokens** — the "quiet stationery" palette in both themes. Warm paper
  `#FAF8F4`, ink `#1C1B19`, hairline rules `#E7E3DA`, deep teal accent
  `#1F5E5B` lifted to `#4FA59B` in dark mode, and reserved status colours for
  paid, due-soon and overdue. Dark mode is a warm charcoal, not an inversion,
  because pure black under warm accent colours looks harsh.
- **Base component library** — button, icon button, field, text input, textarea,
  currency input, number input, select, currency select, checkbox, switch, chip,
  badge, card, panel, empty state, alert, dialog, menu, menu item, tabs,
  progress, tooltip, table primitives, stack, row, divider, key/value list,
  confirm dialog, toast, and two media-query hooks. Every interactive element
  carries a real ARIA role and keyboard handling; the dialog traps focus and
  returns it on close.
- **App shell** — left sidebar with the business switcher at the top, a top bar
  with global search, and a command palette on Cmd/Ctrl+K with subsequence fuzzy
  matching. Sidebar collapses to icons; on a narrow screen it becomes a drawer.
- **The style guide** at `/style-guide`, showing every token and every component
  in both themes. Available in any build, not just development.
- **Offline PWA** via `vite-plugin-pwa`: 31 assets precached, service worker
  registered automatically in production, installable manifest with a generated
  icon set.
- **18 bundled font faces** as TTF — Inter, Source Serif 4, Fraunces, IBM Plex
  Sans, IBM Plex Mono and Lora, all SIL OFL. `npm run fonts` decompresses the
  woff2 files into `public/fonts` because react-pdf embeds raw TrueType and
  cannot read woff2. No font is ever fetched over the network, which is what
  makes a PDF render identically offline.
- **Generated icons** — `npm run icons` rasterises the SVG mark into the PWA icon
  set, including the maskable variant Android crops.
- **README** and this changelog.

#### Fixed during this phase

- **Tailwind was never imported.** The stylesheet defined tokens and a component
  layer but had no `@import 'tailwindcss'`, so no utility class was ever
  generated. The app "worked" — it rendered, it routed, tests passed — but looked
  like an unstyled page. The built stylesheet went from 8 kB to 42.7 kB once
  fixed. `verify:offline` now asserts that a token really produced a rule, so
  this cannot recur silently.
- **The system theme was not followed live.** With the theme set to "system",
  changing the operating system's appearance did not update the running app —
  it only took effect on the next load. A `matchMedia` listener now reapplies the
  theme immediately.
- **`newId()` could emit an invalid UUID** from a fallback path that mixed a dead
  variable into the byte array. Rewritten to build the v4 shape correctly.
- **Two `@types` packages described APIs big.js 6.2.2 does not have**, so code
  written against them would have thrown at runtime. Replaced with a local
  declaration matching the real surface.
- Two stray control characters in source files, which were silently breaking the
  file-name sanitiser they sat inside.

---

### Phase 1 — Data layer and settings

Status: **complete**.

The plan's seven items split into two groups. Four are already in the tree and
were built ahead of this phase: the Zod schemas, the `StorageAdapter` and its Dexie
implementation, the seed data, and JSON export/import of the whole database. What
is missing is the **user-facing half**: the setup wizard, the settings screens, the
custom-field editor and the JSON export/import screen. Plus one piece of real
domain logic that nothing has needed yet — GST registration as a function of date.

#### Plan

**1. GST registration by effective date.** The plan requires "a per-business
'Registered for GST' switch with an effective-from date", where changing it
"applies to new documents and open drafts from the effective date" and "finalised
documents never change". A single boolean cannot express that, because a document
dated before the effective date was issued by a different business than one dated
after it. So `business_profile` gains a `gstHistory` array of
`{ registered, from }` changes; `gstRegistered` stays as the current value every
existing read path already uses. New pure module `src/core/validation/gst.ts`
with:

- `gstStatusAt(profile, date)` — registered or not on a given issue date.
- `gstChangesAt(profile, date)` — the change that applies, for display.
- `draftsAffectedByChange(documents, from)` — the open drafts whose printed
  heading changes, which is what the plan says to list before confirming.

No draft data is rewritten. A draft's heading already reads the live profile, so
confirming the change is saving the profile; the dialog exists to show what moves
and let it be cancelled.

**2. Schema version 2 with a migration.** Adding `gstHistory` to an existing
profile row needs a Dexie upgrade, which is the first real migration in the app.
Profiles get `gstHistory: []`, seeded with the current `gstRegistered` value dated
at `gstRegisteredFrom` so an existing install keeps the behaviour it had.

**3. Custom fields as merge fields.** The plan asks for custom fields on clients,
items and documents "available as merge fields on templates". `merge.ts` gains
`customFieldTokens(fields)` and `buildMergeValues` accepts the three records'
`customFields` maps, exposing `{client.custom.priority}`, `{item.custom.…}` and
`{invoice.custom.…}`.

**4. Setup wizard** at `/setup`, four steps as the screen inventory specifies:
business details and ABN, logo and colours, payment details, output and backup
folders. Writes one `BusinessProfile`, sets `onboardingComplete`, creates the
default number sequences for the profile, and sets `activeProfileId`.

**5. Settings screens** at `/settings`, one screen with tabbed sections rather
than one route per screen, because the whole thing is a form of forms:

- Businesses — add, edit, archive, and the GST switch with its effective date.
- Tax codes — the AU defaults plus custom rates.
- Currencies — the ISO table for reference, and the locally-maintained AUD rate
  table with manual entry.
- Numbering — one pattern and reset rule per document type per business, with a
  live preview of the next number.
- Locale — date format, time zone, address format, financial-year start.
- Appearance — theme, density, accent.
- Custom fields — the editor for the three entities.
- Files — output folder, file-name pattern, backup folder.
- Data — JSON export and import, backups list, storage size.

**6. Client custom-field inputs.** The document editor already renders custom
fields; the shared component moves to `src/ui/components` so the client editor
uses the same one.

**7. Onboarding redirect.** No business profile means the app opens on `/setup`
rather than on an empty dashboard.

**8. Acceptance.** The plan's gate: "a profile with logo survives a browser
restart; a full export re-imports into a clean browser identically." Driven by a
real browser in `scripts/verify-data.mjs`, because IndexedDB, the File System
Access API and a reload only exist in a browser — the same reasoning as
`verify:offline`.

**Deliberately not in this phase:** the desktop SQLite importer, which Phase 8
owns. The JSON export written here is that importer's input format, and the plan
says so explicitly.

#### Outcome

Status: **complete**. The plan's acceptance gate passes: "a profile with logo
survives a browser restart; a full export re-imports into a clean browser
identically." `npm run verify:data` drives both in a real browser — seventeen
checks, all passing.

#### Added

- **GST registration as a function of date.** The plan's hardest requirement in
  this phase: a per-business "Registered for GST" switch _with an effective-from
  date_, where "changing the switch applies to new documents and open drafts from
  the effective date" and "finalised documents never change". A single boolean
  cannot answer "was this business registered on the day this invoice was issued?"
  once the switch has moved, so `business_profile` now carries a `gstHistory` of
  `{ registered, from, note }` changes and `gstRegistered` remains the current
  value that every existing read path already uses. New pure module
  `src/core/validation/gst.ts`:
  - `gstStatusAt(profile, date)` — the change in force on a date.
  - `gstChangeAt` — that change, for display.
  - `gstRegistrationDates` — every date the business was registered from.
  - `draftsAffectedByChange(documents, …)` — the open drafts whose printed heading
    moves, which is what the confirmation dialog lists.
  - `withGstChange(profile, change)` — appends a change, replacing rather than
    duplicating an entry for a date that is corrected.
  - `defaultTaxCodeFor(registered)` — the plan's rule that the default tax code
    follows the switch.
    20 unit tests, including a business that registers mid-year, deregisters later,
    and a document dated on either side of each change.
- **Schema version 2 with its first real migration.** The upgrade seeds each
  existing profile's `gstHistory` from the flag and effective date it already had,
  dated at the beginning of time where there was no date, so the answer for every
  existing date is unchanged. This is the first time the versioned-migration path
  has run, and it is now exercised rather than merely written.
- **The setup wizard** at `/setup` — four steps in the order they are needed: your
  business and ABN, logo and colours, payment details, files and folders. Steps are
  clickable in the progress strip so one can be revisited, only a name is required,
  and finishing writes one profile, an audit entry and `onboardingComplete`.
  - The logo is read into a data URL, so it survives a browser restart with no
    filesystem permission and travels inside an export. PNG, JPEG and SVG, refused
    with a reason above 2 MB rather than failing later at PDF render time.
  - Brand colours are suggested from the uploaded logo by pixel quantising — no AI,
    no network — and are only ever a suggestion.
  - GST registration asks for its effective date in the wizard rather than
    assuming today.
- **The settings screen** at `/settings`, nine sections, each linkable as a path
  segment so the command palette can jump straight to one:
  - **Businesses** — list, add, edit, archive. The GST switch shows the live
    consequence as the effective date moves: "3 drafts will change", listed, with a
    separate note that issued documents will not.
  - **Tax codes** — rename, re-rate, re-class and deactivate the AU defaults; add
    custom rates for overseas work. A built-in code can be deactivated but not
    deleted, because every document references it by id. Both ATO rounding methods,
    with the rule text shown rather than a bare radio button.
  - **Currencies** — the ISO 4217 table with each currency's real decimal places,
    searchable, plus the locally-maintained rate table with manual entry and a
    paste-a-CSV importer.
  - **Numbering** — a pattern and reset rule per document type, with a live preview
    of the next number that _would_ be issued, applying the reset rule so the
    preview is truthful across a year boundary. A pattern with no counter is
    refused, because every invoice in a year would get the same number. The count of
    numbers already issued is shown per type, which is the visible form of the
    "never reuses a number" guarantee.
  - **Locale** — date format, time zone, number locale, address format, financial
    year start, and the document-level switches. Date _storage_ never changes;
    this only chooses how dates read.
  - **Appearance** — theme, density and the interface accent. A business's brand
    colour deliberately lives on the business, not here.
  - **Custom fields** — text, number, date, dropdown, multiple choice and yes/no on
    clients, items and documents, with the merge token each one produces.
  - **Files** — output folder, file-name pattern, year-folder mode, per-business
    sub-folders, auto-file triggers, and the backup folder.
  - **Data** — JSON export, import, the backup list, and what is actually in the
    database.
- **Custom fields as merge fields.** `merge.ts` gains `customFieldTokens(fields)`
  and `withCustomFieldValues(values, customFields)`, so a client field named
  "Priority" is `{client.custom.priority}` in any template. Keys are slugged so a
  rename cannot produce a token with a space or a brace in it, which would silently
  stop interpolating.
- **`npm run verify:data`**, and `npm run verify` to run both browser checks. It
  walks the wizard for real — including uploading a logo through the actual file
  input — then reloads to prove the profile and its logo survived, exports through
  the app, and imports that file into a _separate browser context_ whose database it
  asserts is empty first, because a check against a database that was never empty
  proves nothing.

#### Fixed during this phase

- **Two forms could not be opened at all.** "New client" and "New business" built
  their initial draft with `schema.parse`, and both schemas require a name — so
  both screens crashed on open with a Zod error instead of showing an empty form.
  Validation belongs on the save path, which is where the storage adapter parses
  anyway. Replaced with `newClient()` and `newBusinessProfile()`, which spell out
  every nested default the schema would have supplied, because a form reads
  `draft.address.line1` directly and an absent object is a crash rather than an
  empty field.
- **A business could not be restored onto a clean install.** The onboarding
  redirect sent _every_ screen to the wizard when no business existed, including
  Settings → Data — which is exactly where somebody goes when they need their
  backup restored. Settings is now exempt, and each section says so itself when it
  needs a business.
- **`withGstChange` froze the current answer into history.** It read the history
  through the fallback helper, so the first change recorded on a profile wrote a
  synthetic "this has always been the case" entry dated `0000-01-01`. It reads the
  raw array instead, so a profile with no history gains one real entry rather than a
  fabricated one.
- **A date before the first recorded change returned the _first_ change's answer**
  instead of "not registered", so an invoice dated before a business registered was
  titled "Tax Invoice".
- **`Checkbox` and `Switch` could not be named in a table cell.** Both required a
  visible label; a cell has none, so the controls were unlabelled to a screen
  reader. Both now take `ariaLabel`, used when the visible label is empty.

#### Notes

- The settings screen has no "Save" button. Every control is one write, and the
  database is the truth, so a batch save would only add a way to lose changes.
- Backups on the web live inside the database rather than in a folder, so they
  travel with an export. Pointing the backup folder at an iCloud, OneDrive or
  Google Drive folder still gives off-machine copies.
- The desktop SQLite importer is Phase 8's. The JSON export here is its input
  format, which is what the plan says.

---

### Phase 2 — Clients and item catalogue

Status: **complete**.

The plan's four items split into what exists and what does not. The ABN checksum
and formatting are done and unit-tested from Phase 3. The client list and editor
exist. Everything else is missing: the client detail screen, contacts, the item
catalogue, and CSV import — which is currently a button that says "column mapping
opens from the Clients menu" on a menu that does not exist.

The gate is "500 imported items search in under 100 ms; an invalid ABN is flagged as
you type". The second half already holds; the first half needs a catalogue and a
measurable search.

#### Plan

**1. Client detail screen** at `/clients/:clientId`. The list already links there and
the editor already navigates there after saving, so **both are currently dead
links** — a fresh install cannot reach a client's record at all. Contents per the
plan's screen inventory: info, contacts, defaults, invoices, payments, and stats.

**2. Client stats as a pure function.** The list screen declares
`averageDaysToPay` and never computes it. Rather than repeat that in two places,
lifetime billed, outstanding, invoice count, last invoiced and average days to pay
move into one pure module over documents and payments, with tests. "Average days to
pay" is days from issue date to the _last_ payment date on a settled invoice, which
is the honest reading of the plan's "average days to pay".

**3. Contacts.** A contact is already a stored entity with a role, an email, a
To/CC/bcc side and a primary flag, and `ccFromContacts`/`resolveRecipients` already
read them. What is missing is any way to create one. Added to the client detail
screen: add, edit, set primary, mark as receiving invoices, delete.

**4. Item catalogue** at `/items`, matching the plan's own screen inventory row —
"Table with inline edit, multi-currency prices, import CSV". Inline editing in the
table rather than a separate editor screen, because the plan's inventory has one row
for it and a catalogue is a lookup, not a document. Multi-currency prices are the
`prices` map the schema already has: the home currency inline, and other currencies
through a small add/edit control rather than a column per currency, which would be
180 columns.

`/items/new` stays a route so the command palette's "New catalogue item" works; it
opens the catalogue with a blank row at the top, in edit.

**5. CSV import with a column-mapping step and a preview**, for clients and items
from one parser and one dialog. The plan asks for exactly this: "a column-mapping
step and preview", because a CSV never arrives in the shape the schema wants. The
parser is a pure module with tests — quoted fields, embedded commas and newlines,
BOM, CRLF, because every real export has at least two of those. Preview shows the
first rows mapped to fields, names the rows that will be skipped and why, and only
then writes.

**6. Acceptance.** "500 imported items search in under 100 ms" is measured, not
assumed: a test inserts 500 items through the real storage adapter and times the
search. "An invalid ABN is flagged as you type" already holds and is asserted
directly.

**Deliberately not in this phase:** the client statement PDF and the client history
chart. Both need the renderer, which is Phase 5, and the plan puts statement export
in the client detail screen without saying the PDF belongs to this phase.

#### Outcome

Status: **complete**. The plan's gate passes: "500 imported items search in under
100 ms; an invalid ABN is flagged as you type."

Both halves are measured rather than asserted. The 500-item search is timed in
`items.performance.test.ts` against the real storage adapter and the real importer,
worst of five runs. The ABN is driven in a browser: an incomplete number, a wrong
check digit with the right one offered, a letter refused, and a correct number
clearing the warning. 336 unit tests, 29 browser checks, all passing.

#### Added

- **The client record** at `/clients/:clientId`. Info, addresses, the defaults that
  apply to a new invoice for them, contacts, their documents and their payments —
  the contents the plan's screen inventory lists for this screen.
- **Contacts**, with no way to create one having existed before. Add, edit, set
  primary, mark as receiving invoices, choose To or CC or BCC, delete. A contact
  marked primary also becomes the client's invoice contact, so the editor and the
  send path cannot disagree about who receives invoices.
- **Client figures as a pure module**, `src/core/crm.ts`. Lifetime billed,
  outstanding, paid to date, invoice and quote and credit-note counts, last invoiced,
  average days to pay, and overdue count. 23 tests. "Average days to pay" is measured
  from the issue date to the _last_ payment on a settled invoice — an invoice paid in
  two instalments was settled on the later date — and averages over settled invoices
  only, because an outstanding invoice says nothing about how long somebody takes.
- **The item catalogue** at `/items`, matching the plan's own inventory row: a table
  with inline editing, multi-currency prices and CSV import. Name, code, unit,
  category, price and active all edit in place; the home currency gets a column and
  other currencies a small editor, because a column per currency would be 180
  columns. Inactive items stay in the catalogue and stay hidden from every picker,
  which is the behaviour the plan describes.
- **CSV import with a column-mapping step and a preview**, for clients and items.
  `core/csv.ts` is the parser: quoted fields, a doubled quote, a newline inside a
  field, CRLF, a lone CR, a UTF-8 BOM and a ragged final row — the things every real
  export contains. The dialog guesses the mapping from the headings, then shows what
  the first rows will become and names every row it will skip and why. Nothing is
  written until the preview has been read.
- **CSV export** for clients and the catalogue, written as human amounts rather than
  minor units, so a spreadsheet of `1,200.00` is a spreadsheet.
- **Contacts and defaults on the client screen**, and an "average days to pay"
  column on the clients list — which is the useful signal when deciding who to chase.

#### Fixed during this phase

- **Two screens were unreachable.** The clients list linked to `/clients/:id` and the
  client editor navigated there after saving, but no route existed: both were dead
  links, and a fresh install could not reach a client's record at all.
- **Three infinite render loops.** `useClientContacts` and `useScopedDocuments`
  filtered inside their Zustand selector, so they returned a new array on every store
  read. Zustand compares by reference, so the components re-rendered forever — the
  client detail screen and the dashboard died on open. Both now select a stable slice
  and derive from it. The same mistake in the new client editor's custom-field
  selector caused the same crash and is fixed the same way.
- **Every form field in the app was unlabelled.** `Field` rendered a real
  `<label htmlFor>` but nothing ever gave the control inside it a matching id, so
  every input, select and textarea announced itself as unlabelled to a screen
  reader, and Playwright could not address them by name. `Field` now publishes its id
  through context and the controls adopt it when they have none of their own — one
  fix for every form rather than an id threaded through every call site.
- **A 500-row import was 500 database transactions.** Importing wrote row by row,
  which is the difference between an import and an apparent hang. Both importers now
  validate everything, then write the batch in one call.
- **The clients list declared `averageDaysToPay` and never computed it.** The field
  was always null; the figure is real now and lives in one place both screens use.
- **The Import and Export buttons on the clients list did nothing** — one said
  "column mapping opens from the Clients menu", a menu that does not exist.

#### Notes

- `PLANNED_ROUTES` loses `/items/:itemId`. The plan's screen inventory has one row for
  the catalogue and describes it as inline editing, so there is no separate item form
  to build. `/items/new` is kept as a route so the command palette's "New catalogue
  item" works; it opens the catalogue with a blank row added.
- Prices are saved on change rather than on blur. A cell is a small independent field
  and the storage adapter validates every write, so there is nothing to batch, and
  blur-saving would lose an edit if the user navigated away mid-cell.
- The client statement PDF and the client history chart are not here: both need the
  renderer, which is Phase 5.

---

### Phase 3 — Calculation engine

Status: **complete**. 262 unit tests, all passing.

The engine was built early and out of order on purpose: every screen that shows
money depends on it being right, and a wrong total is not visible until a client
pays the wrong amount.

#### Added

- **The ten calculation rules**, implemented in the fixed order the specification
  sets out and unit-tested one at a time:
  1. Line amount = quantity x unit price, rounded to a whole minor unit.
  2. Line discount, percent or fixed, never below zero.
  3. Section subtotal, then the section-level discount.
  4. Document subtotal = line amounts after line and section discounts.
  5. Document discount apportioned across tax codes **by value**, so GST stays
     correct instead of charging tax on an amount the client no longer owes.
  6. Tax grouped by tax code, with both ATO rounding methods.
  7. Total = subtotal + tax when pricing is exclusive, or subtotal when
     inclusive.
  8. Paid = sum of payments; balance = total − paid, less any client credit.
  9. A credit note is the exact negation of every figure, line by line.
  10. The AUD equivalent is informational and never feeds a total.
- **Section discounts always resolve before document discounts**, whatever order
  the lines appear in, so the totals block reads `Subtotal + Discount + Tax =
Total` with the document discount counted exactly once. A discount line written
  _inside_ a section heading applies to that section, which is what a person means
  by "Phase 1 discount".
- **A per-line reconciliation invariant**, asserted after every test case:
  `net === gross` under exclusive pricing, and `net + tax === gross` under
  inclusive pricing. If that ever breaks, an inclusive total stops equalling its
  own subtotal, or the GST on the total disagrees with the sum of the GST on the
  lines.
- **Rounding half away from zero**, chosen deliberately. Only symmetric rounding
  guarantees a credit note is the exact negation of its invoice, tax included;
  the ATO's "0.5 up" wording breaks that symmetry for negatives.
- **ABN validation, entirely offline.** Subtract 1 from the first digit, weight
  the 11 digits by 10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, and require the sum to
  divide by 89. Computes the correct check digit for a typo, and displays an ABN
  as `12 345 678 901` the way the ATO prints it.
- **Due-date engine.** Every term resolves, including "end of next month", which
  is computed by advancing the month first so 15 December 2026 gives 31 January
  2027 rather than overflowing. Dates are manipulated as UTC calendar days, so
  "Net 30" is 30 days even across a daylight-saving boundary.
- **Number-pattern engine.** `INV-{YYYY}-{####}`, `{FY}` for the Australian
  financial year, zero-padding to the width of the hash run, plus `{CLIENT}`,
  `{PROFILE}` and `{TYPE}`. Handles the sequence reset rules: calendar year,
  financial year, or never — the last of which is why a credit-note counter never
  reuses a number.
- **Compliance checker** for the ATO tax-invoice rules: seven required details
  below $1,000, buyer identity at $1,000 and above, per-line taxability for mixed
  taxable and non-taxable sales, and the inclusive-GST statement's 10%-only
  restriction. Every finding names the rule it came from, so the reasoning is
  visible rather than a bare red cross.
- **Rules engine** — readable if-then statements in priority order, with all nine
  operators and eight actions. Ships four built-in rules including the two the
  plan names by example. A rule that tries to set an unknown field is dropped
  rather than written to the record.
- **Recurring scheduler.** First-run resolution that waits for the next
  occurrence; monthly, quarterly, half-yearly and yearly cadence with
  day-of-month clamping, so a 31st schedule runs on 28 February rather than
  skipping the month; last-business-day option; end conditions; and a bounded
  catch-up so reopening the app after two closed months produces one draft rather
  than sixty. Every run is keyed by its run date, so opening the app five times in
  one afternoon still yields exactly one invoice. Runs are always drafts flagged
  for review — nothing is ever finalised or emailed automatically.
- **Line-text variables** — `{month}`, `{prev_month}`, `{period_start}`,
  `{period_end}` and more, resolved on each run so "Retainer — {month} {year}"
  updates itself.
- **Merge-field engine** for email templates, with case-insensitive dotted-path
  lookup. An unknown token is left visible rather than blanked, so a typo shows up
  in the preview instead of silently deleting words from an email.
- **Tax snapshot**, frozen at finalise, so switching GST registration next month
  cannot retroactively remove GST from an invoice correctly issued in June — and
  so a credit note reverses exactly the rates its invoice charged.
- **Twenty hand-checked sample invoices** plus JPY (0 decimals), KWD (3), CLF (4),
  inclusive pricing, mixed taxability, big quantities, negative credit notes, a
  business switching GST mid-year, and a credit note against a pre-switch
  invoice.

#### Fixed during this phase

Found by the tests, all corrected:

- Document discount was subtracted twice in the total, halving the effect of
  every document-level discount.
- The document tax ignored the chosen rounding method, re-rounding the unrounded
  sum and so quietly undoing the taxable sale rule.
- Amounts were rounded to the currency's decimal places instead of to whole minor
  units, leaving values in cents with a fraction and breaking the integer
  invariant every total depends on.
- `multiply`, `divide` and `convertMoney` scaled already-minor-unit values a
  second time, inflating every result by 100.
- Percentages were treated as fractions, turning a 10% discount into a 1000% one
  and zeroing out every line.
- `{FY}` rendered as `202627` rather than `27`.
- ABNs were grouped 3-4-4 instead of 2-3-3-3.
- A recurring run whose date fell exactly on "today" was never due.
- BSB check digits were validated against a scheme that rejects 062-000, a real
  and widely published BSB. Only the shape is enforced now, with the reason
  recorded in the code.

---

### Phase 4 — Document editor and lifecycle

Status: **complete**.

Most of this phase is already in the tree and works: the header form, the line grid
with every line type and catalogue autocomplete, drag-to-reorder, sections, autosave
at every keystroke with bounded undo, the totals panel, and a submit dialog that
reserves the number inside a transaction, freezes the tax snapshot and files the PDF.
That is the hard half, and it is done.

What is missing is the part where the editor stops being one document at a time.
Every one of the following is a plan item that has no reachable UI:

- **Bulk actions are theatre.** Finalise, Email and Void open a confirmation dialog
  whose confirm handler closes the dialog and does nothing. Export has no handler at
  all. The plan lists them, and the automation table says "Bulk actions | Finalise,
  email, export, mark paid, or re-file many documents at once".
- **No preset can be chosen.** `contentPresets` are seeded and `applyPreset` exists,
  but nothing lists them. The phase's own acceptance gate is "a 10-line invoice
  _using a preset_ can be created and finalised in under 60 seconds", so this is
  required by the gate, not optional.
- **No attachments.** Plan item 3 says "Totals panel, notes, terms, attachments".
- **No button for quote → invoice or credit note.** Both flows exist and work, but
  only as URL parameters nothing generates.
- **No progress invoicing.** `buildProgressInvoice` is written and tested by nobody;
  there is no dialog to choose a percentage or pick lines.
- **No client credit on the editor.** An overpayment correctly becomes credit, and
  nothing ever spends it.
- **The deposit does not finish.** Ticking "received" records an amount but never
  moves the balance or the due date, so the invoice still asks for the full total.
- **No unsaved-changes guard**, which plan item 4 asks for by name.
- **Payments can be recorded and deleted, not edited.**

#### Plan

Ordered by the plan's own list, then by what unblocks the gate.

**1. Presets in the editor** (gate requirement). A preset picker in the action bar,
applying the preset's client, lines, notes, terms and template through the existing
`applyPreset`. "New from preset" only — "Save as preset" is Phase 5 item 6, beside
the template studio.

**2. Bulk actions that act.** One function per action, run over the selection, each
reporting what it did and what it skipped and why. Finalise reuses the submit path
rather than duplicating it, so a bulk finalise cannot disagree with a single one
about tax snapshots or number reservation. Mark paid sets status without inventing a
payment row, because the date and method of a payment nobody made is not something
to guess.

**3. Quote → invoice and credit note.** Buttons where they belong: on an accepted or
sent quote, and on an invoice with a balance. Both already work behind URL
parameters; this gives them a door.

**4. Progress invoicing.** A dialog from an accepted quote: invoice the remainder, a
percentage, or hand-picked lines, showing quoted versus already invoiced and warning
past 100%. `buildProgressInvoice` already returns that warning; this is the screen.

**5. Client credit.** The client's unapplied credit shown on a new invoice with a
"apply" action that sets `clientCreditApplied` and feeds the balance, which the
calculation engine already subtracts.

**6. Deposits that finish.** Recording a deposit payment moves the balance due date
to the deposit's terms from the payment date, per the existing
`depositBalanceDueDate`, and the header shows the reduced balance.

**7. Attachments.** Add a file, list them, remove one, and mark it "append to the
PDF" or "email attachment", which is what the plan's two destinations are.

**8. Editing a payment**, since a wrong payment is more likely than a wrong invoice.

**9. Unsaved-changes guard.** A route-change prompt while edits are pending. The
autosave means the window is small, which is the point.

**Acceptance.** "A 10-line invoice using a preset can be created and finalised in
under 60 seconds; finalised invoices cannot be edited." Both halves driven in a
real browser: start from a preset, finalise it, then try to change the locked
document and prove the editor refuses. The 60 seconds is a wall-clock budget in the
browser check, because an acceptance gate nobody times is a wish.

#### Outcome

Status: **complete**. The plan's gate passes: "a 10-line invoice using a preset can
be created and finalised in under 60 seconds; finalised invoices cannot be edited."

Driven in a real browser by `npm run verify:editor`, which installs a ten-line
preset, picks a client, applies it, submits, and then checks the document is locked —
asserting not just that a label says so but that **zero** editable controls remain and
the document cannot be submitted again. 346 unit tests and 56 browser checks across
the three suites.

Finalising a ten-line invoice from a preset takes about three seconds in a real
browser, so the budget is met with a wide margin. Getting there required fixing the
single most serious bug in the project so far, below.

#### Added

- **One finalise path.** `lib/finalise.ts` does what submitting does — reserve the
  number, freeze the tax snapshot, save, write the PDF, write the audit entry — and
  both the submit dialog and the bulk action call it. A bulk-finalised document is
  therefore the same kind of document as a single-finalised one, which is the only way
  that guarantee survives twenty invoices at once.
- **Bulk actions that act.** Finalise, mark paid, re-file PDFs, export PDFs and void,
  each reporting what it did and naming every document it skipped with the reason.
  Sequential on purpose: one failure half way through leaves the first half done
  rather than nothing.
  - "Mark paid" deliberately records **no payment row**. It sets the status and clears
    the balance, and says so in the confirmation. Inventing a payment with today's
    date would put a false entry in the audit trail and in the client's payment
    history, and the date and method of money that arrived are facts only the user
    knows.
- **A preset picker.** The gate requires an invoice to be creatable "using a preset"
  and nothing could list them. Presets add their lines rather than replacing them, and
  say so first if the draft already has lines.
  - Preset lines are given fresh ids, and the old-to-new map repoints `sectionId` and
    `appliesToSectionId`. Without that a preset containing a section comes back with
    lines pointing at an id that no longer exists, and a section discount silently
    stops applying.
  - A price saved in one currency means something different in another, so a preset
    line that names a catalogue item takes that item's price for the new document's
    currency rather than carrying the number across.
- **Buttons for what a document can become.** Quote → invoice, progress invoice, and
  credit note. All three flows already worked behind URL parameters; this gives them
  a door, and a quote that has been converted now offers a link to the invoice rather
  than a second conversion.
- **Progress invoicing.** Invoice the remainder, a percentage, or hand-picked lines,
  showing quoted against already invoiced and warning past 100%. The arithmetic was
  already written; this is the screen, and it shows the total each choice would
  produce before anything is written.
- **Client credit, spent.** Overpayments already became credit; nothing ever spent it.
  The editor now reads the client's unapplied credit and offers to take it off a
  draft, capped at the invoice total so nothing goes negative. Drafts only — a
  finalised balance is a fact the client has already been told.
- **Attachments.** Add a file, remove one, and choose per attachment whether it is
  appended to the PDF or sent with the email, which is the plan's two destinations.
  Files are stored on the record so they travel inside a backup.
- **Payments can be corrected.** "Correct" pre-fills the form and writes a
  replacement, removing the original only once the new one exists. A payment is a
  record, so editing one in place would leave the audit trail showing a payment
  nobody made.
- **The unsaved-changes guard**, using React Router's blocker rather than a
  hand-rolled listener: a dialog offers to save and leave, or stay. Pending edits are
  also flushed on unmount, so leaving is never lossy in the first place.
- **10 tests for number reservation**, which had none: consecutive numbers, twenty
  concurrent calls yielding twenty distinct numbers, counters kept separate per
  document type and per business, the yearly reset, `resetRule: never`, the record of
  issued numbers, and a custom pattern.

#### Fixed during this phase

- **Finalising any document threw.** `reserveDocumentNumber` queries the compound
  index `[profileId+documentType]`, and that index was never declared in the schema —
  the store declared only the four single-field ones. Every attempt to submit an
  invoice therefore failed with a Dexie "KeyPath … is not indexed" error, and the
  number-reservation guarantee the plan calls "the one data bug an accounting package
  cannot have" had never actually run. Schema v3 declares it. Nothing in the test suite
  or either existing browser check had finalised a document, which is how it survived
  two completed phases.
- **A preset without `lines` blanked the whole editor.** Preset rows are read raw from
  storage, and an imported row is not guaranteed every field the schema would fill in.
  One missing array turned the page white. The picker now reads it defensively.
- **The bulk bar was theatre.** Finalise, Email and Void each opened a confirmation
  whose confirm handler closed the dialog and did nothing; Export had no handler at
  all. Somebody reading the button bar had every reason to believe these worked.
- **"Total price includes GST" was permitted on any inclusive invoice.** The submit
  dialog built its snapshot by hand and set the allowance whenever pricing was
  inclusive. The ATO permits that statement only when the rate is exactly one
  eleventh. Building the snapshot through `buildTaxSnapshot` applies the real rule, and
  the financial year in the snapshot now honours the configured start month instead of
  assuming July.

#### Notes

- Deposits were **not** a gap: recording a deposit payment already moved the balance due
  date to the deposit's terms from the payment date, and that path was correct. The
  plan looked unbuilt and was not.
- "Save as preset" was the half of the preset story missing from Phase 4,
  because the plan groups it beside the template studio. It now exists: the
  editor can save the open invoice as a named preset, and "new from preset"
  already lists any name it is given. Phase 4 is complete enough to build on.

---

### Phase 4R — Audit remediation (lifecycle, credit notes, compliance, GST)

Status: **complete**. All six priority findings from the Phase 0–4 audit are fixed
and covered by tests.

#### Added

- **Single lifecycle-status helper**, `deriveDocumentStatus`, and its boolean
  `isOpenDocument`. Replaced the three inconsistent status writes in the payment
  panel, the overdue scheduler and the bulk action with one function that derives
  the status from `document.totals`, `clientCreditAvailable` and today's date in
  the business time zone. 13 unit tests.
- **Credit-note linkage at finalise**. `finaliseDocument` now calls
  `applyCreditToLinkedInvoices`, which walks every issued sibling invoice, sums
  the credit notes linked to it, and recomputes each invoice's cached balance so
  the balance field agrees with the payment total plus the credit total.
- **ATO buyer-identity threshold scaled by currency**. The rule is "$1,000" and
  $1,000 is a different amount in every currency. The fixed minor-unit constant
  was replaced with `buyerIdentityThreshold(currency)`, which converts the major-
  unit 1,000 using the currency's actual decimal places (AUD 100,000, JPY 1,000,
  KWD 1,000,000). 4 unit tests.
- **Inclusive-GST renderer gate**. The PDF renderer now prints "Total price
  includes GST" only when `canUseInclusiveGstStatement(rate)` is true (rate must
  be exactly one eleventh). The renderer model computes
  `inclusiveGstStatementAllowed` from the document's tax snapshot.
- **Quantity limited to four decimal places**. `decimal` and `positiveDecimal`
  in `common.ts` now enforce `MAX_DECIMALS = 4` in the regex, so a hand-edited
  import cannot put a number the editor could never have produced into the
  calculation engine. 2 unit tests.
- **Quote → invoice writes `convertedToDocumentId` and marks the quote
  accepted**. `convertQuoteToInvoice` now returns `{ document, lines,
updatedQuote }`, and the editor saves both the new invoice and the updated
  quote, linking them from both ends. The quote can no longer be converted a
  second time by accident.
- **Compliance checker test coverage**. `src/core/validation/compliance.test.ts`
  exercises all seven below-$1,000 required details, the scaled buyer-identity
  threshold (including the JPY/KWD discrimination cases), the mixed-sales
  marker rule (which was unreachable before the fix), the inclusive-GST rate
  restriction, and the unregistered-business note.

#### Fixed during this phase

- **Three status writes, three different answers.** Payment panel, overdue
  scheduler, and bulk action each derived status differently. One helper fixes
  all three and adds the missing `partially_paid` state for invoices that have
  some payment but not the full balance.
- **Credit notes never reduced the linked invoice's balance.** The invoice's
  cached `totals.balance` stayed at the pre-credit amount even after a linked
  credit note was finalised. The new helper recomputes the balance from the
  payment sum plus the linked-credit sum.
- **Buyer-identity threshold applied the AUD constant to every currency.** A
  ¥1,500 invoice was incorrectly below threshold; now it correctly exceeds the
  ¥1,000 threshold.
- **The mixed-sales marker check was unreachable.** It lived inside the
  "GST charged is zero" branch, but mixed taxable + non-taxable sales means
  GST is non-zero, so the check could only fire for an all-zero-rated document
  where its own message ("mixed taxable and non-taxable sales") was nonsense.
  Hoisted it to run whenever `result.hasAnyTaxable && untaxed.length > 0`.
- **Compliance check reads the template to decide whether the marker is
  printed.** Without it, the check nags every mixed invoice even when the
  template already prints the key. `runComplianceChecks` now accepts an optional
  `template` and checks `template?.extras.taxMarkerKey !== true`.
- **Inclusive-GST statement printed on any inclusive invoice.** The submit
  dialog built its snapshot by hand and set the allowance whenever pricing was
  inclusive. The snapshot is now built through `buildTaxSnapshot`, which
  applies the real rate check (one eleventh only), and the renderer model
  mirrors the same gate.
- **Dashboard saved-view links used the wrong id format.** `?view=outstanding`
  now reads `?view=view_outstanding`, so the dashboard's outstanding, overdue,
  paid and drafts drill-downs land on the right filtered list.
- **The sidebar's collapsed state made re-expansion impossible.** When
  collapsed, only the brand mark was visible and the expand control was hidden
  inside the expanded-only branch. An expand icon now sits beneath the brand
  mark in collapsed mode.
- **Documents list Delete menu item was dead.** It now calls
  `removeDocument`, soft-deleting the draft. Finalised documents are refused
  with a note to void instead.
- **Clients Import button showed a dead-end toast.** It now opens the real
  `CsvImportDialog` with client-entity mapping.
- **Sidebar and command-palette links to future screens 404'd.** `/recurring`,
  `/reports` and `/automation-log` no longer appear in the sidebar or palette;
  `/templates` is real now and kept there.
- **Settings command targets pointed at non-existent sections.** Fixed to the
  real ids: `/settings/businesses`, `/settings/tax-codes`, `/settings/data`,
  and removed automation/money/email placeholders that had no matching tab.
- **The PDF-append toggle on attachments did nothing.** The checkbox is now
  disabled with a tooltip naming Phase 5, so the control no longer pretends to
  work.
- **Client standing discount was never applied.** `createDocument` now reads
  `client.defaultDiscountPercent` and, when non-zero, inserts a standing-discount
  line so the editor, PDF and calculation all see the same number.
- **Quote → invoice conversion left the quote untouched.** The quote now
  receives `convertedToDocumentId` and status `accepted`, and the editor saves
  both records plus an audit entry, so a quote can only be converted once.
- **Unused dependencies removed.** `@tanstack/react-table`,
  `class-variance-authority`, `dexie-react-hooks`, `docx`, `exceljs`, `fflate`,
  `qrcode` and `recharts` were installed but never imported. `@dnd-kit/*` is
  retained for the upcoming drag-to-reorder fix.
- **The offline verifier now checks every sidebar nav link returns a real
  route**, rather than only the Invoices shortcut, so a dead link cannot
  slip in unnoticed again.

#### Notes

- Deposits were **not** a gap: recording a deposit payment already moved the balance due
  date to the deposit's terms from the payment date, and that path was correct. The
  plan looked unbuilt and was not.
- "Save as preset" is implemented now: an action in the editor turns the open
  invoice into a reusable `ContentPreset` with the same lines, template, terms,
  and currency. The picker does not change — "new from preset" already reads
  the saved record.
- The label-language default and shipping address live on the client and flow
  through to new documents via `createDocument`. No per-document override UI
  yet — add it in Phase 5 when the PDF renderer gets template-level controls.
- Drag-to-reorder in the line grid works now. Rows are draggable by their left
  grip cell and `moveLineTo` renumbers positions, so a reorder is a real
  reorder rather than a re-indexed copy. Covered by two `moveLine` unit tests.

---

### Partly built at the time (historical inventory)

Work already in the tree ahead of its phase, so later phases can be finished
rather than started. Each is listed here because it is not yet a complete
feature.

#### Storage and platform (Phases 1 and 6)

Finished in Phase 1; kept here because the file adapter and mail adapter still have
Phase 6 screens to build.

- **`StorageAdapter` with a Dexie implementation** over 32 IndexedDB tables, with
  indexed lookups for every hot query. Number reservation happens inside a Dexie
  transaction, so two invoices submitted in the same tick are serialised and can
  never share a number.
- Every write validates through its Zod schema, so a partial record gets its
  defaults and a malformed one is rejected before it can reach disk.
- JSON export and import of the whole database, with a backup taken automatically
  before an import. This is also the migration path to the desktop SQLite build.
- **`FileAdapter`, `MailAdapter` and `SecretAdapter` for the web.** The mail
  adapter's fallback is the documented primary path on the web: save the PDF,
  copy the merged subject and body to the clipboard, open the user's mail app.
  The secret adapter holds passwords in session memory and reports
  `isPersistent: false`, so the UI says plainly that the password will need
  typing again rather than pretending it was saved.
- **Seed data** with stable readable ids — `tpl_studio`, `emt_send`, `tax_gst` —
  because every profile, document and template references these by id and changing
  one would orphan every record pointing at it. Six design templates (Studio,
  Classic, Modern, plus Minimal, Letterhead and Compact configured but not yet in
  the v1 priority order), eight email templates, eight label sets in four
  languages, built-in rules, reminder and late-fee policies, saved views, content
  presets, indicative exchange rates and a starter item catalogue.
- **Capability reporting**, so a screen can hide a feature the current build
  cannot do — Safari has no File System Access API, so the prototype is built for
  Chrome and Edge and says so rather than failing quietly.

#### Documents and screens (Phases 2, 4, 5, 7)

- **Document editor** — split view with a debounced live PDF preview, a
  keyboard-first line grid covering every line type, catalogue autocomplete,
  section and note lines, discount and surcharge lines, autosave at every
  keystroke with bounded undo, and a totals panel whose figures all come from the
  calculation engine.
- **Submit dialog** — compliance checks, the number about to be reserved, the path
  the PDF will land in, and the tax snapshot freeze, in that order.
- **Payments** with automatic status changes, deposit handling, and an
  overpayment becoming client credit rather than disappearing.
- **PDF renderer** with three layouts, repeated table headers, tax markers and a
  key, stamps, and deterministic output from a single view model.
- **Quote acceptance** in the editor: an Accept action on a quote records the
  signer's name/title/date and a typed signature by default, but the dialog now
  also offers a drawn signature canvas and a signed-PDF attachment. The
  drawn image or an em-dash placeholder prints under the table on the quote;
  the uploaded PDF is saved as a document attachment. The remaining gap is the
  plan's "email their signed copy" step, which wants Phase 6 email.
- **Extra template blocks** now render: a payment QR, job photos, and customer
  custom-field slots are all gated by the template's extras toggles. The
  Studio's Payment QR / Photo grid / Custom-field slots checkboxes are now on
  by default-able, and the PDF's payment block prints the real BSB / account /
  PayID rather than only contact email/phone.
- **Phase 5 acceptance gate is a real browser check now.** The hidden
  `/acceptance` page runs all three acceptance criteria: all six built-in
  templates pass the compliance checker with the same sample invoice,
  `DocumentPdf` is rendered twice and compared, and a 60-line invoice is
  rendered to confirm it paginates (the fixed table header repeats on every
  page). `verify:offline` asserts all three, and `creationDate` is pinned to
  the document's issue date so the renderer is byte-for-byte deterministic
  instead of stamping "now".
- **The PDF data URL is a real base64 PDF.** `renderDocumentPdfDataUrl` used
  react-pdf's deprecated and buggy `toString()`, which emits raw PDF text
  rather than base64; it now renders to a blob and reads it as a data URL.
- **Template studio is complete.** The missing knobs from the plan are in:
  table-column visibility (with a one-column floor so a template can never go
  empty), every printed label is renameable (the language-set mechanism), and
  templates can be imported from an exported `.dulytemplate.json` file.
- **Template library and studio** at `/templates` and `/templates/:templateId`:
  list, duplicate, delete custom templates, export a template file, and edit
  colours, fonts, header/footer, page size, and tax-marker key with a live PDF
  preview rendered from the same model + renderer as the editor. Built-in
  templates cannot be deleted but can be duplicated and edited.
- **Documents list** with composable filters held in the URL, saved views, and a
  bulk-action bar.
- **Dashboard** with six tiles, aged receivables, and the overdue, draft, reminder,
  recurring and activity lists.
- **Clients list and editor**, with live ABN checksum validation and the
  client-defaults block that makes every later invoice start correct.
- **Scheduler** running on start and every 15 minutes, with the automation log
  explaining every action it took.

---

## Phase status

| Phase | Scope                                                         | Status       |
| ----- | ------------------------------------------------------------- | ------------ |
| 0     | Foundations, design system, app shell, offline PWA            | **Complete** |
| 1     | Data layer, seed data, setup wizard, settings                 | **Complete** |
| 2     | Clients, contacts, ABN validation, item catalogue, CSV import | **Complete** |
| 3     | Calculation engine and unit tests                             | **Complete** |
| 4     | Document editor and lifecycle                                 | **Complete** |
| 4R    | Audit remediation (lifecycle, credit notes, compliance, GST)  | **Complete** |
| 5     | PDF renderer, templates, template studio                      | **Complete** |
| 6     | Output: files, exports, email                                 | **Complete** |
| 7     | Automation, dashboard, reports                                | **Complete** |
| 7B    | Time tracking, expenses, retainers, extra document types      | **Complete** |
| 8     | Desktop apps (Tauri)                                          | **Complete** |
| 9     | Android                                                       | **Complete** |
| 10    | Duly Assist (optional AI)                                     | **Complete** |

Every phase in the plan is complete. The README's Status table is the
canonical view; this file is the record of how each phase got there.

---

## Licence note

Every dependency is MIT, Apache-2.0 or OFL. No paid APIs, no cloud database, no
telemetry. Bundled fonts ship inside the app so PDFs render identically offline.
