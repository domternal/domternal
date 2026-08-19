#!/usr/bin/env node
/**
 * Fails when `@domternal/pm` and a library that shares ProseMirror with it can
 * no longer agree on one copy.
 *
 * This is the root cause, checked at its source. `@domternal/pm` declares the
 * `prosemirror-*` packages as ordinary dependencies, the way `@tiptap/pm` does
 * and for the same reason: a consumer installs one package instead of twelve,
 * and peer dependencies are not installed automatically by either Yarn, so
 * declaring them that way would turn a rare duplicate into a broken install for
 * every Yarn user. See `docs/single-prosemirror-copy` for the decision.
 *
 * The price of that choice is this: the copy `@domternal/pm` brings and the
 * copy another library asks for are unified by the package manager only while
 * their ranges can be satisfied together. Today they can. A major bump on
 * either side would end that silently, and every consumer who installs both
 * would get two copies with nothing to warn them at install time.
 *
 * The lockfile gate next door notices the consequence in THIS repository. This
 * one notices the cause, before it reaches anybody's lockfile, and says which
 * two declarations stopped agreeing.
 *
 * Only caret ranges are understood, which is all either side has ever used.
 * Anything else fails rather than being waved through, because a range this
 * check cannot read is a range it cannot vouch for.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Libraries known to take ProseMirror from the application root. */
export const SHARERS = ['y-prosemirror'];

/** `^1.25.4` becomes `{ major: 1, floor: [1, 25, 4] }`; anything else is null. */
export function parseCaret(range) {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!match) return null;
  return { major: Number(match[1]), floor: match.slice(1).map(Number) };
}

/**
 * True when two caret ranges can be satisfied by a single version.
 *
 * For carets that reduces to sharing a major: `^1.4.0` and `^1.25.0` are both
 * satisfied by anything at or above 1.25.0, whatever the floors. Different
 * majors can never be, which is exactly the failure this guards.
 */
export function caretsCanAgree(a, b) {
  const left = parseCaret(a);
  const right = parseCaret(b);
  if (!left || !right) return null;
  return left.major === right.major;
}

/** Reads a package.json from the first path that exists. */
function readManifest(paths) {
  const found = paths.find((path) => existsSync(path));
  return found ? { path: found, json: JSON.parse(readFileSync(found, 'utf8')) } : null;
}

/**
 * `@domternal/pm` as this tree actually resolves it.
 *
 * Read through a package that depends on it rather than from the store, which
 * keeps orphaned directories after a dedupe: an orphan would have this gate
 * judging a version nothing installs.
 */
export function findPm(root) {
  const packagesDir = join(root, 'packages');
  const candidates = existsSync(packagesDir)
    ? readdirSync(packagesDir).map((name) =>
        join(packagesDir, name, 'node_modules', '@domternal', 'pm', 'package.json')
      )
    : [];
  return readManifest([join(root, 'node_modules', '@domternal', 'pm', 'package.json'), ...candidates]);
}

/** A sharer's manifest, resolved the same way. */
export function findSharer(root, name) {
  const packagesDir = join(root, 'packages');
  const candidates = existsSync(packagesDir)
    ? readdirSync(packagesDir).map((pkg) => join(packagesDir, pkg, 'node_modules', name, 'package.json'))
    : [];
  return readManifest([join(root, 'node_modules', name, 'package.json'), ...candidates]);
}

/** Every disagreement between one pm manifest and one sharer manifest. */
export function compare(pm, sharer, sharerName) {
  const problems = [];
  const shipped = pm.dependencies ?? {};
  const wanted = sharer.peerDependencies ?? {};
  for (const [module, peerRange] of Object.entries(wanted)) {
    const ourRange = shipped[module];
    if (!ourRange) continue;
    const agree = caretsCanAgree(ourRange, peerRange);
    if (agree === null) {
      problems.push(
        `${module}: cannot read the ranges (@domternal/pm ${ourRange}, ${sharerName} ${peerRange}); this check only understands caret ranges`
      );
      continue;
    }
    if (!agree) {
      problems.push(
        `${module}: @domternal/pm wants ${ourRange} and ${sharerName} wants ${peerRange}, which no single copy can satisfy`
      );
    }
  }
  return problems;
}

function main() {
  const pm = findPm(repoRoot);
  if (!pm) {
    console.log('[pm-ranges] SKIPPED - @domternal/pm is not installed in this tree');
    return;
  }

  const problems = [];
  let compared = 0;
  for (const name of SHARERS) {
    const sharer = findSharer(repoRoot, name);
    if (!sharer) continue;
    compared += 1;
    problems.push(...compare(pm.json, sharer.json, name).map((detail) => `${name}: ${detail}`));
  }

  if (compared === 0) {
    console.log('[pm-ranges] SKIPPED - no library sharing ProseMirror is installed here');
    return;
  }

  if (problems.length > 0) {
    console.error('[pm-ranges] FAILED: two declarations can no longer settle on one copy:');
    console.error('');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    console.error('[pm-ranges] Every consumer installing both would get two copies, and');
    console.error('[pm-ranges] ProseMirror compares by identity, so that is a crash rather');
    console.error('[pm-ranges] than extra bytes. Move the two ranges back into one major, or');
    console.error('[pm-ranges] wait for the other library to catch up before bumping:');
    console.error('[pm-ranges] https://domternal.dev/v1/guides/single-prosemirror-copy/');
    process.exit(1);
  }

  console.log(
    `[pm-ranges] OK - @domternal/pm ${pm.json.version} agrees with ${compared} sharing library on every module`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
