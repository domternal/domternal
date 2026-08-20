#!/usr/bin/env node
/**
 * Fails when a `resolve.dedupe` entry names something the project root cannot
 * reach, because such an entry does nothing at all.
 *
 * Vite resolves a deduped id from the project root, not from the importer. Under
 * pnpm a transitive dependency is not linked there, so naming one is a no-op:
 * every importer keeps its own copy and the config reads like protection it is
 * not providing. Worse, the two Vite majors disagree about it, so neither
 * behaviour tells a reader the truth:
 *
 *   Vite <= 7  the build fails outright with "Rollup failed to resolve import"
 *   Vite >= 8  the entry is silently ignored and the duplicate survives
 *
 * No app here declares a dedupe list today, so this gate guards the future: the
 * moment one does, an entry that resolves nowhere fails instead of reading like
 * protection. The fix in both directions is the same: give the app its own
 * dependency on the module so the root path exists, then the dedupe binds.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * The ids in a config's `resolve.dedupe` array.
 *
 * Bracket-matched rather than regex-terminated. A dedupe list is not always
 * flat: `domternal.dev` spreads a conditional array into it, and a `[^\]]*`
 * pattern ends at the FIRST `]`, which is the inner one. That truncation reads
 * exactly like a shorter list, so the gate would quietly stop checking the
 * entries after it and still print OK, which is the failure mode this gate was
 * written to remove in the first place.
 */
/**
 * Drops comments before anything is scanned.
 *
 * Load-bearing twice over in this gate. `domternal.dev` explains its dedupe
 * list in a long block comment INSIDE the array, and that prose contains both
 * quoted phrases, which a string-literal scan reads as module ids, and square
 * brackets, which a bracket match reads as the end of the list. Either one on
 * its own is enough to make the gate report nonsense.
 *
 * Line comments are stripped only when `//` opens the line, so a URL inside a
 * string keeps its slashes.
 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

export function parseDedupe(source) {
  const text = stripComments(source);
  const start = text.indexOf('dedupe:');
  if (start === -1) return [];
  const open = text.indexOf('[', start);
  if (open === -1) return [];

  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  return [...text.slice(open, end).matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

/** True when `id` resolves from `appDir` the way Vite's dedupe resolves it. */
export function isReachable(appDir, id) {
  return existsSync(join(appDir, 'node_modules', id));
}

/**
 * Configs outside `apps/` that carry a dedupe list, relative to the repo root.
 *
 * `domternal.dev` is the one that matters most and the one an apps-only walk
 * misses: it is a nested project with its own lockfile and its own node_modules,
 * it is the only dedupe list in this repo that reaches production, and its list
 * is the reason the collaboration tab renders at all. Missing entries are
 * skipped, so a checkout without the site still passes.
 */
export const EXTRA_CONFIGS = ['domternal.dev/astro.config.mjs'];

/** Every `{ dir, config }` pair to check, apps first, then the extras. */
export function collectConfigs(root) {
  const found = [];
  const appsDir = join(root, 'apps');
  if (existsSync(appsDir)) {
    for (const name of readdirSync(appsDir).sort()) {
      const dir = join(appsDir, name);
      const config = join(dir, 'vite.config.ts');
      if (existsSync(config)) found.push({ dir, config });
    }
  }
  for (const rel of EXTRA_CONFIGS) {
    const config = join(root, rel);
    if (existsSync(config)) found.push({ dir: dirname(config), config });
  }
  return found;
}

function main() {
  const problems = [];
  let checked = 0;
  let entries = 0;

  for (const { dir, config } of collectConfigs(repoRoot)) {
    const ids = parseDedupe(readFileSync(config, 'utf8'));
    if (ids.length === 0) continue;
    checked += 1;
    entries += ids.length;

    for (const id of ids) {
      if (!isReachable(dir, id)) {
        problems.push({ app: relative(repoRoot, dir), id });
      }
    }
  }

  if (problems.length > 0) {
    console.error('[dedupe-reachable] FAILED: dedupe entries the project root cannot reach:');
    console.error('');
    for (const { app, id } of problems) console.error(`  - ${app}: ${id}`);
    console.error('');
    console.error('[dedupe-reachable] Vite resolves a deduped id from the project root. On Vite 8');
    console.error('[dedupe-reachable] an unreachable id is silently ignored, so the duplicate it was');
    console.error('[dedupe-reachable] meant to prevent survives. Add the module to that app\'s own');
    console.error('[dedupe-reachable] dependencies so the root path exists:');
    console.error('[dedupe-reachable] https://domternal.dev/v1/guides/single-prosemirror-copy/');
    process.exit(1);
  }

  if (checked === 0) {
    // The only dedupe list here lives in domternal.dev, which is a nested
    // repository excluded from this one, so a CI checkout has nothing to read.
    console.log('[dedupe-reachable] SKIPPED - no config with a dedupe list is present here');
    return;
  }

  console.log(
    `[dedupe-reachable] OK - ${checked} config(s), ${entries} dedupe entries, all reachable`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
