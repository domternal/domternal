#!/usr/bin/env node
/**
 * Fails when any identity-sensitive package is locked at more than one version.
 *
 * ProseMirror and Yjs compare by identity, not by shape. Two copies of
 * `prosemirror-model` make `Fragment.from` reject a fragment the editor itself
 * produced ("Can not convert <> to a Fragment"); two copies of
 * `prosemirror-state` break `PluginKey` lookups ("Adding different instances
 * of a keyed plugin"); two copies of `y-prosemirror` leave the caret unable to
 * find the binding collaboration installed. None of that is gradual, and
 * nothing warns at install time, so it is checked here instead.
 *
 * The lockfile is the source rather than `node_modules/.pnpm`, because the
 * store keeps orphaned directories after a dedupe until something prunes them
 * and the gate would keep failing on copies nothing resolves any more. The
 * lockfile is also what CI installs from, so it is the state that ships.
 *
 * Every lockfile in the repo is checked: the site deploys from its own, and a
 * duplicate there would reach production without the root ever noticing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Packages whose exports are compared by identity somewhere in the stack.
 * A second copy of any of these is a crash, not a few extra kilobytes.
 */
export const IDENTITY_SENSITIVE = [
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-transform',
  'prosemirror-tables',
  'prosemirror-commands',
  'prosemirror-dropcursor',
  'prosemirror-gapcursor',
  'prosemirror-history',
  'prosemirror-inputrules',
  'prosemirror-keymap',
  'prosemirror-schema-list',
  'yjs',
  'y-prosemirror',
  'y-protocols',
  '@domternal/core',
  '@domternal/pm',
];

/**
 * Lockfiles to check, relative to the repo root. Missing ones are skipped.
 *
 * Every nested project, not just this one. `domternal.dev` deploys from its own
 * lockfile, so a duplicate there reaches production without the root ever
 * noticing. `domternal-pro` is checked out inside this repo during development
 * and is absent from a public clone, which is exactly why it is listed here
 * rather than only in its own gate: locally this is the run that sees both.
 */
export const LOCKFILES = [
  'pnpm-lock.yaml',
  'domternal.dev/pnpm-lock.yaml',
  'domternal-pro/pnpm-lock.yaml',
];

/**
 * Splits a `packages:` key into package and version.
 *
 * Three shapes have to survive this. pnpm quotes any key beginning with `@`,
 * so a scoped name arrives wrapped in quotes. A scoped name also carries an
 * `@` of its own, so the version split is on the LAST one. And peer context
 * (`_prosemirror-model@1.25.11`, or `(yjs@13.6.32)`) carries `@` too, which is
 * why it is stripped BEFORE the split rather than after: splitting first would
 * cut the key at the peer's `@` and report `y-prosemirror@1.3.7_prosemirror-model`
 * as the package name.
 */
export function parsePackageKey(key) {
  const unquoted = key.replace(/^['"]|['"]$/g, '');
  const bare = unquoted.split('_')[0].split('(')[0];
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  const pkg = bare.slice(0, at);
  const version = bare.slice(at + 1);
  if (!pkg || !version) return null;
  return { pkg, version };
}

/**
 * Distinct locked versions per watched package, read from a lockfile's
 * `packages:` section. That section holds exactly one entry per physical copy;
 * `snapshots:` repeats each one per peer context and would count copies twice.
 */
export function collectVersions(lockfileText, watched = IDENTITY_SENSITIVE) {
  const watchedSet = new Set(watched);
  const found = new Map();
  let inPackages = false;
  for (const line of lockfileText.split('\n')) {
    if (/^[a-zA-Z]/.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages) continue;
    const match = /^ {2}(\S+):$/.exec(line);
    if (!match) continue;
    const entry = parsePackageKey(match[1]);
    if (!entry || !watchedSet.has(entry.pkg)) continue;
    if (!found.has(entry.pkg)) found.set(entry.pkg, new Set());
    found.get(entry.pkg).add(entry.version);
  }
  return found;
}

/** Packages locked more than once, sorted for a stable report. */
export function findDuplicates(versions) {
  return [...versions.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([pkg, set]) => ({ pkg, versions: [...set].sort() }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));
}

function main() {
  const present = LOCKFILES.map((name) => join(repoRoot, name)).filter((path) => existsSync(path));
  if (present.length === 0) {
    console.error('[single-prosemirror] FAILED: no lockfile found');
    process.exit(1);
  }

  let failed = false;
  let checked = 0;

  for (const path of present) {
    const rel = relative(repoRoot, path);
    const versions = collectVersions(readFileSync(path, 'utf8'));
    const duplicates = findDuplicates(versions);
    checked += versions.size;
    if (duplicates.length === 0) continue;
    failed = true;
    console.error(`[single-prosemirror] FAILED in ${rel}: locked at more than one version:`);
    console.error('');
    for (const { pkg, versions: list } of duplicates) {
      console.error(`  - ${pkg}: ${list.join(', ')}`);
    }
    console.error('');
  }

  if (failed) {
    console.error('[single-prosemirror] these are compared by identity at runtime, so a second');
    console.error('[single-prosemirror] copy is a crash rather than extra bytes. Pin one version');
    console.error('[single-prosemirror] in the root package.json "pnpm.overrides", then run');
    console.error('[single-prosemirror] `pnpm install`. Background and the consumer-facing fix:');
    console.error('[single-prosemirror] https://domternal.dev/v1/guides/single-prosemirror-copy/');
    process.exit(1);
  }

  console.log(
    `[single-prosemirror] OK - ${present.length} lockfile(s), ` +
      `${checked} identity-sensitive entries, one version each`,
  );
}

// Importable for the unit tests, executable as the gate.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
