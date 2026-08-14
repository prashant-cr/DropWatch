# Contributing to DropWatch

Thanks for taking a look. DropWatch aims to stay small and easy to run — the bar for
a new dependency is high, and the bar for a new concept is higher.

## Dev setup

```bash
git clone https://github.com/prashant-cr/DropWatch.git
cd DropWatch
npm install          # also downloads Chromium
npm run dev
```

`npm run dev` starts the API on `:3070` and the Vite dev server on `:5173`, both with
hot reload. Open <http://localhost:5173>.

Before opening a PR:

```bash
npm run lint
npm run typecheck
npm test
```

CI runs exactly these, plus a production build.

## Code layout

```
src/
  server/
    index.ts          Fastify bootstrap; serves the API and the built UI
    routes/           REST endpoints
    db/               schema.sql + typed query helpers (plain SQL, no ORM)
    services/         detect + dashboard view-model assembly
  core/
    scheduler.ts      cron registration; re-registers on every watch change
    checker.ts        one check: scrape -> extract -> record -> compare -> alert
    trigger.ts        pure edge-trigger logic (heavily tested)
    cron.ts           small cron parser: next-run times + the 15-minute floor
    scraper/
      fetch.ts        Playwright fetch, retries, per-domain rate limiting
      extract.ts      pure extraction strategies
    channels/
      types.ts        the AlertChannel interface
      email.ts        the default channel
  shared/             types and formatters used by both server and UI
  web/                React app (Vite + Tailwind)
tests/                Vitest; HTML fixtures in tests/fixtures/
```

Conventions:

- TypeScript strict mode. No `any` in `src/core/`.
- Plain SQL through typed helpers. No ORM.
- Every check is wrapped: a failing site records an error row and never takes down the
  scheduler loop.
- The API is boring REST + JSON. The UI polls; no websockets.
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Adding an alert channel

This is the most useful contribution and it is genuinely small. Channels implement one
interface, and nothing outside `src/core/channels/` needs to change.

**1. Write the channel** — `src/core/channels/telegram.ts`:

```ts
import type { AlertChannel } from './types.js';

export interface TelegramDeps {
  getSettings: () => { telegram_bot_token: string; telegram_chat_id: string };
}

export function createTelegramChannel(deps: TelegramDeps): AlertChannel {
  return {
    id: 'telegram',
    label: 'Telegram',

    isConfigured() {
      const { telegram_bot_token, telegram_chat_id } = deps.getSettings();
      return telegram_bot_token.trim() !== '' && telegram_chat_id.trim() !== '';
    },

    async send(alert) {
      const { telegram_bot_token, telegram_chat_id } = deps.getSettings();
      const response = await fetch(
        `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram_chat_id,
            text: `*${alert.subject}*\n\n${alert.body}\n\n${alert.url}`,
            parse_mode: 'Markdown',
          }),
        },
      );
      if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
    },
  };
}
```

**2. Add its settings keys** to `defaultSettings()` in `src/server/db/settings.ts`, and
to `AppSettings` in `src/shared/types.ts`. Settings are a key/value table, so no
migration is needed.

**3. Register it** in `src/server/index.ts`, next to the email channel:

```ts
registerChannel(createTelegramChannel({ getSettings }));
```

**4. Add a section to the Settings page** in `src/web/pages/Settings.tsx`, mirroring
the email card.

That is the whole job. `dispatchAlert` sends on every configured channel, and one
channel failing never blocks the others.

Channels we would like: **Telegram**, **Discord webhook**, **Slack webhook**, **ntfy**.

## Adding an extraction strategy

Each strategy in `src/core/scraper/extract.ts` is a pure function
`(snapshot) => ExtractResult | null` over the rendered HTML — no browser, no network.
Add yours to the `STRATEGIES` array in priority order (structured data before
heuristics), save a real page in `tests/fixtures/`, and add a case to
`tests/extract.test.ts`.

If a strategy throws, `extract()` catches it and moves on, so be defensive but do not
be paranoid.

## What will not be merged

DropWatch does not try to defeat sites that block it. Pull requests adding CAPTCHA
solving, Cloudflare or anti-bot bypass, browser-fingerprint spoofing, proxy rotation
for ban evasion, or anything else whose purpose is getting around a site's access
controls will be declined. This is not negotiable, and it is not a comment on your
code.

Also unlikely to land: heavy new dependencies, an ORM, a queue or Redis, a
multi-tenant/auth system (a simple optional password is fine), and check intervals
below 15 minutes.

## Reporting a scraping bug

Please include the product URL and the relevant rows from the watch's check log
(**History**, or the watch detail page). If detection picked the wrong number, say
which number it should have picked.
