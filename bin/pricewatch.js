#!/usr/bin/env node
/**
 * `npx price-watch` entry point.
 *
 * Its whole job is to make the first run work with no setup: check the Node
 * version, make sure Chromium is present (downloading it once, with a visible
 * progress message), then hand over to the server.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`
  price-watch — self-hosted price & availability watcher

  Usage
    npx price-watch [options]

  Options
    -h, --help          Show this message
    -v, --version       Print the version
        --port <n>      Port to listen on (default 3070, or $PORT)
        --host <addr>   Address to bind (default 127.0.0.1, or $HOST)
        --data <dir>    Where to keep the database (default ./data)
        --skip-browser-check
                        Do not verify that Chromium is installed

  Environment
    PORT, HOST, PRICEWATCH_DATA_DIR, LOG_LEVEL

  Once running, open the printed URL. Nothing else needs configuring; add your
  SMTP details in Settings when you want email alerts.
`);
  process.exit(0);
}

const { version } = await readPackageJson();

if (args.has('--version') || args.has('-v')) {
  console.log(version);
  process.exit(0);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`PriceWatch needs Node 20 or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

applyFlagsToEnv();

if (!args.has('--skip-browser-check')) ensureChromium();

const serverEntry = fileURLToPath(new URL('../dist/server/index.js', import.meta.url));
if (!existsSync(serverEntry)) {
  console.error('PriceWatch is not built. Run `npm run build` in the project directory first.');
  process.exit(1);
}

process.env.PRICEWATCH_AUTOSTART = '1';
await import(serverEntry);

// ---------------------------------------------------------------------------

async function readPackageJson() {
  const { readFile } = await import('node:fs/promises');
  const path = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Maps `--port`/`--host`/`--data` onto the env vars the server reads. */
function applyFlagsToEnv() {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const port = valueOf('--port');
  if (port) process.env.PORT = port;

  const host = valueOf('--host');
  if (host) process.env.HOST = host;

  const data = valueOf('--data');
  if (data) process.env.PRICEWATCH_DATA_DIR = data;
}

/**
 * Playwright downloads browsers on install, but that step is skipped often enough
 * (CI caches, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, pnpm setups) that it is worth
 * checking and fixing rather than failing on the first check.
 */
function ensureChromium() {
  try {
    const { chromium } = require('playwright');
    if (existsSync(chromium.executablePath())) return;
  } catch {
    // Fall through to the install below.
  }

  console.log('Downloading Chromium (one time, roughly 150 MB)…');
  const result = spawnSync(process.execPath, [playwrightCli(), 'install', 'chromium'], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(
      '\nCould not install Chromium automatically.\n' +
        'Run `npx playwright install chromium` and start PriceWatch again.',
    );
    process.exit(1);
  }
}

function playwrightCli() {
  return require.resolve('playwright/cli.js');
}
