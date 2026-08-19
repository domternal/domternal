#!/usr/bin/env node
/**
 * Dumps the public export surface of every published entry point to a tracked
 * snapshot file, so that adding, renaming or removing an export lands as a
 * diff in the pull request that does it instead of in a consumer's build.
 *
 *   node dump.mjs           write snapshots
 *   node dump.mjs --check   diff against committed snapshots, exit 1 on drift
 *
 * ## The silent failure this ends
 *
 * The first version of this gate guessed at one path per package,
 * `packages/<name>/dist/index.d.ts`, and dropped any declaration file it could
 * not parse with a bare `continue`. Both halves were quiet. It printed "OK - 15
 * packages match committed snapshots" while only 14 snapshots existed on disk,
 * and it never named the four packages of eighteen it was not covering at all:
 *
 *   - `@domternal/pm`, whose entire surface is twelve subpaths and no `.`
 *     entry, so the path guess found nothing. This is the single-copy
 *     chokepoint of the repository: a subpath quietly repointed at another
 *     module is exactly the drift that ships two ProseMirror copies to
 *     everyone, and it was the least guarded thing here.
 *   - `@domternal/extension-block-menu`, whose declaration file is one
 *     `export * from` line that the name parser does not match, so it counted
 *     as a covered package while contributing nothing.
 *   - `@domternal/angular`, which ships ng-packagr output (`dist/types` plus
 *     `dist/fesm2022`) and never had a `dist/index.d.ts` to find.
 *   - `@domternal/theme`, whose declaration file sits at the package root.
 *
 * A gate that miscounts its own coverage is worse than no gate, because the
 * green line gets read as proof. So nothing is skipped quietly any more: an
 * entry point that cannot be snapshotted is a failure that names the package,
 * and the count printed on success is the number of entries actually compared.
 *
 * ## Entries come from the exports map, never from a path guess
 *
 * Every entry a consumer can import is discovered from the same exports map
 * that gets published, `publishConfig.exports` when one exists and `exports`
 * otherwise. Multi-entry packages are therefore covered by construction, and
 * each subpath gets its own snapshot named `<package>__<subpath>.txt` beside
 * the main `<package>.txt`.
 *
 * ## The source condition is never followed
 *
 * Free packages carry `"@domternal/source": "./src/index.ts"` directly in
 * `exports`, so the workspace can resolve TypeScript source while consumers
 * resolve `dist`. Snapshotting through that condition would record the surface
 * of source that nobody installs and would hide a broken build entirely, so
 * the condition is skipped by name in both collectors, and a types target that
 * is not a declaration file is a failure rather than something to parse. What
 * gets snapshotted is the `types` a consumer receives under `import` and
 * `require`, and when a package publishes both they must agree: ESM and CJS
 * declarations drifting apart is a real defect that only one of the two halves
 * of the ecosystem would ever notice.
 *
 * ## `@domternal/theme` is deliberately not snapshotted
 *
 * It publishes CSS and SCSS only. Its `index.d.ts` is `export {}` with a
 * comment, written so that a side-effect import type-checks, and there is no
 * value or type in it that a consumer can name. Snapshotting that would create
 * an empty file that can never drift, which reads like coverage while being
 * none. The surface that theme actually promises is its custom properties, and
 * `tests/css-vars` guards those. So entries that publish no JavaScript are
 * counted as asset-only and reported by name on success, rather than either
 * failing or vanishing.
 *
 * ## A star re-export is recorded as an edge, not resolved through
 *
 * `@domternal/extension-block-menu` is a pure shim, and each `@domternal/pm`
 * subpath is one line of `export * from 'prosemirror-*'`. Neither owns the
 * names it forwards. Resolving through would copy hundreds of third-party
 * symbols into our snapshots, and every upstream patch release would then show
 * up as drift in our public API, which is both untrue and the fastest way to
 * get a noisy gate switched off. So a star re-export is recorded as the edge
 * itself, `*(prosemirror-model)`, in the same spirit as the existing
 * `default(Source)` entry. That is what the package actually owns, and it is
 * the thing worth freezing: repointing `@domternal/pm/model` at another module,
 * or dropping the subpath, changes the snapshot immediately. Drift in the names
 * behind the edge is not lost either, because for a workspace target such as
 * `@domternal/extension-block-controls` the snapshot that does own those names
 * moves in the same diff.
 *
 * ## Stale snapshots
 *
 * A deleted package or a removed subpath used to leave its `.txt` file behind
 * forever with nothing noticing, so the directory slowly filled with surfaces
 * nothing published. Any snapshot with no matching entry point is now deleted
 * on write and is an error under --check.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const snapshotsDir = join(here, 'snapshots');

/**
 * The workspace-only condition that points at TypeScript source.
 *
 * Skipped by name in both collectors: what a consumer installs is `dist`, and
 * a gate that reads source instead would pass while the published build was
 * missing or wrong.
 */
