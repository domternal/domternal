#!/usr/bin/env node
// Every published entry must import cleanly in plain Node.
//
// An SSR framework evaluates module scope on the server even when the editor
// only ever mounts in a browser, so a single top-level `document`, `window` or
// `navigator` in a shipped bundle breaks Next.js, Remix, Nuxt and Astro
// consumers before their first render. Nothing else in this repository ever
// executes a built bundle: test:types-consumer runs tsc, api-surface parses
// d.ts as text, publint and attw resolve without loading, and every other gate
// is static analysis. This is the only check that runs the code a consumer runs.
//
// It also catches the plainer failures that reach the same people: an entry
// whose dist file was never emitted, a lost `noExternal` for an ESM-only
// dependency, a top-level await in the CJS half, a broken interop shim.
//
// Two things it deliberately does NOT do. It does not follow the
// `@domternal/source` condition, which points at TypeScript that is not in the
// tarball. And it does not treat a subpath it cannot resolve as "nothing to
// check": an entry that yields no runtime target fails, because a filter that
// silently skips is how a gate reports OK on a package it never looked at.
//
// WHICH MAP IS READ. There is only one here, which is worth saying because the
// Pro copy of this gate reads two. A package in this repository carries the
// dev-source condition in `exports` itself and scripts/prepare-publish-manifest.mjs
// strips it during `prepublishOnly`, so the published map is the workspace map
// minus one condition this gate already refuses to follow. Pro instead ships a
// whole second map in `publishConfig.exports` that pnpm swaps in at pack time,
// so its copy has to prefer that map and report the two drifting apart. Porting
// either piece here would be checking a map that does not exist.
//
// The `exports` field is read through every shape it is allowed to take, the
// way the sibling gates read it (`subpathMap` in tests/bundle-size/check.mjs,
// `exportEntriesOf` in tests/api-surface/dump.mjs): a map of subpaths, the
// string shorthand `"exports": "./dist/index.js"`, and a bare condition map,
// which is the root entry written without a subpath key. Iterating the raw
// field instead walks the string one character at a time and reads the
// condition map as subpaths called `import` and `require`, which is how this
// gate once printed a green line for a package it named `@domternal/cmport`.
//
// A publishable package with no `exports` field at all is evaluated through
// `main` and `module` rather than failed. Node resolves a bare import of such
// a package through `main`, and a bundler prefers `module`, so those files are
// the module scope a consumer really evaluates and running them is the promise
// this gate makes. Refusing the package instead would be a manifest-policy
// opinion, which tests/package-policy owns, and it would leave exactly the code
// this gate exists to run unrun. A package with neither an exports map nor a
// main or module entry is a different thing and does fail: nothing it publishes
// resolves to anything, so there is no consumer entry to defend.
//
// WHY THE HALVES ARE LOADED IN SEPARATE PROCESSES. A package that guards its
// own identity through globalThis cannot tell a page holding two copies from a
// process that was asked to load both halves of one package.
// packages/core/src/utils/prosemirrorSingleton.ts keeps its registry on
// globalThis under a `Symbol.for` key for exactly that reachability, and prints
// `Two different copies of "<module>" are loaded on this page.` when two callers
// register different ones. Importing `dist/index.js` and then requiring
// `dist/index.cjs` in one process pulls prosemirror-model's ESM build and its
// CJS build: two module records of one installed version, which is what that
// warning describes and which no consumer ever does.
//
// So the loads are split: one child imports every ESM target, another requires
// every CJS target. Inside one module system a duplicate warning has no innocent
// explanation left, so it is a failure there: it means either two versions in
// the lockfile (pnpm test:single-prosemirror) or a bundle that inlined its own
// copy (pnpm test:externals). Grouping by kind rather than isolating every entry
// is deliberate, because it keeps that detection: every ESM entry shares one
// process, so a second copy reachable from any of them still fires.
//
// On the tree as it stands no such warning can appear, and that is not a reason
// to leave it undetected. Core registers its copies from the Editor constructor
// rather than from module scope, and this gate never constructs an editor. The
// detection is here so that the day a registration moves to module scope, or a
// dependency starts guarding itself the way yjs already does in the Pro
// repository, the gate fails on it. Without the split it could only ever be
// noise: a warning printed on every clean run, exited 0 through, and learned to
// be ignored.
//
// THE ANGULAR COMPILER. Angular libraries ship partial-compiled: the class
// metadata is declarative and a consumer's build runs the Angular linker over
// it. Plain Node has no linker, so importing @angular/common alone throws
// "needs to be compiled using the JIT compiler" with no Domternal code
// involved. Loading the compiler first is what the error message itself
// prescribes, and it is stronger than skipping the package: JIT compiles all
// six component templates during the import, so a top-level DOM touch still
// surfaces as the ReferenceError it is. Signature matching was tried and
// rejected, because ESM hoists imports: the Angular error fires before the
// module body runs, so a regression would produce a byte-identical message.
//
// The split moves that preload into the import child, where load.mjs runs it
// lazily, immediately before the one entry that asked for it. @domternal/angular
// is sorted last so everything else is evaluated in a realm that has never seen
// the compiler, which is the property the single-process gate had and this one
// keeps. Giving the package a child of its own would guarantee the same thing
// through structure rather than through sort order, and it was rejected: an
// isolated entry drops out of the group that makes a cross-package duplicate
// warning detectable, and that group is the whole reason the plan is grouped by
// kind instead of one process per entry.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const packagesDir = join(repoRoot, 'packages');
const loaderPath = join(here, 'load.mjs');

