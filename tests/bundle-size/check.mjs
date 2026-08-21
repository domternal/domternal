#!/usr/bin/env node
/**
 * Fails when a shipped entry outgrows its gzipped budget, and when a shipped
 * entry has no budget at all.
 *
 * The first half catches accidental dependency bloat: a stray `lodash` import
 * doubling a bundle, a lazy payload that stopped being lazy. Budgets live in
 * budget.json, so raising one takes a deliberate edit and the diff records the
 * decision.
 *
 * ## Why the second half exists
 *
 * This gate used to iterate the budget file and look for
 * `packages/<name>/dist/index.js` under every key. That only ever checked what
 * somebody had remembered to write down, so a new package or a new subpath
 * shipped with no ceiling at all and nothing said so. Three packages were in
 * exactly that state: `@domternal/pm`, `@domternal/theme` and
 * `@domternal/angular` had no budget, which meant `dist/domternal-theme.css`,
 * the stylesheet every single consumer loads, could grow without limit and this
 * gate would still print OK.
 *
 * So the entries are discovered from disk, and the two lists are checked
 * against each other in both directions: an entry with no budget fails, and a
 * budget key matching no entry fails as well. A stale key is worth failing on
 * for the same reason as a missing one: it reads as coverage while guarding
 * nothing, and the next person to look at the file will believe it.
 *
 * ## Why entries come from the exports map
 *
 * The hardcoded `dist/index.js` was also wrong about what we ship.
 * `@domternal/angular` publishes `dist/fesm2022/domternal-angular.mjs`,
 * `@domternal/theme` publishes a stylesheet, and `@domternal/pm` publishes
 * twelve subpaths and no root entry at all. Reading each package's `exports`
 * map gives the file a consumer's bundler actually resolves, whatever the
 * layout, and gives every subpath its own key so none of them can hide inside
 * another's headroom.
 *
 * Conditions are followed `import` first and `default` second, never in
 * declaration order: our own `@domternal/source` condition sits first in
 * several maps and points at workspace TypeScript, which is what this repo
 * resolves and not what npm publishes.
 *
 * An entry those two conditions cannot resolve fails the gate. Skipping it was
 * the same hole one level down: an unresolvable entry appeared in none of the
 * lists below, so a package written with, say, only `require` and `browser`
 * conditions shipped with no ceiling while this gate printed its table and said
 * OK. A publishable package with no exports map at all fails for the same
 * reason. See `unresolvedEntry` for what the two shapes look like.
 *
 * ## What is measured, and what is not
 *
 * Runtime artifacts: `.js`, `.mjs`, `.cjs` and `.css`, the bytes a browser or a
 * bundler loads as shipped. Source formats are skipped, because measuring one
 * would report a number nobody pays: `@domternal/theme` also exports `./scss`,
 * a barrel of `@use` lines whose real weight is the compiled stylesheet, and
 * that stylesheet is already budgeted under `theme`. Skipped entries are named
 * in the output, so they read as a decision rather than an oversight.
 *
 * Two export keys pointing at one file share one budget, held by the root entry
 * where there is one. `theme` and `theme/css` are the same stylesheet; two
 * ceilings on it could only ever disagree. Those aliases are printed too.
 *
 * ## Why every `@domternal/pm` subpath is budgeted separately
 *
 * The twelve are one-line re-exports of the upstream `prosemirror-*` packages,
 * around 60 bytes each gzipped, and a single key for their sum was tempting.
 * It would have defeated the half of this gate that is new: a sum needs its own
 * rule about which entries roll into it, and a thirteenth subpath would then
 * arrive under the twelve's combined headroom without anyone being told. A
 * ceiling per subpath needs no special case, and it says the one thing that
 * matters about these files, which is that each stays a re-export.
 */
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Files a consumer loads as shipped, which is what a byte budget is about. */
export const RUNTIME_ARTIFACT = /\.(js|mjs|cjs|css)$/;