export const SOURCE_CONDITION = '@domternal/source';

/** What a `types` condition is allowed to point at. */
export const DECLARATION_SUFFIXES = ['.d.ts', '.d.cts', '.d.mts'];

/** True when a types target is a declaration file rather than source. */
export function isDeclarationTarget(target) {
  return DECLARATION_SUFFIXES.some((suffix) => target.endsWith(suffix));
}

/**
 * Every `types` target reachable inside one exports entry.
 *
 * A package publishing both `import` and `require` yields two, and they are
 * compared against each other later.
 */
export function collectTypeTargets(entry, targets = new Set()) {
  if (entry === null || typeof entry !== 'object') return targets;
  for (const [condition, value] of Object.entries(entry)) {
    if (condition === SOURCE_CONDITION) continue;
    if (condition === 'types' && typeof value === 'string') targets.add(value);
    else if (value !== null && typeof value === 'object') collectTypeTargets(value, targets);
  }
  return targets;
}

/**
 * Every JavaScript file one exports entry can resolve to.
 *
 * This is what decides whether an entry has an API surface at all. An entry
 * resolving only to `.css` or `.scss` publishes no JavaScript and is reported
 * as asset-only instead of being snapshotted.
 */
export function collectRuntimeTargets(entry, targets = new Set()) {
  if (typeof entry === 'string') {
    if (/\.(?:c?js|mjs)$/.test(entry)) targets.add(entry);
    return targets;
  }
  if (entry === null || typeof entry !== 'object') return targets;
  for (const [condition, value] of Object.entries(entry)) {
    if (condition === 'types' || condition === SOURCE_CONDITION) continue;
    collectRuntimeTargets(value, targets);
  }
  return targets;
}

/**
 * The `[subpath, entry]` pairs of a manifest, or the reason there are none.
 *
 * Both shapes an exports map is allowed to take are handled: a map of subpaths
 * (`@domternal/pm`) and a bare condition map, which is the single `.` entry
 * written shorthand. Mixing the two is invalid in Node and is refused here
 * rather than half-read, and a missing map is a failure because a published
 * package with no exports map is one this gate cannot see into.
 */
export function exportEntriesOf(manifest) {
  const published = manifest.publishConfig?.exports ?? manifest.exports;
  if (typeof published === 'string' || Array.isArray(published)) {
    return { entries: [['.', published]], error: null };
  }
  if (published === null || typeof published !== 'object') {
    return {
      entries: [],
      error: 'declares no exports map, so its public entry points cannot be discovered',
    };
  }
  const keys = Object.keys(published);
  const hasSubpaths = keys.some((key) => key.startsWith('.'));
  const hasConditions = keys.some((key) => !key.startsWith('.'));
  if (hasSubpaths && hasConditions) {
    return {
      entries: [],
      error: 'exports mixes subpath and condition keys, which Node refuses to resolve',
    };
  }
  return { entries: hasSubpaths ? Object.entries(published) : [['.', published]], error: null };
}

/** `pm` + `./commands` becomes `pm__commands`, the snapshot file's base name. */
export function snapshotLabel(dirName, exportKey) {
  const suffix = exportKey === '.' ? '' : `__${exportKey.slice(2).replaceAll('/', '__')}`;
  return `${dirName}${suffix}`;
}

/** `@domternal/pm` + `./commands` becomes `@domternal/pm/commands`, for messages. */
export function exportOrigin(packageName, exportKey) {
  return `${packageName}${exportKey.slice(1)}`;
}

/**
 * Every public name a declaration file exposes.
 *
 * Three shapes are understood, which is every shape the builds here emit:
 *
 * 1. `export { ... }` and `export type { ... }` blocks, single or multi-line.
 *    `[^}]*` keeps the match scoped to one block so an adjacent `import { ... }`
 *    cannot bleed in. Each entry is `Name`, `type Name` or `Source as Alias`,
 *    and only the exported NAME is recorded: that is enough to flag add,
 *    remove and rename drift without depending on whether a given entry
 *    rendered inline as `type Foo`, as its own `export type { Foo }` block or
 *    merged into an `export { Foo }` re-export. The default export is recorded
 *    as `default(Source)` so rebinding it to another symbol shows as drift.
 * 2. Direct declarations, `export declare const Foo` through `export enum Foo`.
 *    Some tsup versions emit a standalone runtime const this way rather than
 *    merging it into the re-export block.
 * 3. `export * from 'mod'`, recorded as the edge `*(mod)` for the reasons in
 *    the header, and `export * as Ns from 'mod'`, which does own a name and is
 *    recorded as `Ns`.
 *
 * Anything else yields an empty set, and an empty set is a loud failure
 * upstream rather than a skip, so a fourth shape has to be taught here before
 * it can pass.
 */
