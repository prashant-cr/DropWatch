# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependency majors taken:** Tailwind CSS 4, Vite 8 (with `@vitejs/plugin-react` 6),
  Recharts 3, nodemailer 9, TypeScript 6, and the GitHub Actions to v7. No user-facing
  behaviour changes; the UI was rendered and compared before and after.
- Tailwind's theme moved from `tailwind.config.js` into `@theme` in `src/web/styles.css`,
  which is how v4 is configured. `autoprefixer` is gone — v4 prefixes on its own.
- Dropped `baseUrl` from `tsconfig.json`; it is deprecated in TypeScript 6 and removed
  in 7. Path mappings resolve relative to the config file instead.

### Fixed

- **Tests could abort the whole run instead of failing.** better-sqlite3 finalizing a
  database handle on a worker thread races the teardown of that thread's V8
  environment, which kills the worker with `Assertion failed: (env) != nullptr`. It
  was intermittent and showed up first on Node 24. Vitest now runs each test file in
  a forked process, where the native addon's teardown is well defined.

### Notes

- TypeScript 7 is held back: `typescript-eslint` 8.67.0 still requires
  `typescript <6.1.0`, so 6.0.3 is the highest version compatible with typed linting.

## [0.2.0] — 2026-08-14

Published to npm as **`dropwatch`**. The registry rejected `price-watch` as too
similar to an existing package, so the project was renamed rather than shipped under
a scoped name.

### Changed

- **Renamed from PriceWatch to DropWatch.** The command is now `npx dropwatch`,
  environment variables are `DROPWATCH_*`, and the database is `data/dropwatch.db`.
  An existing `pricewatch.db` in the same directory is opened as-is, so upgrading in
  place keeps your watches and history.
- `GET /api/health` reports the real package version instead of a hardcoded string.

### Added

- **History retention.** Checks stay at full resolution for 90 days; older days are
  thinned to their low, high and closing price and older failures are dropped, with a
  nightly job doing the work. Previously every check was kept forever — a single
  watch at the 15-minute minimum writes about 35,000 rows a year. Configurable under
  **Settings → Keep full history for**, including "forever" for anyone who wants the
  old behaviour.
- **Idle browser shutdown.** The shared Chromium closes after ten minutes without a
  check instead of staying resident for the life of the process, which is most of it.
- Route-level tests covering the HTTP layer, and tests for the local-network guard.

### Security

- **The checker no longer visits the local network.** URLs resolving to loopback,
  private, link-local or CGNAT addresses are rejected, including the cloud metadata
  endpoint at `169.254.169.254`. Set `DROPWATCH_ALLOW_PRIVATE_HOSTS=1` to opt back in.
  This validates the URL, not the DNS answer.
- **The database file and its write-ahead log are created `0600`**, so other accounts
  on the machine cannot read the SMTP password stored in it.
- Added [SECURITY.md](SECURITY.md) documenting the threat model and how to report a
  vulnerability.

### Fixed

- **Price detection picked add-on prices instead of the product's own.** Selector
  candidates were ranked partly by document position, on the assumption that the hero
  price comes first. Marketplace pages inject warranty and accessory offers _above_ the
  product price, so the cheapest upsell reliably won — an Amazon listing at ₹14,499 was
  tracked as ₹649. Position ranking is gone, replaced by consensus: candidates are
  grouped by value and the number the most independent elements agree on wins. Real
  pages state their price several times (an off-screen accessibility span, a hidden
  form input, the visible digits split across elements) while a decoy appears once or
  twice, so this generalises across stores instead of encoding any one site's markup.
- **Two adjacent prices could merge into one enormous number.** The number pattern
  allowed whitespace inside a figure, so `"₹649.00 ₹1,349.00"` could parse as a single
  value; one check recorded ₹2,198,900. The pattern is now strict, and spacing that
  genuinely belongs inside a number — a decimal separator split across elements, or
  no-break-space thousands grouping — is repaired beforehand.
- **`&nbsp;` was decoded to a plain space**, erasing the distinction between a
  thousands separator and a gap between two numbers, which broke prices like
  `1&nbsp;299,90`.
- **The last-resort heuristic took the largest number near the top of the page**,
  which is typically a financing total or an unrelated item. It now uses the same
  consensus rule.
- Expanded the disqualifying-token list to cover add-ons, warranties, accessories,
  EMI/instalment figures, trade-in and cashback amounts, and cart totals; hidden
  `<input value>` and `<meta content>` prices are now read directly.

### Added

- A guard against implausible price jumps: a reading 20x away from the last good one
  is recorded as a failed check rather than a price. Failed checks never alert, so a
  single misread cannot send a phantom "price dropped" email or corrupt the history
  chart. It self-heals — after two consecutive rejections the new value is accepted,
  so a genuine repricing is never blocked permanently.

## [0.1.0] — 2026-08-13

First release: the MVP is feature-complete.

### Added

- **Watch management** — add, edit, pause, resume and delete watches via the web UI,
  with price-target or back-in-stock alert modes.
- **Automatic price detection** — JSON-LD `Product`/`Offer`, OpenGraph and
  `product:price` meta tags, microdata, scored common price selectors, and a
  top-of-page heuristic, tried in that order. The winning strategy is cached per watch.
- **CSS selector override** for pages automatic detection cannot read.
- **Scheduler** — per-watch cron with 15m / 1h / 6h / daily presets plus custom
  expressions, jittered start times, and next-run times shown throughout the UI.
- **Edge-triggered alerts** — price alerts fire on the crossing below target and
  re-arm above it; availability alerts fire on the out-of-stock → in-stock transition.
  Failed checks never alert and never re-arm.
- **Email alerts** over SMTP with Gmail and Resend presets and a test-email button,
  behind a pluggable `AlertChannel` interface.
- **Failure handling** — two retries with backoff, then exactly one "check is failing"
  email per outage and a warning badge in the UI.
- **Price history** — every check recorded, sparklines on the dashboard, 30/90-day
  charts on the detail page, and a cross-watch History log.
- **Settings** — SMTP config, default interval, timezone and display currency.
- **Web UI** — card-grid dashboard, single-modal add-watch flow with live detection,
  watch detail page, light/dark mode, empty/loading/error states, toasts, and a mobile
  layout.
- **Setup** — `npx dropwatch` with automatic Chromium install, and a Docker image with
  Chromium bundled.

### Security

- Binds to `127.0.0.1` by default; the container opts into `0.0.0.0` explicitly.
- The SMTP password is never returned to the browser.

### Notes

- DropWatch detects when a site blocks automated checking and reports it, by design.
  It contains no CAPTCHA solving, anti-bot bypass, fingerprint spoofing or proxy
  rotation, and will not accept contributions adding them.
- The minimum check interval is 15 minutes, enforced for preset and custom schedules
  alike.

[unreleased]: https://github.com/prashant-cr/DropWatch/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/prashant-cr/DropWatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prashant-cr/DropWatch/releases/tag/v0.1.0
