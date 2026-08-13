# CLAUDE.md — PriceWatch

Open-source, self-hosted price & availability watcher. Users add product URLs in a web UI, set a target price (or "notify when back in stock"), and PriceWatch checks on a schedule and sends alerts — email by default, other channels pluggable.

**Design goals, in priority order: dead-simple setup → reliable checking → beautiful UI → extensibility.**

---

## Product Overview

### What the user experiences

1. Run one command (`npx pricewatch` or `docker compose up`).
2. Open `http://localhost:3070`. No signup, no cloud account.
3. Paste a product URL → PriceWatch auto-detects the price and product name → user sets a target price or picks "alert when in stock" → picks a check frequency.
4. A dashboard shows every watched item: current price, price history sparkline, last checked, next check, status (OK / below target / out of stock / check failed).
5. When a condition triggers (price ≤ target, or item back in stock), an email is sent. Each trigger fires once until the condition resets (no alert spam).

### Core features (MVP — build these first)

- **Watch management UI**: add / edit / pause / delete watches. Fields: URL, label (auto-filled from page title), target price OR availability mode, check interval.
- **Auto price detection**: on add, fetch the page and detect price via (in order): JSON-LD `Product`/`Offer` schema → OpenGraph/meta tags → common price selectors → largest currency-formatted number near the top of page. Show the detected price for user confirmation; let the user paste a CSS selector as manual override if detection fails.
- **Scheduler**: per-watch interval (15m / 1h / 6h / 24h presets + custom cron). Schedules must be **visible**: dashboard shows "last checked X ago · next check in Y". A history page shows a log of every check (timestamp, price found, duration, success/failure).
- **Email alerts** (default channel): via SMTP settings the user enters in the UI Settings page. Provide presets for Gmail app-passwords and Resend. Send a test-email button.
- **Price history**: store every check; render a line chart per item (last 30/90 days).
- **Settings page**: email config, default check interval, timezone, currency display.

### Post-MVP (structure code for these, don't build yet)

- Additional alert channels: Telegram, Discord webhook, Slack webhook, ntfy. Implement channels behind a single `AlertChannel` interface (`send(alert): Promise<void>`), registered in `src/channels/`. Email is just the first implementation.
- CSV import of URLs.
- Multi-currency conversion.
- Browser extension "watch this page" button.

---

## Tech Stack (keep it minimal — do not add heavy dependencies)

| Layer     | Choice                          | Why                                          |
| --------- | ------------------------------- | -------------------------------------------- |
| Runtime   | Node.js 20+, TypeScript         | one language everywhere                      |
| Server    | Fastify                         | small, fast                                  |
| Frontend  | React + Vite + Tailwind CSS     | fast dev, easy for contributors              |
| Charts    | Recharts                        | sparklines + history charts                  |
| DB        | SQLite via `better-sqlite3`     | zero-setup, single file `data/pricewatch.db` |
| Scraping  | Playwright (Chromium, headless) | handles JS-rendered pages                    |
| Scheduler | `node-cron` in-process          | no Redis/queue needed at this scale          |
| Email     | `nodemailer`                    | SMTP-agnostic                                |

No ORM (plain SQL with typed helpers). No auth in MVP (localhost tool) — but structure routes so a simple password can be added later.

---

## Architecture

```
src/
  server/
    index.ts          # Fastify bootstrap, serves API + built frontend
    routes/           # REST: /api/watches, /api/checks, /api/settings, /api/test-email
    db/               # schema.sql, migrations, typed query helpers
  core/
    scheduler.ts      # cron registration; re-registers on watch changes
    checker.ts        # runs one check: scrape -> parse -> compare -> alert -> record
    scraper/
      fetch.ts        # Playwright page fetch with retries/timeouts
      extract.ts      # price/name/availability extraction strategies
    channels/
      types.ts        # AlertChannel interface
      email.ts        # default channel
  web/                # React app (Vite)
    pages/            # Dashboard, WatchDetail, History, Settings
    components/
```

**Data flow**: scheduler fires → `checker.run(watch)` → scraper fetches page → extractor returns `{ price, available, title }` → result stored in `checks` table → trigger logic compares against target & previous state → if newly triggered, dispatch to enabled channels → UI reads from DB via API.

### DB tables

- `watches(id, url, label, selector_override, target_price, mode ['price'|'availability'], interval_cron, currency, is_paused, created_at)`
- `checks(id, watch_id, checked_at, price, available, status ['ok'|'error'], error_message, duration_ms)`
- `alerts(id, watch_id, check_id, channel, sent_at, message)`
- `settings(key, value)` — SMTP config, timezone, etc.