export function extractExports(content) {
  const names = new Set();
  const blockPattern = /export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?\s*;/g;
  for (const m of content.matchAll(blockPattern)) {
    for (let raw of m[1].split(',')) {
      raw = raw.trim();
      if (!raw) continue;
      if (raw.startsWith('type ')) raw = raw.slice(5).trim();
      const asMatch = raw.match(/^(\S+)\s+as\s+(\S+)$/);
      let name;
      if (asMatch) {
        name = asMatch[2] === 'default' ? `default(${asMatch[1]})` : asMatch[2];
      } else {
        name = raw;
      }
      names.add(name);
    }
  }
  const declPattern =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/gm;
  for (const m of content.matchAll(declPattern)) {
    names.add(m[1]);
  }
  const starPattern = /^export\s+(?:type\s+)?\*\s+(?:as\s+(\w+)\s+)?from\s*['"]([^'"]+)['"]/gm;
  for (const m of content.matchAll(starPattern)) {
    names.add(m[1] ? m[1] : `*(${m[2]})`);
  }
  return names;
}

/** One snapshot file's contents from a set of names, sorted for a stable diff. */
export function renderSnapshot(names) {
  return [...names].sort((a, b) => a.localeCompare(b)).join('\n') + '\n';
}

/**
 * Walks `packages/` and returns one target per published JavaScript entry.
 *
 * Nothing is dropped in silence: an entry that publishes JavaScript without
 * types, or points types at something that is not a declaration file, or names
 * a declaration file that is not built, comes back in `discoveryErrors`.
 */
export function discoverTargets(packagesDir) {
  const targets = [];
  const assetOnly = [];
  const discoveryErrors = [];
  const labelOrigins = new Map();

  for (const name of readdirSync(packagesDir).sort()) {
    const packageDir = join(packagesDir, name);
    const manifestPath = join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private) continue;

    const { entries, error } = exportEntriesOf(manifest);
    if (error) {
      discoveryErrors.push(`${manifest.name}: ${error}`);
      continue;
    }

    for (const [exportKey, entry] of entries) {
      const origin = exportOrigin(manifest.name, exportKey);
      const runtimeTargets = collectRuntimeTargets(entry);
      if (runtimeTargets.size === 0) {
        assetOnly.push(origin);
        continue;
      }

      const label = snapshotLabel(name, exportKey);
      const previousOrigin = labelOrigins.get(label);
      if (previousOrigin !== undefined) {
        discoveryErrors.push(
          `${origin}: snapshot label collides with ${previousOrigin} (${label}.txt)`
        );
        continue;
      }
      labelOrigins.set(label, origin);

      const typeTargets = collectTypeTargets(entry);
      if (typeTargets.size === 0) {
        discoveryErrors.push(
          `${origin}: published JS entry has no types target (publishes ${[...runtimeTargets].join(', ')})`
        );
        continue;
      }

      const declarations = [];
      for (const target of typeTargets) {
        if (!isDeclarationTarget(target)) {
          discoveryErrors.push(
            `${origin}: types target is not a declaration file (${target}); a consumer resolves built types, not source`
          );
          continue;
        }
        const dts = resolve(packageDir, target);
        if (!existsSync(dts)) {
          discoveryErrors.push(
            `${origin}: declaration target is missing (${target}); build the packages first`
          );
          continue;
        }
        declarations.push({ path: dts, target });
      }
      if (declarations.length > 0) targets.push({ label, origin, declarations });
    }
  }

  return { targets, assetOnly, discoveryErrors };
}

/**
 * Reads each target's declarations into the snapshot text it should have.
 *
 * An entry whose declaration file parses to nothing, and an entry whose ESM and
 * CJS declarations disagree, are both errors: the first is the shim that used
 * to count as a covered package while contributing nothing, the second is a
 * surface only half the ecosystem would ever see.
 */
