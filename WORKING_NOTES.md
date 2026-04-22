# Spendio — Working Notes

A developer-facing journal for Spendio. `README.md` stays the "what this
project is" doc; this file is the "where we actually are, what's in
flight, and what to watch out for" doc. Keep it short and keep it
current.

Last updated: 2026-04-22

---

## Current state

### Pages (all four live)

| Page               | File                 | Script                  | Status   |
| ------------------ | -------------------- | ----------------------- | -------- |
| Dashboard          | `index.html`         | `js/dashboard.js`       | Working  |
| Upload statement   | `upload.html`        | `js/upload.js`          | Working  |
| Add expense        | `manual-entry.html`  | `js/manual-entry.js`    | Working  |
| Spending history   | `history.html`       | `js/history.js`         | Working  |

All four pages share the same shell (sidebar + topbar) and design
tokens in `css/styles.css`. The shell was recently trimmed — the old
"Account / Categories / Settings" sidebar group and the
"Messages / Notifications / Student chip" topbar group have been
removed on every page. `history.html` keeps its month-selector in the
topbar because it's functional.

### Backend

- Single Supabase table: `public.transactions` (see `db/schema.sql`).
- RLS is permissive (anon read + insert) on purpose — the app is
  single-user for now. Tighten RLS before inviting other users.
- No build step. The app loads `@supabase/supabase-js` from esm.sh,
  D3 v7 from jsdelivr, and pdf.js v3.11 lazily on first PDF upload.

### Deploy

- Configured for Azure Static Web Apps via `staticwebapp.config.json`.
- HTML is served with `no-cache`; `/css` and `/js` are cached for a
  year with `immutable`. Bump filenames or query-string them if you
  ever need to cache-bust.

---

## Recent changes

- **PDF year detection (`js/pdf-parser.js`)** — Statements that print
  transactions as bare `MM/DD` were being stamped with whatever `20YY`
  appeared first on the page (often a copyright footer or
  "member since" year). Added `findStatementPeriod()` which looks for
  the real statement window and `pickYearFromPeriod()` which assigns
  the correct year per row. Handles Dec → Jan wrap-around. See the
  header comment in `pdf-parser.js` for the full list of patterns it
  recognizes.
- **Shell cleanup** — removed the placeholder Account / Settings
  sidebar items and Messages / Notifications / user-chip from the
  topbar on every page. `history.html` keeps the month-selector.
- **WCAG 2.1 AA pass** — darkened four design tokens so every
  text/background pair clears its required contrast ratio, plus
  switched the hero chart axis text to solid white. Token changes
  (all verified with the sRGB relative-luminance formula):
  - `--color-text-subtle` `#8a93a4` → `#6b7383` (4.77:1 on white)
  - `--color-hero-bg` `#2ea089` → `#157a66` (5.24:1 vs white text)
  - `--color-border-strong` `#d4d8e1` → `#8b93a3` (3.09:1, form borders)
  - New `--color-hero-overlay: rgba(0,0,0,0.22)` for the hero pills
    (7.55:1 with white text)

---

## Known issues / things to watch

- **PDF parsing is heuristic, not bullet-proof.** We use pdf.js to
  pull visible text and a regex to find `date … amount`. If a bank
  uses a wildly non-standard layout the parser will just skip rows
  (safer than producing wrong ones). The user can always fall back to
  CSV.
- **Scanned / image-only PDFs** are not supported. We don't OCR. The
  upload page surfaces a specific error for this.
- **`source` column not populated on insert.** `db/schema.sql` has a
  `source text check (source in ('manual', 'upload'))` column, but
  `js/supabase-client.js` doesn't send it. Either drop the column from
  the schema or start sending it — right now inserts work only because
  the column is nullable (there's no `not null`). Worth deciding soon.
- **No delete / edit.** You can only add or import. No way to remove a
  row once it's saved. This is deliberate for v1 but eventually the
  History table should have a remove button.
- **Currency is hard-coded to USD** (`formatCurrency` in
  `supabase-client.js`, "Amount (USD)" label in `manual-entry.html`,
  `$` on chart axes). Internationalization is out of scope for now.
- **Empty `<select id="month-select">` on history page** — populated
  on load by `history.js`. Fine in all modern browsers but any future
  server-side rendering should seed at least a placeholder option.

---

## TODO (roughly prioritized)

1. Decide on `source` column — either populate it from `upload.js` /
   `manual-entry.js` or remove it from the schema.
2. Delete-row affordance in `history.html`'s data tables.
3. Budget per category + "over budget" indicator on the dashboard.
4. Export: let the user download their full history as CSV.
5. Replace the global "Student" placeholder user with real auth once
   we go multi-user — at that point RLS in `db/schema.sql` needs
   `auth.uid()` checks and the `transactions` table needs a `user_id`
   column.
6. Currency / locale config (probably via `window.SPENDIO_CONFIG`).

---

## Dev tips / gotchas

- **Serve over HTTP, not `file://`.** ES modules won't import from a
  `file://` URL. Quick options:
  ```bash
  python3 -m http.server 5173
  # or
  npx serve .
  ```
- **Supabase not configured?** Every page shows a yellow "Supabase is
  not configured" message and disables saves. Fill in the constants
  at the top of `js/supabase-client.js` or set
  `window.SPENDIO_CONFIG` in an inline script before the module
  scripts load.
- **Design tokens are the source of truth.** All colors, spacing,
  radii, shadows, and layout dims live as CSS custom properties in
  `:root` in `css/styles.css`. D3 charts resolve these at runtime via
  `resolveColor()` in `charts.js`, so changing a token updates the
  charts too.
- **Charts resize themselves.** Every chart uses a `viewBox` +
  `ResizeObserver` (see `attachResponsive()` in `charts.js`). Don't
  set explicit width/height attributes on the generated SVGs.
- **Accessibility checks** — before shipping visual changes run
  axe DevTools or Lighthouse against each page. The contrast budget
  is tight in a couple of spots (subtle text, hero pills); any color
  edits there need re-verification.
- **PDF.js worker.** `pdf-parser.js` sets `workerSrc` to the matching
  `pdf.worker.min.js` on the CDN. If you upgrade the `PDFJS_VERSION`
  constant, make sure the worker URL stays in sync — mismatched
  versions produce confusing runtime errors.

---

## Validation targets (keep green)

- HTML5 — <https://validator.w3.org/nu/>
- CSS3 — <https://jigsaw.w3.org/css-validator/>
- WCAG 2.1 AA — axe DevTools or Lighthouse; targets on file:
  - Text contrast ≥ 4.5:1 (normal) / 3:1 (large)
  - Non-text contrast ≥ 3:1 (form borders, focus rings, icons)
  - Every interactive element has a visible focus indicator
  - Every form control has a programmatic label
  - Every chart slice/bar/point is keyboard-focusable with an
    `aria-label` that announces the value
