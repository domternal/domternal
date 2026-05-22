#!/usr/bin/env node
/**
 * Fails if any package's gzipped dist/index.js exceeds its budget.
 * Catches accidental dependency bloat (e.g. a stray lodash import
 * doubling a bundle). Budgets live in budget.json - bump them when the
 * growth is intentional, so the diff records the decision.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const budgets = JSON.parse(readFileSync(join(here, 'budget.json'), 'utf8'));

async function gzippedSize(path) {
  let bytes = 0;
  const sink = new Writable({ write(chunk, _enc, cb) { bytes += chunk.length; cb(); } });
  await pipeline(createReadStream(path), createGzip({ level: 9 }), sink);
  return bytes;
}

const violations = [];
const lines = [];
for (const [name, budget] of Object.entries(budgets)) {
  if (name.startsWith('$')) continue;
  const dist = join(repoRoot, 'packages', name, 'dist', 'index.js');
  if (!existsSync(dist)) {
    console.error(`[bundle-size] missing dist for ${name} - run \`pnpm build\` first`);
    process.exit(1);
  }
  const size = await gzippedSize(dist);
  const pct = ((size / budget) * 100).toFixed(0);
  lines.push(`  ${name.padEnd(34)} ${String(size).padStart(7)}  /  ${String(budget).padStart(7)}  (${pct}%)`);
  if (size > budget) violations.push({ name, size, budget });
}

console.log('[bundle-size] gzipped sizes vs budgets:');
for (const line of lines) console.log(line);

if (violations.length > 0) {
  console.error('');
  console.error('[bundle-size] FAILED: budget exceeded:');
  for (const v of violations) console.error(`  ${v.name}: ${v.size} > ${v.budget}`);
  console.error('');
  console.error('[bundle-size] investigate the growth before bumping the budget in budget.json.');
  process.exit(1);
}

console.log('[bundle-size] OK');
