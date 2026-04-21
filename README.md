# Spendio

A minimal personal spending analysis web app for college students. Log
expenses manually or import a CSV statement, then see where your money
goes through D3-powered charts.

## Tech stack

- Vanilla HTML5, CSS3, JavaScript (ES modules)
- [D3.js v7](https://d3js.org/) for all visualizations (loaded via CDN)
- [Supabase](https://supabase.com/) (PostgreSQL) as the backend, accessed
  via `@supabase/supabase-js` (loaded via esm.sh)
- Deploys as an [Azure Static Web App](https://learn.microsoft.com/azure/static-web-apps/)

## Project structure

```
/spendio
  index.html            Dashboard
  upload.html           Upload bank statement
  manual-entry.html     Manually log an expense
  history.html          Spending history with month selector
  staticwebapp.config.json   Azure SWA routing & cache rules
  /css
    styles.css          Design system and component styles
  /js
    supabase-client.js  Supabase client + query helpers
    charts.js           Reusable D3 chart components
    dashboard.js
    upload.js
    manual-entry.js
    history.js
  /db
    schema.sql          Supabase table + RLS policies
```

## Getting started

### 1. Create the Supabase table

In the [Supabase SQL editor](https://supabase.com/dashboard), run the
contents of `db/schema.sql`. That creates the `transactions` table,
adds indexes, and sets up permissive row-level-security policies
suitable for single-user anonymous use.

### 2. Configure credentials

Open `js/supabase-client.js` and replace the placeholder constants:

```js
const DEFAULT_SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

Alternatively, add a small inline script to each HTML file **before** the
module scripts load:

```html
<script>
  window.SPENDIO_CONFIG = {
    supabaseUrl: "https://YOUR-PROJECT.supabase.co",
    supabaseAnonKey: "eyJhbGciOi...",
  };
</script>
```

### 3. Run locally

Because the app uses ES modules, open it through a simple HTTP server
(file:// URLs won't work for module imports):

```bash
# Any static server works. Examples:
python3 -m http.server 5173
# or
npx serve .
```

Then browse to http://localhost:5173/.

### 4. Deploy to Azure Static Web Apps

Create a new Static Web App in the Azure portal and connect it to your
GitHub repository. The defaults work for this project — no build step
is required. The included `staticwebapp.config.json`:

- Rewrites unknown routes to `index.html`.
- Disables caching on HTML files so updates ship immediately.
- Caches `/css` and `/js` aggressively (one year, immutable).
- Sets sensible security headers.

## Features

- **Dashboard** — Summary cards (total, top category, count), bar chart
  of spending by category, line chart of daily totals for the current
  month.
- **Upload** — Parse a CSV statement entirely in the browser, edit each
  row's category, then confirm to save. Forgiving column detection and
  clear errors for unsupported file types (PDF parsing is not
  implemented).
- **Manual Entry** — Validated form to log a single expense, plus a
  scrollable list of this month's manual entries.
- **History** — Prev/next month navigation and a jump-to dropdown, with
  a donut breakdown, line chart, and summary stats (total, avg/day,
  highest day).

## Compliance

- Valid HTML5 and CSS3 (passes the W3C validators).
- WCAG 2.1 AA:
  - Semantic landmarks (`header`, `nav`, `main`, `section`, `article`,
    `footer`) and a visible "skip to main content" link.
  - All form inputs have associated `<label>` elements.
  - Color palette chosen for ≥ 4.5:1 contrast on normal text.
  - Visible focus rings on all interactive elements.
  - Charts expose `role="img"` with descriptive labels; bars/slices are
    keyboard-focusable and announce their value.
  - Respects `prefers-reduced-motion`.

## Code quality

- No inline styles or inline scripts.
- All Supabase calls use `async/await` with `try/catch`.
- D3 charts resize via `ResizeObserver` and SVG `viewBox` scaling.
- CSS uses custom properties for the entire color + spacing system.
