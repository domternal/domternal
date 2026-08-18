#!/usr/bin/env node
/**
 * Fails when a package can inline a module that must stay shared.
 *
 * tsup externalises `dependencies` and `peerDependencies` (and their subpaths)
 * automatically, plus whatever the config's `external` array names. Anything
 * else it quietly INLINES, so the published dist carries its own private copy
 * of, say, `prosemirror-model`. Those are compared by identity, so the copy
 * inside the dist and the copy the app installed are two different classes
 * under one name, and the editor fails the moment an object crosses between
 * them. None of that is visible in the source, in the type checker, or in a
 * test run against `src` through the `@domternal-pro/source` condition, which
 * is exactly how it would survive all the way to a customer.
 *
 * Only the entry graph is walked. `src` also holds helpers nothing publishes
 * (test editors, fixtures), and their devDependency imports are not a hazard
 * because they never reach a bundle.
 *
 * Type-only imports are reported as latent rather than passed over. They
 * erase, so they cost nothing today, but they mark a specifier the package is
 * one value import away from bundling, and that is precisely how this check
 * earned its keep: `@domternal/pm/model` sat in extension-collaboration as a
 * type import until a guard needed `Fragment` from it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Bare specifiers that must never be inlined into a dist. */
export const MUST_BE_EXTERNAL = /^(@domternal\/|prosemirror-)/;

/**
 * Drops comments before scanning.
 *
 * Load-bearing, not tidiness: these packages document themselves with JSDoc
 * examples, and a line like ` * import { useEditor } from '@domternal/vue';`
 * inside a block comment is indistinguishable from a real import to a regex.
 * Without this the gate reported `@domternal/vue` as inlined into its own dist,
 * which is both impossible and exactly the kind of false alarm that gets a gate
 * switched off.
 *
 * Line comments are stripped only when `//` opens the line, so a URL inside a
 * string keeps its slashes.
 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every `import`/`export ... from` in one file, as
 * `{ specifier, typeOnly }`.
 *
 * A clause is type-only either through `import type` or by every binding
 * carrying its own `type` keyword; both erase, and neither can pull a copy
 * into the bundle.
 */
export function collectImports(text) {
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  const found = [];
  for (const match of stripComments(text).matchAll(pattern)) {
    const clause = (match[2] ?? '').trim();
    const everyBindingIsType =
      clause.startsWith('{') &&
      clause
        .slice(1, -1)
        .split(',')
        .filter((part) => part.trim().length > 0)
        .every((part) => /^type\s/.test(part.trim()));
    found.push({ specifier: match[3], typeOnly: Boolean(match[1]) || everyBindingIsType });
  }
  return found;
}

/** The `entry` array of a tsup config. */
export function parseEntries(configText) {
  const match = /entry:\s*\[([\s\S]*?)\]/.exec(configText);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The `external` array of a tsup config; empty when it declares none. */
export function parseExternals(configText) {
  const match = /external:\s*\[([\s\S]*?)\]/.exec(configText);
  if (!match) return new Set();
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

/**
 * A specifier counts as external when its package is externalised, so a
 * subpath (`@domternal/pm/model`) is covered by an entry for the package
 * itself. That mirrors how tsup resolves its own list.
 */
export function isExternal(specifier, externals) {
  if (externals.has(specifier)) return true;
  for (const name of externals) {
    if (specifier.startsWith(`${name}/`)) return true;
  }
  return false;
}

/**
 * Splits scanned imports into the ones that survive compilation and the ones
 * that erase, keeping only the shared modules.
 *
 * A specifier imported for BOTH a value and a type counts as a value import:
 * one surviving binding is enough to pull the module into the bundle.
 */
export function splitBySurvival(imports) {
  const value = new Set();
  const typeOnly = new Set();
  for (const { specifier, typeOnly: isType } of imports) {
    if (!MUST_BE_EXTERNAL.test(specifier)) continue;
    (isType ? typeOnly : value).add(specifier);
  }
  for (const specifier of value) typeOnly.delete(specifier);
  return { value, typeOnly };
}

/** Resolves a relative import to a real file, trying the usual suffixes. */
function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base,
    `${base}.ts`,
    join(base, 'index.ts'),
    join(base.replace(/\.js$/, ''), 'index.ts'),
  ];
  return candidates.find((path) => existsSync(path) && path.endsWith('.ts')) ?? null;
}

/**
 * Shared-module imports reachable from a package's tsup entries, deduped and
 * split by whether they survive compilation.
 */
export function walkEntryGraph(pkgDir, entries) {
  const seen = new Set();
  const shared = [];
  const queue = entries.map((entry) => resolve(pkgDir, entry)).filter((path) => existsSync(path));

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const found of collectImports(readFileSync(file, 'utf8'))) {
      if (found.specifier.startsWith('.')) {
        const next = resolveRelative(file, found.specifier);
        if (next) queue.push(next);
        continue;
      }
      shared.push(found);
    }
  }
  return { ...splitBySurvival(shared), files: seen.size };
}

function main() {
  const packagesDir = join(repoRoot, 'packages');
  const problems = [];
  let checked = 0;

  for (const name of readdirSync(packagesDir).sort()) {
    const pkgDir = join(packagesDir, name);
    const configPath = join(pkgDir, 'tsup.config.ts');
    const manifestPath = join(pkgDir, 'package.json');
    if (!existsSync(configPath) || !existsSync(manifestPath)) continue;

    const config = readFileSync(configPath, 'utf8');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    /* tsup's own defaults come first, then the explicit list. Both are
       needed: most pro packages lean on the automatic peerDependency pass and
       name only what is missing from it. */
    const externals = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...parseExternals(config),
    ]);

    const { value, typeOnly } = walkEntryGraph(pkgDir, parseEntries(config));
    checked += 1;

    for (const specifier of [...value].sort()) {
      if (!isExternal(specifier, externals)) {
        problems.push({ pkg: name, kind: 'bundled', specifier });
      }
    }
    for (const specifier of [...typeOnly].sort()) {
      if (!isExternal(specifier, externals)) {
        problems.push({ pkg: name, kind: 'latent', specifier });
      }
    }
  }

  if (problems.length > 0) {
    console.error('[externals] FAILED: shared modules a dist could inline:');
    console.error('');
    for (const { pkg, kind, specifier } of problems) {
      const label =
        kind === 'bundled' ? 'INLINED into the dist' : 'type-only today, one value import away';
      console.error(`  - ${pkg}: ${specifier}  (${label})`);
    }
    console.error('');
    console.error('[externals] declare it as a peer dependency, or add it to that package\'s');
    console.error('[externals] tsup.config.ts `external`. An inlined copy of an identity-compared');
    console.error('[externals] module is a runtime crash, not extra bytes:');
    console.error('[externals] https://domternal.dev/v1/guides/single-prosemirror-copy/');
    process.exit(1);
  }

  console.log(`[externals] OK - ${checked} packages, nothing shared can be inlined`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
