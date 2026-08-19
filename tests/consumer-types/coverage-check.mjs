#!/usr/bin/env node
/**
 * Fails if any CommandSpec in a built dist has no call in consumer.ts.
 * Without this guard a new command could be added but never exercised,
 * letting a future bundler regression drop it past tsc unnoticed.
 *
 * ## Why the fixture is stripped before it is read
 *
 * This gate answers "is this command exercised?" with a regex over
 * `consumer.ts`, and a regex cannot tell a call from a commented-out call. So
 * commenting one out satisfied the check while removing the only line tsc
 * compiles for that command: an adversarial review turned
 * `editor.commands.printDocument();` into `// editor.commands.printDocument();`
 * and this gate still printed "133 commands across 15 dists, all exercised".
 * Comments now come out first, so hiding a call fails the gate the same way
 * deleting it does. `cjs-coverage-check.mjs` next door had the same hole and
 * reads through the same helper; `tests/third-party-notices/check.mjs` carries
 * its own copy for the same reason.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './strip-comments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Every command name `consumer.ts` calls, comments excluded.
 *
 * `chain()` and `can()` share the SingleCommands surface, so a call on either
 * form counts as exercising that command.
 */
export function collectCalledCommands(source) {
  const callPattern = /(?:editor\.commands|\.chain\(\)|\.can\(\))\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g;
  const called = new Set();
  for (const match of stripComments(source).matchAll(callPattern)) called.add(match[1]);
  return called;
}

/**
 * The body of every `interface RawCommands` block in a declaration file.
 *
 * Brace-depth walk instead of a `\{[\s\S]*?\}` regex: command signatures like
 * `CommandSpec<[options?: { rows?: number }]>` contain nested braces that a
 * non-greedy match would terminate on.
 */
export function extractRawCommandsBodies(content) {
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

/** Every command a declaration file declares on RawCommands. */
export function declaredCommands(content) {
  const entryPattern = /([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*CommandSpec\b/g;
  const names = [];
  for (const body of extractRawCommandsBodies(content)) {
    for (const match of body.matchAll(entryPattern)) names.push(match[1]);
  }
  return names;
}

function main() {
  // Auto-discover every built dist that ships RawCommands. Packages
  // without a `dist/index.d.ts` or without a RawCommands block contribute
  // nothing, so this is safe to widen to all packages/.
  const packagesDir = join(repoRoot, 'packages');
  const dists = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'dist', 'index.d.ts'))
    .filter(existsSync)
    .map((p) => relative(repoRoot, p));

  const calledNames = collectCalledCommands(readFileSync(join(here, 'consumer.ts'), 'utf8'));

  const allCommands = new Set();
  const sources = new Map();
  for (const dist of dists) {
    for (const name of declaredCommands(readFileSync(join(repoRoot, dist), 'utf8'))) {
      allCommands.add(name);
      const list = sources.get(name) ?? [];
      if (!list.includes(dist)) list.push(dist);
      sources.set(name, list);
    }
  }

  const missing = [...allCommands].filter((n) => !calledNames.has(n)).sort();
  if (missing.length > 0) {
    console.error('[coverage-check] FAILED: missing exercises for commands declared in dist:');
    console.error('');
    for (const name of missing) {
      console.error(`  - ${name}  (from ${sources.get(name).join(', ')})`);
    }
    console.error('');
    console.error('[coverage-check] add `editor.commands.NAME(...)` calls in consumer.ts so tsc');
    console.error('[coverage-check] catches future bundler regressions that drop these commands.');
    console.error('[coverage-check] A call that is commented out does not count: tsc never');
    console.error('[coverage-check] compiles it, so neither does this gate.');
    process.exit(1);
  }

  // Sanity check that this script's regex view of consumer.ts matches
  // tsc's. A mismatch usually means the call regex above is too loose.
  const stale = [...calledNames].filter((n) => !allCommands.has(n)).sort();
  if (stale.length > 0) {
    console.error('[coverage-check] WARN: consumer.ts calls commands not found in any dist:');
    for (const name of stale) console.error(`  - ${name}`);
  }

  console.log(
    `[coverage-check] OK - ${allCommands.size} commands across ${dists.length} dists, all exercised`
  );
}

// Importable for the unit tests, executable as the check.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
