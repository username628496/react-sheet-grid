// Fixes up the type declarations tsc writes so they resolve under every module resolution mode.
//
// tsc emits `export * from './core'`, which only `moduleResolution: bundler` understands. Node's ESM rules (and so
// TypeScript's node16/nodenext) need real file names. This script rewrites every relative specifier in dist/**/*.d.ts
// to the exact file (`./core/index.js`), then writes a CommonJS twin of every declaration file (`*.d.cts`, whose
// specifiers end in `.cjs`), because the `require` condition must point at declarations that are CommonJS-format.
// No dependency needed: the output is plain text and the rules are mechanical.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

function declarationFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...declarationFiles(path));
    else if (name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function target(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(`${base}.d.ts`)) return specifier;
  if (existsSync(join(base, 'index.d.ts'))) return `${specifier.replace(/\/$/, '')}/index`;
  throw new Error(`${fromFile}: cannot resolve "${specifier}"`);
}

function rewrite(file, source, extension) {
  return source.replace(SPECIFIER, (_all, lead, quote, specifier) => `${lead}${quote}${target(file, specifier)}${extension}${quote}`);
}

for (const file of declarationFiles(dist)) {
  const source = readFileSync(file, 'utf8');
  writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), rewrite(file, source, '.cjs'));
}
for (const file of declarationFiles(dist)) {
  writeFileSync(file, rewrite(file, readFileSync(file, 'utf8'), '.js'));
}
