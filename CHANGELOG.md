# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Setup** — `npx pricewatch` with automatic Chromium install, and a Docker image with
  Chromium bundled.

### Security

- Binds to `127.0.0.1` by default; the container opts into `0.0.0.0` explicitly.
- The SMTP password is never returned to the browser.

### Notes

- PriceWatch detects when a site blocks automated checking and reports it, by design.
  It contains no CAPTCHA solving, anti-bot bypass, fingerprint spoofing or proxy
  rotation, and will not accept contributions adding them.
- The minimum check interval is 15 minutes, enforced for preset and custom schedules
  alike.

[unreleased]: https://github.com/prashant-cr/PriceWatch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/prashant-cr/PriceWatch/releases/tag/v0.1.0
