// Copies non-TypeScript server assets (SQL schema) into dist/ after `tsc`.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../src/server/db/schema.sql', import.meta.url));
const to = fileURLToPath(new URL('../dist/server/db/schema.sql', import.meta.url));

await mkdir(fileURLToPath(new URL('../dist/server/db', import.meta.url)), { recursive: true });
await cp(from, to);
console.log('copied schema.sql -> dist/server/db/schema.sql');
