#!/usr/bin/env node
/**
 * Fails when `@domternal/pm` and a library that shares ProseMirror with it can
 * no longer agree on one copy.
 *
 * This is the root cause, checked at its source. `@domternal/pm` declares the
 * `prosemirror-*` packages as ordinary dependencies, the way `@tiptap/pm` does
 * and for the same reason: a consumer installs one package instead of twelve,
 * and neither version of Yarn installs peer dependencies automatically, so
 * declaring them that way would turn a rare duplicate into a broken install for
 * every Yarn user. The guide records that decision in full.
 *
 * The price of that choice is this: the copy `@domternal/pm` brings and the
 * copy another library asks for are unified by the package manager only while
 * their ranges can be satisfied together. Today they can. A major bump on
 * either side would end that silently, and every consumer installing both would
 * get two copies with nothing to warn them at install time.
 *
 * The lockfile gate next door notices the consequence in the trees this
 * repository installs. This one notices the cause, in the declaration itself,
 * before it reaches anybody's lockfile.
 *
 * ## Why the sharers are discovered rather than listed
 *
 * A hardcoded list is a list somebody has to remember to extend, and the whole
 * failure mode here is that nobody notices. So every installed package is asked
 * whether it declares a `prosemirror-*` peer, and whatever answers is checked.
 * Today exactly one does; the day a second arrives it is covered without anyone
 * doing anything.
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

/**
 * pnpm stores to scan, relative to the repo root. Missing ones are skipped, so
 * one list serves both repositories and a partial checkout still passes.
 *
 * Every nested project, because each installs its own tree and our package
 * meets a sharer in all of them. `domternal.dev` is in this workspace, so its
 * dependencies land in the root store as well; listing it costs nothing and
 * keeps the gate right if that ever changes.
 */
export const STORES = [
  'node_modules/.pnpm',
  'domternal.dev/node_modules/.pnpm',
  'domternal-pro/node_modules/.pnpm',
];

/** Lockfiles that say which versions are actually installed. */
export const LOCKFILES = [
  'pnpm-lock.yaml',
  'domternal.dev/pnpm-lock.yaml',
  'domternal-pro/pnpm-lock.yaml',
];

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
 * majors never can be, which is exactly the failure this guards. Null means one
 * of them is not a caret and the question cannot be answered.
 */
export function caretsCanAgree(a, b) {
  const left = parseCaret(a);
  const right = parseCaret(b);
  if (!left || !right) return null;
  return left.major === right.major;
}

/**
 * A pnpm store directory name, split into package and version.
 *
 * `y-prosemirror@1.3.7_prosemirror-model@1.25.11_...` and `@domternal+pm@0.15.0`
 * are both entries: a scoped name carries its slash as `+`, and a peer-context
 * suffix follows the version after `_` or `(`.
 */
export function parseStoreEntry(entry) {
  const match = /^(@?[^@]+)@([^_(]+)/.exec(entry);
  if (!match) return null;
  return { name: match[1].replace('+', '/'), version: match[2] };
}

/** Every `name@version` a lockfile records as installed. */
export function collectInstalled(lockfileText) {
  const installed = new Set();
  let inPackages = false;
  for (const line of lockfileText.split('\n')) {
    if (/^[a-zA-Z]/.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages) continue;
    const match = /^ {2}(\S+):$/.exec(line);
    if (!match) continue;
    const entry = parseStoreEntry(match[1].replace(/^['"]|['"]$/g, ''));
    if (entry) installed.add(`${entry.name}@${entry.version}`);
  }
  return installed;
}

/** The prosemirror peers a manifest declares, or null when it declares none. */
export function prosemirrorPeers(manifest) {
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) =>
    name.startsWith('prosemirror-')
  );
  return peers.length > 0 ? Object.fromEntries(peers) : null;
}

/**
 * Every installed package that takes ProseMirror from the application root.
 *
 * Filtered against the lockfiles on purpose: a pnpm store keeps orphaned
 * directories after a dedupe until something prunes them, and an orphan of an
 * older version would have this gate failing on a declaration nothing installs.
 * A false alarm is how a gate gets switched off.
 */
export function discoverSharers(root, stores = STORES, lockfiles = LOCKFILES) {
  const installed = new Set();
  for (const rel of lockfiles) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const key of collectInstalled(readFileSync(path, 'utf8'))) installed.add(key);
  }

  const sharers = new Map();
  for (const rel of stores) {
    const store = join(root, rel);
    if (!existsSync(store)) continue;
    for (const entry of readdirSync(store)) {
      const parsed = parseStoreEntry(entry);
      if (!parsed) continue;
      const key = `${parsed.name}@${parsed.version}`;
      if (sharers.has(key) || !installed.has(key)) continue;
      const manifest = join(store, entry, 'node_modules', ...parsed.name.split('/'), 'package.json');
      if (!existsSync(manifest)) continue;
      let json;
      try {
        json = JSON.parse(readFileSync(manifest, 'utf8'));
      } catch {
        continue;
      }
      const peers = prosemirrorPeers(json);
      if (peers) sharers.set(key, { name: parsed.name, version: parsed.version, peers });
    }
  }
  return [...sharers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The `@domternal/pm` whose ranges are being judged.
 *
 * The workspace source wins where it exists, because that is the file being
 * edited and the one a change has to be caught in. Elsewhere the installed copy
 * is the truth about what consumers actually get.
 */
export function findPm(root) {
  const candidates = [
    join(root, 'packages', 'pm', 'package.json'),
    join(root, 'node_modules', '@domternal', 'pm', 'package.json'),
  ];
  const packagesDir = join(root, 'packages');
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      candidates.push(join(packagesDir, name, 'node_modules', '@domternal', 'pm', 'package.json'));
    }
  }
  const found = candidates.find((path) => existsSync(path));
  if (!found) return null;
  const json = JSON.parse(readFileSync(found, 'utf8'));
  return json.name === '@domternal/pm' ? { path: found, json } : null;
}

/** Every disagreement between what pm ships and what one sharer asks for. */
export function compare(pm, sharer) {
  const problems = [];
  const shipped = pm.dependencies ?? {};
  for (const [module, peerRange] of Object.entries(sharer.peers)) {
    const ourRange = shipped[module];
    if (!ourRange) continue;
    const agree = caretsCanAgree(ourRange, peerRange);
    if (agree === null) {
      problems.push(
        `${module}: cannot read the ranges (@domternal/pm ${ourRange}, ${sharer.name} ${peerRange}); this check only understands caret ranges`
      );
      continue;
    }
    if (!agree) {
      problems.push(
        `${module}: @domternal/pm wants ${ourRange} and ${sharer.name} wants ${peerRange}, which no single copy can satisfy`
      );
    }
  }
  return problems;
}

function main() {
  const pm = findPm(repoRoot);
  if (!pm) {
    console.log('[pm-ranges] SKIPPED - @domternal/pm is neither in this workspace nor installed');
    return;
  }

  const sharers = discoverSharers(repoRoot);
  if (sharers.length === 0) {
    console.log('[pm-ranges] SKIPPED - nothing installed here takes ProseMirror as a peer');
    return;
  }

  const problems = [];
  for (const sharer of sharers) {
    problems.push(...compare(pm.json, sharer).map((detail) => `${sharer.name}: ${detail}`));
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
    `[pm-ranges] OK - @domternal/pm ${pm.json.version} agrees with ` +
      `${sharers.map((s) => `${s.name}@${s.version}`).join(', ')} on every shared module`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
