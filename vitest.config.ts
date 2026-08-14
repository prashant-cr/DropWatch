import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@shared': `${srcRoot}/shared` },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],

    // better-sqlite3 is a native addon, and finalizing a Database handle on a
    // worker thread races the teardown of the thread's V8 environment — it
    // aborts the worker with `Assertion failed: (env) != nullptr` rather than
    // failing a test. It is intermittent, and it showed up on Node 24 first.
    // Child processes give each test file its own real process, where the
    // addon's teardown is well defined.
    pool: 'forks',
  },
});