// A child that never exits would hang CI with no output at all, so it is given
// a bound. Reaching it is itself a finding: a module scope that starts a timer
// or opens a handle keeps a consumer's server process alive too.
const GROUP_TIMEOUT_MS = 180_000;

// Stylesheets are entries too, and there is no module scope to evaluate. They
// are named rather than filtered by extension, so a JS entry that stops
// resolving cannot be mistaken for one of them.
export const STYLE_TARGET = /\.(css|scss|sass)$/;

// The package whose entry cannot be evaluated without the Angular JIT compiler
// in the realm first, and the module that provides it. See the header.
export const NEEDS_ANGULAR_COMPILER = '@domternal/angular';
export const ANGULAR_COMPILER = '@angular/compiler';

// Warnings a package prints when it finds a second copy of a module in one
// realm. There is no exception path for these: within a single module system
// they mean the identity comparisons the editor depends on are already broken.
// The module at stake is in the message rather than in the detector, because
// one warning covers every module core registers.
export const DUPLICATE_INSTANCE_WARNINGS = [
  {
    // packages/core/src/utils/prosemirrorSingleton.ts
    detector: '@domternal/core',
    pattern: /Two different copies of "([^"]+)" are loaded on this page\./,
  },
];

/** The ESM target a consumer's `import` resolves to, or null. */
export function importTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object') return null;
  if ('import' in entry) return importTarget(entry.import);
  if ('default' in entry) return importTarget(entry.default);
  return null;
}

/**
 * The CommonJS target a consumer's `require` resolves to, or null.
 *
 * The CJS half is its own build output with its own failure modes (a lost
 * noExternal for an ESM-only dependency, an emitted top-level await), and a
 * regression there surfaces first in a consumer's CommonJS server.
 */
export function requireTarget(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  if (!('require' in entry)) return null;
  return importTarget(entry.require);
}

/** Every runtime target of one exports entry, labelled by how it is reached. */
export function runtimeTargets(entry) {
  const targets = [];
  const esm = importTarget(entry);
  if (typeof esm === 'string') targets.push({ kind: 'import', target: esm });
  const cjs = requireTarget(entry);
  if (typeof cjs === 'string' && cjs !== esm) targets.push({ kind: 'require', target: cjs });
  return targets;
}

/**
 * The `[subpath, entry]` pairs of one manifest, or the reason there are none.
 *
 * `entries` is null when the manifest ships no `exports` field, which is not an
 * error here: `legacyTargets` picks it up. `problem` carries a map Node itself
 * would refuse, so it is reported against the package rather than half-read.
 */
