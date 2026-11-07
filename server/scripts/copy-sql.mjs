// Copies SQL migrations next to the compiled JS so `node dist/index.js` can run them.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/db/migrations');
const to = resolve(root, 'dist/db/migrations');
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('Copied migrations to dist/db/migrations');
