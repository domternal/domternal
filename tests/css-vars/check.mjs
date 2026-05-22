#!/usr/bin/env node
/**
 * Fails if any `var(--dm-X)` reference in theme SCSS has no matching
 * `--dm-X:` definition. Catches CSS variable typos that would render
 * as invalid values at runtime, with no compile-time signal.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const scanDirs = [join(repoRoot, 'packages', 'theme', 'src')];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(scss|css)$/.test(name)) out.push(path);
  }
  return out;
}

const files = scanDirs.flatMap((d) => walk(d));
// `var(--dm-X)` without fallback - these MUST have a definition or
// they render as `unset` (often invisible) at runtime. `var(--dm-X, Y)`
// is treated as intentionally extendable.
const refNoFallback = /var\(\s*(--dm-[a-zA-Z0-9_-]+)\s*\)/g;
const defPattern = /(--dm-[a-zA-Z0-9_-]+)\s*:/g;

const refs = new Map();
const defs = new Set();

for (const file of files) {
  const rel = file.slice(repoRoot.length + 1);
  const content = readFileSync(file, 'utf8');
  for (const m of content.matchAll(refNoFallback)) {
    if (!refs.has(m[1])) refs.set(m[1], rel);
  }
  for (const m of content.matchAll(defPattern)) defs.add(m[1]);
}

const missing = [...refs.keys()].filter((name) => !defs.has(name)).sort();
if (missing.length > 0) {
  console.error('[css-vars] FAILED: var(--dm-X) without fallback and no definition:');
  console.error('');
  for (const name of missing) console.error(`  - ${name}  (first ref in ${refs.get(name)})`);
  console.error('');
  console.error('[css-vars] either add a definition in _variables.scss / themes/ or');
  console.error('[css-vars] add a fallback at the use site: var(--dm-X, fallback).');
  process.exit(1);
}

console.log(`[css-vars] OK - ${refs.size} fallback-less references, all defined`);