export function exportEntries(manifest) {
  const published = manifest.exports;
  if (published === undefined || published === null) return { entries: null, problem: null };
  // The string shorthand and the fallback array are both the root entry.
  if (typeof published === 'string' || Array.isArray(published)) {
    return { entries: [['.', published]], problem: null };
  }
  if (typeof published !== 'object') {
    return {
      entries: [],
      problem: `exports is ${typeof published}, which resolves to nothing. Make it a target string or a map.`,
    };
  }
  const keys = Object.keys(published);
  if (keys.length === 0) {
    return { entries: [], problem: 'exports is an empty map, so nothing this package publishes can be imported.' };
  }
  const subpaths = keys.filter((key) => key.startsWith('.'));
  if (subpaths.length > 0 && subpaths.length < keys.length) {
    return {
      entries: [],
      problem: 'exports mixes subpath and condition keys, which Node refuses to resolve. Split them.',
    };
  }
  // No key starts with `.`, so the whole object is the root entry's conditions.
  return { entries: subpaths.length > 0 ? Object.entries(published) : [['.', published]], problem: null };
}

/**
 * What a consumer loads from a package that ships no `exports` map.
 *
 * `module` is the bundler's preference and `main` is what Node resolves, so
 * both are evaluated when they differ. `main` is loaded the way its own package
 * declares it: through `require` unless the package is `type: module`.
 */
export function legacyTargets(manifest) {
  const bundlerEntry = typeof manifest.module === 'string' ? manifest.module : null;
  const nodeEntry = typeof manifest.main === 'string' ? manifest.main : null;
  const targets = [];
  if (bundlerEntry !== null) targets.push({ kind: 'import', target: bundlerEntry });
  if (nodeEntry !== null && nodeEntry !== bundlerEntry) {
    targets.push({ kind: manifest.type === 'module' ? 'import' : 'require', target: nodeEntry });
  }
  return targets;
}

/** The module an entry needs in the realm before it can be loaded, or null. */
export function preloadFor(entry) {
  return entry.package === NEEDS_ANGULAR_COMPILER ? ANGULAR_COMPILER : null;
}

/** Every entry in the repository, in the order they should be loaded. */
export function collectEntries(directory = packagesDir) {
  const entries = [];
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const packageDirectory = join(directory, dirent.name);
    const manifestPath = join(packageDirectory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private === true) continue;
    const base = { package: manifest.name, directory: packageDirectory };
    const { entries: exported, problem } = exportEntries(manifest);

    if (problem !== null) {
      entries.push({ ...base, label: manifest.name, subpath: '.', via: 'manifest', problem, targets: [] });
      continue;
    }
    if (exported === null) {
      entries.push({
        ...base,
        label: manifest.name,
        subpath: '.',
        via: 'legacy',
        problem: null,
        targets: legacyTargets(manifest),
      });
      continue;
    }
    for (const [subpath, entry] of exported) {
      entries.push({
        ...base,
        label: `${manifest.name}${subpath.slice(1)}`,
        subpath,
        via: 'exports',
        problem: null,
        targets: runtimeTargets(entry),
      });
    }
  }
  // The package that needs the JIT compiler goes last, so every other entry is
  // evaluated in a process that has not loaded it. Everything else is sorted by
  // label, so a run is reproducible.
  return entries.sort((a, b) => {
    const order = Number(a.package === NEEDS_ANGULAR_COMPILER) - Number(b.package === NEEDS_ANGULAR_COMPILER);
    return order !== 0 ? order : a.label.localeCompare(b.label);
  });
}

/** Why an entry that named no runtime target is a failure, in its own terms. */
export function unresolvableReason(entry) {
  if (entry.via === 'legacy') {
    return (
      'declares no exports map, and no main or module entry either, so nothing it publishes ' +
      'resolves. Add an exports map with an "import" or "require" condition.'
    );
  }
  return (
    `exports["${entry.subpath}"] resolves to no runtime target. ` +
    'Give it an "import" or "require" condition, or this entry ships unchecked.'
  );
}