/**
 * The file one export entry resolves to for a consumer, or null for none.
 *
 * `import` wins over `default` and everything else is ignored, which is not the
 * same as taking the first key. Node resolves conditions in declaration order,
 * and `@domternal/source` is declared first in `core`, `react`, `vanilla` and
 * `vue` so this workspace runs TypeScript straight from `src`. No consumer ever
 * asks for that condition, so honouring it here would budget a file nobody
 * downloads and leave the published bundle unguarded.
 */
export function runtimeTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object') return null;
  if ('import' in entry) return runtimeTarget(entry.import);
  if ('default' in entry) return runtimeTarget(entry.default);
  return null;
}

/** `.` becomes the package name, `./docx` becomes `<package>/docx`. */
export function budgetKey(packageName, exportKey) {
  return exportKey === '.' ? packageName : `${packageName}/${exportKey.replace(/^\.\//, '')}`;
}

/**
 * An `exports` field reduced to a map of subpath to entry, or null for none.
 *
 * The field has three legal shapes and only one of them is a map of subpaths.
 * `"exports": "./dist/index.js"` is the root on its own, and an object whose
 * keys do not start with `.` is a set of conditions for the root rather than a
 * list of subpaths: Node picks between the two by looking at the first key, and
 * refuses a manifest that mixes them. Reading the conditions form as subpaths
 * would invent budget keys named `<package>/import` and `<package>/require`,
 * fail on both, and tell whoever hit it nothing about what was really wrong. No
 * package here is written that way today, which is precisely why the shape has
 * to be handled: the entries this gate has to catch are the ones not yet
 * written.
 */
export function subpathMap(raw) {
  if (typeof raw === 'string') return { '.': raw };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  return keys[0].startsWith('.') ? raw : { '.': raw };
}

/**
 * An entry this gate cannot reduce to one file, carried rather than dropped.
 *
 * Dropping it is what an adversarial review used to get a package past every
 * list here at once. `{ '.': { require: './dist/index.cjs', browser:
 * './dist/index.js' } }` is a legal exports map with neither an `import` nor a
 * `default` condition, so the resolver returned null, the entry was skipped,
 * and the package appeared in no table, no alias line, no sources line and no
 * unbudgeted list. It shipped with no ceiling and the gate printed OK.
 *
 * So an entry that resolves to nothing is a failure now, which is also what
 * `tests/ssr-import/check.mjs` already does with the same shape: it refuses to
 * read "I cannot resolve this" as "there is nothing here to check". The two
 * gates have to agree, because a package they disagree about is a package one
 * of them is silently not looking at.
 */
function unresolvedEntry(packageName, exportKey, reason) {
  return {
    key: budgetKey(packageName, exportKey),
    package: packageName,
    exportKey,
    reason,
    unresolved: true,
  };
}

/**
 * Every export of one package, as `{ key, target, measurable }`, plus any entry
 * that resolves to nothing as `{ key, package, exportKey, reason, unresolved }`.
 *
 * The root entry is listed first whatever order the manifest uses, so when two
 * keys resolve to one file the root is the one that ends up carrying the
 * budget. Private packages publish nothing and return nothing.
 *
 * A publishable package with no exports map is one unresolved root entry rather
 * than an empty list, for the same reason: npm still publishes it, a consumer
 * still resolves it through `main`, and every gate in this repository that asks
 * what a package ships asks its exports map. No map means no gate is looking,
 * and that has to be said out loud rather than counted as nothing to do.
 */