### Trigger logic (important — get this right)

- Price mode: trigger when `price <= target_price` AND previous check was above target (edge-trigger, not level-trigger). Re-arm when price goes back above target.
- Availability mode: trigger on transition `unavailable → available`.
- Never alert on a failed check; after 3 consecutive failures, send ONE "check is failing" email and mark the watch with a warning badge in the UI.

---

## Scraping Rules (read carefully)

Reliability matters, but this is a **respectful scraper**. It must work well on ordinary sites without trying to defeat security controls.

**Do:**

- Use headless Chromium via Playwright with a realistic desktop user agent and viewport.
- Set `Accept-Language` from user's locale; load pages with `waitUntil: 'domcontentloaded'` + wait for price selector with 10s timeout.
- Retry failed checks 2× with exponential backoff (30s, 2m).
- Rate-limit: max 1 concurrent check per domain, minimum 10s gap between requests to the same domain; jitter schedule start times so all watches don't fire at once.
- Block images/fonts/media via route interception to keep checks fast and light.
- Cache the last successful extraction strategy per watch so subsequent checks are cheap.

**Do NOT:**

- Do not implement CAPTCHA solving, Cloudflare/anti-bot bypass, fingerprint spoofing, proxy rotation for ban evasion, or any feature whose purpose is defeating a site's access controls. If a site blocks the checker, surface a clear "This site blocks automated checking" status in the UI and suggest the user check it manually or use the site's official API/price-alert feature. This is a hard project policy — decline contributions that add evasion features.
- Do not hammer sites: minimum allowed interval is 15 minutes.

---

## UI / Design Direction

The UI is a headline feature — it should look like a polished product, not an admin panel.

- **Aesthetic**: clean, modern, generous whitespace. Light + dark mode (system default). One accent color (emerald `#10b981` — price drops are good news). Inter or Geist font.
- **Dashboard**: card grid; each card = product label, favicon of the store, current price large, target price small, 30-day sparkline, status pill, "checked 12m ago · next in 48m". Paused watches are dimmed.
- **Add-watch flow**: single modal — paste URL → live "detecting…" state → shows detected name + price → set target with a slider anchored at current price → done. Should feel magical.
- **Watch detail page**: full price-history chart, check log table, edit controls, "run check now" button.
- **Empty states, loading skeletons, and error states are mandatory** — a new user's first impression is the empty dashboard.
- Mobile-responsive (people will check from phones).
- Toast notifications for actions; confirm dialog only for delete.

---

## Setup Experience (non-negotiable)

- `npx pricewatch` must work: downloads Chromium on first run (with a progress message), creates `./data/`, starts server, prints the URL.
- `docker compose up` alternative with a 10-line compose file; image bundles Chromium.
- First-run onboarding banner in UI: "Set up email alerts →" linking to Settings.
- Zero required config to start; email is the only thing users must configure, and only when they want alerts.

---

## Open Source Polish

- MIT license.
- `README.md` with: hero screenshot, one-line pitch, 30-second quickstart, feature list with GIFs, FAQ ("Why did my check get blocked?" → explains the no-bypass policy), contributing guide link.
- `CONTRIBUTING.md`: dev setup (`npm i && npm run dev`), where channels live, how to add one (with the Telegram channel as a documented example issue).
- GitHub Actions: lint + typecheck + unit tests on PR.
- Conventional commits; keep a CHANGELOG.
- Issue templates: bug report (asks for site URL + check log excerpt), feature request, new-channel request.

---

## Coding Conventions

- TypeScript strict mode; no `any` in `core/`.
- Every scraper extraction strategy is a pure function `(page) => ExtractResult | null` in `extract.ts`, tried in order — easy to unit test with saved HTML fixtures in `tests/fixtures/`.
- Unit tests (Vitest) for: extraction strategies, trigger logic (edge cases: first check, flapping prices, failures), cron re-registration.
- Errors: never crash the scheduler loop; every check is wrapped, failures recorded to DB.
- Keep the API boring: REST + JSON, no websockets in MVP (UI polls `/api/watches` every 30s).

## Commands

```bash
npm run dev        # server + vite dev, hot reload
npm run build      # build frontend + compile server
npm test           # vitest
npm run lint       # eslint + prettier check
```

## Definition of Done for MVP

A stranger can clone the repo, run one command, add an Amazon-alternative store URL (e.g., a Shopify store), see the price auto-detected, set a target, receive a test email, and get a real alert when the price drops — without reading anything beyond the README quickstart.
