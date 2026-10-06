// Fails when the published bundle grows past its budget, so size creep shows up in CI instead of in users' bundles.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 80; // the ESM bundle is ~56 kB gzipped today
const file = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const gzipped = gzipSync(readFileSync(file)).length / 1024;
const line = `dist/index.js: ${gzipped.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB)`;
if (gzipped > BUDGET_KB) {
  process.stderr.write(`${line} - over budget\n`);
  process.exit(1);
}
process.stdout.write(`${line}\n`);
