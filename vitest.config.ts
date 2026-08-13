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
  },
});
