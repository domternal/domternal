#!/usr/bin/env node
/**
 * Fails if any CommandSpec in a built dist has no call in consumer.ts.
 * Without this guard a new command could be added but never exercised,
 * letting a future bundler regression drop it past tsc unnoticed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// Auto-discover every built dist that ships RawCommands. Packages
// without a `dist/index.d.ts` or without a RawCommands block contribute
// nothing, so this is safe to widen to all packages/.
const packagesDir = join(repoRoot, 'packages');
const dists = readdirSync(packagesDir)
  .map((name) => join(packagesDir, name, 'dist', 'index.d.ts'))
  .filter(existsSync)
  .map((p) => relative(repoRoot, p));

const consumer = readFileSync(join(here, 'consumer.ts'), 'utf8');

// `chain()` and `can()` share the SingleCommands surface, so a call on
// either form counts as exercising that command.
const callPattern = /(?:editor\.commands|\.chain\(\)|\.can\(\))\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g;
const calledNames = new Set();
for (const m of consumer.matchAll(callPattern)) calledNames.add(m[1]);

// Brace-depth walk instead of a `\{[\s\S]*?\}` regex: command signatures
// like `CommandSpec<[options?: { rows?: number }]>` contain nested braces
// that a non-greedy match would terminate on.
function extractRawCommandsBodies(content) {
  const bodies = [];
  const header = /interface\s+RawCommands\s*\{/g;
  let m;
  while ((m = header.exec(content)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth === 0) bodies.push(content.slice(start, i - 1));
  }
  return bodies;
}

const entryPattern = /([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*CommandSpec\b/g;
const allCommands = new Set();
const sources = new Map();

for (const dist of dists) {
  const content = readFileSync(join(repoRoot, dist), 'utf8');
  for (const body of extractRawCommandsBodies(content)) {
    for (const m of body.matchAll(entryPattern)) {
      const name = m[1];
      allCommands.add(name);
      const list = sources.get(name) ?? [];
      if (!list.includes(dist)) list.push(dist);
      sources.set(name, list);
    }
  }
}

const missing = [...allCommands].filter((n) => !calledNames.has(n)).sort();
if (missing.length > 0) {
  console.error('[coverage-check] FAILED: missing exercises for commands declared in dist:');
  console.error('');
  for (const name of missing) console.error(`  - ${name}  (from ${sources.get(name).join(', ')})`);
  console.error('');
  console.error('[coverage-check] add `editor.commands.NAME(...)` calls in consumer.ts so tsc');
  console.error('[coverage-check] catches future bundler regressions that drop these commands.');
  process.exit(1);
}

// Sanity check that this script's regex view of consumer.ts matches
// tsc's. A mismatch usually means the call regex above is too loose.
const stale = [...calledNames].filter((n) => !allCommands.has(n)).sort();
if (stale.length > 0) {
  console.error('[coverage-check] WARN: consumer.ts calls commands not found in any dist:');
  for (const name of stale) console.error(`  - ${name}`);
}

console.log(`[coverage-check] OK - ${allCommands.size} commands across ${dists.length} dists, all exercised`);