/**
 * The load order, grouped so that no process sees both halves of a package.
 *
 * The grouping IS the fix for a duplicate-copy warning nobody can act on, so it
 * is a returned value rather than a loop body: a test can assert that no group
 * mixes kinds and that every target is still loaded exactly once.
 */
export function loadPlan(targets) {
  return ['import', 'require'].map((kind) => [kind, targets.filter((target) => target.kind === kind)]);
}

/** The duplicate-instance warnings a child printed, if any. */
export function duplicateInstanceWarnings(output) {
  const found = [];
  for (const line of String(output).split('\n')) {
    for (const { detector, pattern } of DUPLICATE_INSTANCE_WARNINGS) {
      const match = pattern.exec(line);
      if (match !== null) found.push({ module: match[1] ?? detector, line: line.trim() });
    }
  }
  return found;
}

/**
 * What became of every target in a group, from the records its child wrote.
 *
 * The child writes a `start` record before it touches anything, so a load that
 * ends the process is attributable rather than a silent gap: `start` with no
 * result is a crash, and every target after it was never reached. Records are
 * keyed by position, so two subpaths that share a label cannot merge.
 */
export function outcomesFrom(records, group) {
  const outcomes = group.map((target) => ({ ...target, status: 'not reached', message: null }));
  for (const record of records) {
    const outcome = outcomes[record.index];
    if (outcome === undefined) continue;
    if (record.event === 'start') outcome.status = 'crashed';
    else if (record.event === 'ok') outcome.status = 'ok';
    else if (record.event === 'fail') {
      outcome.status = 'failed';
      outcome.message = record.message;
    }
  }
  return outcomes;
}

/**
 * The failure lines one group produced, in the group's own terms.
 *
 * A group whose child never wrote a single record is reported once, against the
 * loader, rather than once per entry: "an earlier entry ended the process" is a
 * true sentence about entry two and a false one about entry one, and printing
 * it for all of them hides the only fact that matters, which is that nothing ran.
 */
export function groupFailures(kind, outcomes, exit) {
  const ended = exit.timedOut
    ? `no exit within ${String(GROUP_TIMEOUT_MS / 1000)}s`
    : `exit ${String(exit.status)}${exit.signal ? ` ${exit.signal}` : ''}`;
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome.status === 'not reached')) {
    return [
      `the loader for the ${String(outcomes.length)} ${kind} entries never ran (${ended}), so none ` +
        'of them were evaluated. This is the gate itself failing, not the packages.',
    ];
  }
  const failures = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'ok') continue;
    if (outcome.status === 'failed') {
      failures.push(`${outcome.label} (${kind}): ${outcome.message}`);
    } else if (outcome.status === 'crashed') {
      failures.push(
        `${outcome.label} (${kind}): loading it ended the process (${ended}). A module scope ` +
          'that calls process.exit, throws outside a promise, or keeps a handle open does the ' +
          'same to an SSR server.'
      );
    } else {
      failures.push(
        `${outcome.label} (${kind}): never evaluated, because an earlier entry in the same ` +
          'process ended it. Fix that one first.'
      );
    }
  }
  return failures;
}

/** Reads a JSONL record file, tolerating a final truncated line from a crash. */
export function readRecords(file) {
  if (!existsSync(file)) return [];
  const records = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A process killed mid-write leaves half a line. The start record it
      // belongs to was already flushed, so the outcome is still attributable.
    }
  }
  return records;
}

/** The packages directory to scan, so a test can run the gate over a fixture. */
export function parsePackagesArgument(argv, fallback = packagesDir) {
  const index = argv.indexOf('--packages');
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--packages needs a directory');
  return resolve(value);
}