export function planSnapshots(targets, dir) {
  const planned = new Map();
  const errors = [];

  for (const { label, origin, declarations } of targets) {
    const surfaces = declarations.map(({ path, target }) => ({
      exports: extractExports(readFileSync(path, 'utf8')),
      target,
    }));

    let empty = false;
    for (const surface of surfaces) {
      if (surface.exports.size === 0) {
        empty = true;
        errors.push(
          `${origin}: ${surface.target} exposes no detectable public API; teach extractExports the shape it uses`
        );
      }
    }
    if (empty) continue;

    const canonical = renderSnapshot(surfaces[0].exports);
    let differ = false;
    for (const surface of surfaces.slice(1)) {
      if (renderSnapshot(surface.exports) !== canonical) {
        differ = true;
        errors.push(
          `${origin}: declaration surfaces differ between ${surfaces[0].target} and ${surface.target}`
        );
      }
    }
    if (differ) continue;

    planned.set(join(dir, `${label}.txt`), { label, out: canonical });
  }

  return { planned, errors };
}

function main() {
  const check = process.argv.includes('--check');
  mkdirSync(snapshotsDir, { recursive: true });

  const { targets, assetOnly, discoveryErrors } = discoverTargets(join(repoRoot, 'packages'));
  const { planned, errors } = planSnapshots(targets, snapshotsDir);
  const problems = [...discoveryErrors, ...errors];

  // Measured against every entry point that was DISCOVERED, not every one that
  // planned cleanly. A target that failed above already has its own message,
  // and calling its snapshot stale as well would report one defect twice and
  // point at the wrong fix.
  const expected = new Set(targets.map(({ label }) => join(snapshotsDir, `${label}.txt`)));
  const stale = readdirSync(snapshotsDir)
    .filter((name) => name.endsWith('.txt'))
    .map((name) => join(snapshotsDir, name))
    .filter((path) => !expected.has(path))
    .sort();

  if (!check && problems.length > 0) {
    console.error('[api-surface] FAILED: could not generate complete public API snapshots:');
    console.error('');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    console.error('[api-surface] Nothing was written. Every published entry point has to be');
    console.error('[api-surface] snapshotted or the count above stops meaning anything, so fix');
    console.error('[api-surface] the entry rather than letting it drop out.');
    process.exit(1);
  }

  const drift = [];
  for (const [snapshot, { label, out }] of planned) {
    if (check) {
      const committed = existsSync(snapshot);
      const existing = committed ? readFileSync(snapshot, 'utf8') : '';
      if (existing !== out) drift.push({ label, snapshot, next: out, committed });
    } else {
      writeFileSync(snapshot, out);
    }
  }

  if (check) {
    for (const snapshot of stale) {
      problems.push(
        `stale snapshot has no published entry point: ${snapshot.slice(repoRoot.length + 1)}`
      );
    }
  } else {
    for (const snapshot of stale) unlinkSync(snapshot);
  }

  if (check) {
    if (problems.length > 0 || drift.length > 0) {
      console.error('[api-surface] FAILED: public API surface drifted from committed snapshots:');
      console.error('');
      for (const problem of problems) console.error(`  - ${problem}`);
      if (problems.length > 0 && drift.length > 0) console.error('');
      for (const d of drift) {
        const rel = d.snapshot.slice(repoRoot.length + 1);
        console.error(`  ${rel}`);
        // A published entry point with no committed snapshot at all: print the
        // surface rather than an empty diff, since `git diff --no-index` has
        // nothing to compare against and would say nothing.
        if (!d.committed) {
          console.error('    (entry point not snapshotted yet, its surface is)');
          for (const line of d.next.trimEnd().split('\n')) console.error(`    + ${line}`);
          console.error('');
          continue;
        }
        try {
          const diff = execFileSync(
            'git',
            ['diff', '--no-index', '--no-color', '--', d.snapshot, '-'],
            {
              input: d.next,
              stdio: ['pipe', 'pipe', 'ignore'],
            }
          );
          console.error(String(diff).split('\n').slice(4).join('\n'));
        } catch (err) {
          if (err.stdout) console.error(String(err.stdout).split('\n').slice(4).join('\n'));
        }
      }
      console.error('');
      console.error('[api-surface] run `node tests/api-surface/dump.mjs` and commit the updated');
      console.error('[api-surface] snapshots if this is intentional. A removed export is a');
      console.error('[api-surface] breaking change and needs a major, so check the diff first.');
      process.exit(1);
    }
    console.log(`[api-surface] OK - ${planned.size} entries match committed snapshots`);
  } else {
    console.log(
      `[api-surface] wrote ${planned.size} snapshots and removed ${stale.length} stale ones`
    );
  }

  if (assetOnly.length > 0) {
    console.log(
      `[api-surface] ${assetOnly.length} entries publish no JavaScript and carry no API surface: ${assetOnly.join(', ')}`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