export function manifestEntries(packageName, manifest) {
  if (manifest.private === true) return [];
  const raw = manifest.publishConfig?.exports ?? manifest.exports;
  const exportsMap = subpathMap(raw);
  if (exportsMap === null) {
    const reason =
      raw === undefined
        ? 'declares no exports map, so nothing here can tell what it publishes'
        : 'has an exports field that is not a map of entries';
    return [unresolvedEntry(packageName, '.', reason)];
  }

  const entries = [];
  for (const [exportKey, entry] of Object.entries(exportsMap)) {
    const target = runtimeTarget(entry);
    if (target === null) {
      const reason = 'resolves to no runtime target under import or default';
      entries.push(unresolvedEntry(packageName, exportKey, reason));
      continue;
    }
    entries.push({
      key: budgetKey(packageName, exportKey),
      target,
      measurable: RUNTIME_ARTIFACT.test(target),
    });
  }
  return entries.sort((a, b) => Number(b.key === packageName) - Number(a.key === packageName));
}

/**
 * Every publishable entry under `packages/*`, split four ways.
 *
 * `measured` is what needs a budget, `aliases` are the keys that resolve to a
 * file another key already covers, `sources` are the entries in a format the
 * consumer compiles rather than loads, and `unresolved` are the ones this gate
 * cannot reduce to a file at all. Every discovered entry lands in exactly one
 * of the four, which is the property that matters: a fifth outcome spelled
 * `continue` is how an entry stops being anybody's responsibility.
 */
export function discoverEntries(root) {
  const packagesDir = join(root, 'packages');
  const measured = [];
  const aliases = [];
  const sources = [];
  const unresolved = [];
  const claimedBy = new Map();

  // withFileTypes because packages/ collects a .DS_Store on macOS, and a
  // stray file there must not read as a package with a broken manifest.
  for (const dirent of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const packageDir = join(packagesDir, dirent.name);
    const manifestPath = join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    for (const entry of manifestEntries(dirent.name, manifest)) {
      if (entry.unresolved === true) {
        unresolved.push(entry);
        continue;
      }
      if (!entry.measurable) {
        sources.push(entry);
        continue;
      }
      const file = resolve(packageDir, entry.target);
      const claimed = claimedBy.get(file);
      if (claimed !== undefined) {
        aliases.push({ ...entry, of: claimed });
        continue;
      }
      claimedBy.set(file, entry.key);
      measured.push({ ...entry, file });
    }
  }
  return { measured, aliases, sources, unresolved };
}

/** The two directions of the completeness check, given keys and budgets. */
export function completeness(keys, budgets) {
  const budgeted = Object.keys(budgets).filter((key) => !key.startsWith('$'));
  const discovered = new Set(keys);
  const known = new Set(budgeted);
  return {
    unbudgeted: keys.filter((key) => !known.has(key)),
    stale: budgeted.filter((key) => !discovered.has(key)),
  };
}

/**
 * A budget to propose for a newly discovered entry.
 *
 * Roughly a tenth above the measurement and then rounded up, which is the
 * convention every number in budget.json already follows: enough slack that an
 * innocent refactor does not fail the build, little enough that real growth
 * still has to be looked at.
 */
export function suggestBudget(size) {
  const withHeadroom = size * 1.1;
  const step = withHeadroom < 1000 ? 10 : 500;
  return Math.ceil(withHeadroom / step) * step;
}

async function gzippedSize(path) {
  let bytes = 0;
  const sink = new Writable({ write(chunk, _enc, cb) { bytes += chunk.length; cb(); } });
  await pipeline(createReadStream(path), createGzip({ level: 9 }), sink);
  return bytes;
}