/** Runs one kind's targets in a child process and reports what happened. */
function runGroup(kind, group, scratch) {
  const targetsFile = join(scratch, `${kind}-targets.json`);
  const recordsFile = join(scratch, `${kind}-records.jsonl`);
  writeFileSync(targetsFile, JSON.stringify(group));
  writeFileSync(recordsFile, '');
  const child = spawnSync(
    process.execPath,
    [loaderPath, '--kind', kind, '--targets', targetsFile, '--records', recordsFile],
    { cwd: repoRoot, encoding: 'utf8', timeout: GROUP_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  return {
    outcomes: outcomesFrom(readRecords(recordsFile), group),
    warnings: duplicateInstanceWarnings(output),
    output,
    exit: {
      timedOut: child.error !== undefined && child.error !== null && child.signal !== null,
      status: child.status,
      signal: child.signal,
    },
  };
}

async function main() {
  const directory = parsePackagesArgument(process.argv.slice(2));
  const failures = [];
  const pending = [];
  let styleOnly = 0;

  for (const entry of collectEntries(directory)) {
    if (entry.problem !== null) {
      failures.push(`${entry.label}: ${entry.problem}`);
      continue;
    }

    const runtime = entry.targets.filter(({ target }) => !STYLE_TARGET.test(target));
    if (runtime.length === 0) {
      // Either every target is a stylesheet, which is fine and reported, or the
      // entry resolves to nothing at all, which is not.
      if (entry.targets.length > 0) {
        styleOnly += 1;
        console.log(`--   ${entry.label} (stylesheet, nothing to evaluate)`);
        continue;
      }
      failures.push(`${entry.label}: ${unresolvableReason(entry)}`);
      continue;
    }

    // How the entry was reached is printed, so a package resolved through the
    // legacy fields is never mistaken for one with an exports map.
    const note = entry.via === 'legacy' ? ', no exports map' : '';
    for (const { kind, target } of runtime) {
      const file = join(entry.directory, target);
      if (!existsSync(file)) {
        failures.push(`${entry.label} (${kind}): ${target} does not exist; run pnpm build first`);
        continue;
      }
      pending.push({
        label: entry.label,
        kind,
        note,
        file,
        directory: entry.directory,
        preload: preloadFor(entry),
      });
    }
  }

  let loads = 0;
  const evaluated = new Set();
  const scratch = mkdtempSync(join(tmpdir(), 'domternal-ssr-'));
  try {
    for (const [kind, group] of loadPlan(pending)) {
      if (group.length === 0) continue;
      const { outcomes, warnings, output, exit } = runGroup(kind, group, scratch);

      for (const outcome of outcomes) {
        if (outcome.status !== 'ok') continue;
        loads += 1;
        evaluated.add(outcome.label);
        console.log(`ok   ${outcome.label} (${kind}${outcome.note})`);
      }
      failures.push(...groupFailures(kind, outcomes, exit));

      for (const { module, line } of warnings) {
        failures.push(
          `the ${kind} entries printed the duplicate-copy warning for ${module}: "${line}". ` +
            'Both halves of a package are loaded in separate processes here, so this is two ' +
            `copies of ${module} inside one module system: check the lockfile with ` +
            'pnpm test:single-prosemirror, and the bundles with pnpm test:externals.'
        );
      }

      const noise = output.trim();
      if (noise !== '') {
        console.log(`--   output while loading the ${kind} entries:`);
        for (const line of noise.split('\n')) console.log(`     ${line}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (loads === 0) failures.push('no importable entries found; run pnpm build first');

  if (failures.length > 0) {
    console.error('\n[ssr-import] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      '\nA reference to document, window or navigator at module scope is the usual cause. ' +
        'Move it inside the function that needs it, or guard it with typeof.'
    );
    process.exit(1);
  }

  // The two numbers count different things: one entry can publish both an ESM
  // and a CJS half, so the loads outnumber the entries they came from.
  console.log(
    `\n[ssr-import] OK - ${String(loads)} module loads across ${String(evaluated.size)} entries ` +
      `evaluate cleanly in Node (${String(styleOnly)} stylesheet-only entries have no module ` +
      'scope), with the ESM and CJS halves loaded in separate processes'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
