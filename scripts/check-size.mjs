// Fails when the published bundle grows past its budget, so size creep shows up in CI instead of in users' bundles.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 100; // the grid is ~90 kB gzipped today (two UI languages and the dialogs are most of it)
const XLSX_BUDGET_KB = 25; // loaded only when someone opens or saves an .xlsx file
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const kb = (file) => gzipSync(readFileSync(join(dist, file))).length / 1024;
// The grid is index.js plus the chunks it shares with the xlsx entry; xlsx.js itself loads on demand.
const gridFiles = readdirSync(dist).filter((f) => f.endsWith('.js') && f !== 'xlsx.js');
const gzipped = gridFiles.reduce((sum, f) => sum + kb(f), 0);
const xlsx = kb('xlsx.js');
if (xlsx > XLSX_BUDGET_KB) {
  process.stderr.write(`dist/xlsx.js: ${xlsx.toFixed(1)} kB gzipped - over budget (${XLSX_BUDGET_KB} kB)\n`);
  process.exit(1);
}
process.stdout.write(`dist/xlsx.js: ${xlsx.toFixed(1)} kB gzipped, loaded on demand (budget ${XLSX_BUDGET_KB} kB)\n`);
const line = `grid (${gridFiles.join(', ')}): ${gzipped.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB)`;
if (gzipped > BUDGET_KB) {
  process.stderr.write(`${line} - over budget\n`);
  process.exit(1);
}
process.stdout.write(`${line}\n`);