async function main() {
  const budgets = JSON.parse(readFileSync(join(here, 'budget.json'), 'utf8'));
  const { measured, aliases, sources, unresolved } = discoverEntries(repoRoot);

  // First, because an entry nobody can resolve is an entry nobody is measuring,
  // and the table printed below would look complete without it.
  if (unresolved.length > 0) {
    console.error('[bundle-size] FAILED: shipped entries this gate cannot resolve to a file:');
    console.error('');
    for (const entry of unresolved) {
      console.error(`  ${entry.package}  exports["${entry.exportKey}"]: ${entry.reason}`);
    }
    console.error('');
    console.error('[bundle-size] Such an entry used to be skipped here, which put it in none of');
    console.error('[bundle-size] the lists below: not measured, not an alias, not a source, and');
    console.error('[bundle-size] not reported as unbudgeted. It shipped with no ceiling');
    console.error('[bundle-size] while this gate printed its table and said OK. Give the entry');
    console.error('[bundle-size] an `import` or `default` condition naming the file a consumer');
    console.error('[bundle-size] loads, then add its budget to tests/bundle-size/budget.json.');
    console.error('[bundle-size] tests/ssr-import/check.mjs');
    console.error('[bundle-size] fails on the same shape for the same reason.');
    process.exit(1);
  }

  const missing = measured.filter((entry) => !existsSync(entry.file));
  if (missing.length > 0) {
    console.error('[bundle-size] FAILED: shipped entries that are not built:');
    for (const entry of missing) {
      console.error(`  ${entry.key}: ${relative(repoRoot, entry.file)}`);
    }
    console.error('');
    console.error('[bundle-size] run `pnpm build` first, then this gate again.');
    process.exit(1);
  }

  for (const entry of measured) entry.size = await gzippedSize(entry.file);
  const { unbudgeted, stale } = completeness(
    measured.map((entry) => entry.key),
    budgets
  );

  console.log('[bundle-size] gzipped sizes vs budgets:');
  for (const entry of measured) {
    const budget = budgets[entry.key];
    const against =
      budget === undefined
        ? `${'-'.padStart(7)}  (no budget)`
        : `${String(budget).padStart(7)}  (${((entry.size / budget) * 100).toFixed(0)}%)`;
    console.log(`  ${entry.key.padEnd(34)} ${String(entry.size).padStart(7)}  /  ${against}`);
  }
  for (const alias of aliases) {
    console.log(`  ${alias.key.padEnd(34)} same file as ${alias.of}, covered by its budget`);
  }
  for (const source of sources) {
    console.log(`  ${source.key.padEnd(34)} ${source.target}, compiled by the consumer: not measured`);
  }

  if (unbudgeted.length > 0) {
    const sizes = new Map(measured.map((entry) => [entry.key, entry.size]));
    console.error('');
    console.error('[bundle-size] FAILED: shipped entries with no budget in budget.json:');
    for (const key of unbudgeted.sort()) {
      console.error(`  "${key}": ${suggestBudget(sizes.get(key))},   (measures ${sizes.get(key)} gzipped)`);
    }
    console.error('');
    console.error('[bundle-size] A published entry with no ceiling grows unnoticed and this');
    console.error('[bundle-size] gate reports green while it does. Add the lines above to');
    console.error('[bundle-size] tests/bundle-size/budget.json: each keeps roughly a tenth of');
    console.error('[bundle-size] headroom, the convention the rest of the file follows.');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error('');
    console.error('[bundle-size] FAILED: budget keys that match no shipped entry:');
    for (const key of stale.sort()) console.error(`  ${key}`);
    console.error('');
    console.error('[bundle-size] A key guarding nothing reads as coverage. Either the export');
    console.error('[bundle-size] was removed or renamed, in which case drop the key from');
    console.error('[bundle-size] tests/bundle-size/budget.json, or it went missing by accident,');
    console.error('[bundle-size] in which case fix the exports map in the package. Note that');
    console.error('[bundle-size] two keys resolving to one file share one budget, held by the');
    console.error('[bundle-size] root entry, so the second key belongs in neither place.');
    process.exit(1);
  }

  const violations = measured.filter((entry) => entry.size > budgets[entry.key]);
  if (violations.length > 0) {
    console.error('');
    console.error('[bundle-size] FAILED: budget exceeded:');
    for (const entry of violations) {
      console.error(`  ${entry.key}: ${entry.size} > ${budgets[entry.key]}`);
    }
    console.error('');
    console.error('[bundle-size] investigate the growth before bumping the budget in budget.json.');
    process.exit(1);
  }

  console.log('[bundle-size] OK');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
