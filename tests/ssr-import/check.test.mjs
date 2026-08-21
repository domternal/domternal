/**
 * Fixture tests for the SSR import gate.
 *
 * Its resolution rules are the whole gate: an entry it cannot see is an entry
 * that ships unevaluated, and the failure looks exactly like success. That is
 * not hypothetical. A gate that filters targets with `endsWith('.js')` silently
 * drops any package whose entry is `.mjs`: run over these packages it reports
 * 51 entries green while never once loading @domternal/angular. So most of what
 * follows is about what must NOT be skipped, and the rest is about the process
 * split that keeps a duplicate-copy warning meaningful and about the one entry
 * that needs the Angular compiler in the realm before it can be loaded at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectEntries,
  duplicateInstanceWarnings,
  exportEntries,
  groupFailures,
  importTarget,
  legacyTargets,
  loadPlan,
  outcomesFrom,
  parsePackagesArgument,
  preloadFor,
  requireTarget,
  runtimeTargets,
} from './check.mjs';

const checkPath = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs');

/** A throwaway packages/ directory built from `{ dirName: manifest }`. */
function packagesFixture(entries) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-ssr-'));
  for (const [name, manifest] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'package.json'), JSON.stringify(manifest, null, 2));
  }
  return root;
}

/** Writes a file inside a fixture package, creating its directories. */
function writeDist(root, packageName, relativePath, source) {
  const file = join(root, packageName, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

/** Runs the gate itself over a fixture tree. */
function runGate(root) {
  return spawnSync(process.execPath, [checkPath, '--packages', root], { encoding: 'utf8' });
}

/**
 * The guard core uses, reproduced: a flag on globalThis under a fixed key, and
 * the warning it prints when a second copy sets it. Plain statements, so the
 * same source is valid as the ESM half and as the CJS half.
 */
const DUPLICATE_COPY_GUARD = `
const key = Symbol.for('fixture.prosemirror.copies');
if (globalThis[key] === true) {
  console.warn('Two different copies of "prosemirror-model" are loaded on this page.\\n"@fixture/one" registered one, "@fixture/two" arrived with another.');
}
globalThis[key] = true;
`;

test('the dev-source condition is never the target a consumer gets', () => {
  /* It sits FIRST in the map for four packages, and condition matching follows
     key order, so a walk that took the first key would load TypeScript that is
     not even in the tarball. */
  const entry = {
    '@domternal/source': './src/index.ts',
    import: { types: './dist/index.d.ts', default: './dist/index.js' },
    require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
  };
  assert.equal(importTarget(entry), './dist/index.js');
  assert.equal(requireTarget(entry), './dist/index.cjs');
});

test('an .mjs entry is a runtime target like any other', () => {
  /* @domternal/angular is ng-packagr output and this is its only entry, so an
     extension filter would drop the one package with a whole framework in it. */
  assert.deepEqual(runtimeTargets({ types: './dist/types/x.d.ts', default: './dist/fesm2022/x.mjs' }), [
    { kind: 'import', target: './dist/fesm2022/x.mjs' },
  ]);
});

test('a stylesheet subpath is kept as a target, so it can be reported rather than dropped', () => {
  /* Three theme subpaths are stylesheets. The old extension filter and this
     report agree on what happens to them and disagree on why, which is the
     point: naming them means an entry that stops resolving cannot pass as one. */
  const root = packagesFixture({
    theme: {
      name: '@domternal/theme',
      exports: {
        '.': { sass: './src/index.scss', default: './dist/domternal-theme.css' },
        './css': './dist/domternal-theme.css',
      },
    },
  });
  const styles = collectEntries(root).find((entry) => entry.subpath === './css');
  assert.deepEqual(styles.targets, [{ kind: 'import', target: './dist/domternal-theme.css' }]);
  rmSync(root, { recursive: true, force: true });
});

test('a string entry, and an entry with no require half, both resolve', () => {
  assert.deepEqual(runtimeTargets('./dist/theme.css'), [
    { kind: 'import', target: './dist/theme.css' },
  ]);
  /* Through collectEntries, not just the helper: the string shorthand used to
     be spread into one entry per character before it ever reached here, so this
     assertion passed while the only caller of it could not produce the case. */
  const root = packagesFixture({
    theme: { name: '@domternal/theme', exports: './dist/theme.css' },
  });
  assert.deepEqual(collectEntries(root)[0].targets, [
    { kind: 'import', target: './dist/theme.css' },
  ]);
  rmSync(root, { recursive: true, force: true });
  /* react, vue and vanilla are ESM-only by design. One target, not a failure. */
  assert.deepEqual(runtimeTargets({ import: { default: './dist/index.js' } }), [
    { kind: 'import', target: './dist/index.js' },
  ]);
});

test('one file reachable through both conditions is loaded once per condition, not twice', () => {
  assert.deepEqual(runtimeTargets({ import: './dist/index.js', require: './dist/index.js' }), [
    { kind: 'import', target: './dist/index.js' },
  ]);
});

test('an entry that resolves to nothing is collected so it can fail', () => {
  /* The gate must not treat "I could not resolve this" as "there was nothing
     here". An exports entry with only a types condition publishes no runtime at
     all, and that is worth hearing about. */
  const root = packagesFixture({
    broken: {
      name: '@domternal/broken',
      exports: { '.': { types: './dist/index.d.ts' } },
    },
  });
  const [entry] = collectEntries(root);
  assert.equal(entry.label, '@domternal/broken');
  assert.deepEqual(entry.targets, []);
  rmSync(root, { recursive: true, force: true });
});

test('the package needing the JIT compiler is loaded last', () => {
  /* Loading @angular/compiler mutates the realm, so everything else must
     already have been evaluated without it. Inside the import child that order
     is the sort order, because the compiler is loaded lazily, immediately
     before the entry that asked for it. */
  const root = packagesFixture({
    angular: { name: '@domternal/angular', exports: { '.': './dist/fesm2022/a.mjs' } },
    core: { name: '@domternal/core', exports: { '.': './dist/index.js' } },
    vue: { name: '@domternal/vue', exports: { '.': './dist/index.js' } },
  });
  const entries = collectEntries(root);
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['@domternal/core', '@domternal/vue', '@domternal/angular']
  );
  assert.deepEqual(
    entries.map((entry) => preloadFor(entry)),
    [null, null, '@angular/compiler']
  );
  rmSync(root, { recursive: true, force: true });
});

test('private packages and stray directory entries are not collected', () => {
  const root = packagesFixture({
    core: { name: '@domternal/core', exports: { '.': './dist/index.js' } },
    fixture: { name: 'internal', private: true, exports: { '.': './dist/index.js' } },
  });
  writeFileSync(join(root, '.DS_Store'), 'not a package');
  assert.deepEqual(
    collectEntries(root).map((entry) => entry.package),
    ['@domternal/core']
  );
  rmSync(root, { recursive: true, force: true });
});

test('every subpath of a multi-entry package is collected, not just the root', () => {
  /* @domternal/pm has twelve subpaths and no "." entry at all. A gate keyed on
     "." would check the single-copy chokepoint zero times. */
  const root = packagesFixture({
    pm: {
      name: '@domternal/pm',
      exports: {
        './model': { import: './src/model.js', require: './src/model.cjs' },
        './view': { import: './src/view.js', require: './src/view.cjs' },
      },
    },
  });
  const labels = collectEntries(root).map((entry) => entry.label);
  assert.deepEqual(labels, ['@domternal/pm/model', '@domternal/pm/view']);
  assert.equal(collectEntries(root).flatMap((entry) => entry.targets).length, 4);
  rmSync(root, { recursive: true, force: true });
});

test('the string shorthand is one root entry, not one entry per character', () => {
  /* The exact probe that defeated the old walk: Object.entries('./dist/index.js')
     yielded fifteen entries labelled @domternal/x, @domternal/x0 and up, each
     with a single character for a target, so the failure it printed named
     nothing that exists. */
  const root = packagesFixture({
    x: { name: '@domternal/x', exports: './dist/index.js' },
  });
  const entries = collectEntries(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, '@domternal/x');
  assert.equal(entries[0].subpath, '.');
  assert.deepEqual(entries[0].targets, [{ kind: 'import', target: './dist/index.js' }]);
  rmSync(root, { recursive: true, force: true });
});

test('a bare condition map is the root entry, not subpaths named import and require', () => {
  /* Read as subpaths it produced two green lines for packages called
     @domternal/cmport and @domternal/cequire, and loaded the same package
     twice under names nobody could search for. */
  const root = packagesFixture({
    c: { name: '@domternal/c', exports: { import: './dist/index.js', require: './dist/index.cjs' } },
  });
  const entries = collectEntries(root);
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['@domternal/c']
  );
  assert.deepEqual(entries[0].targets, [
    { kind: 'import', target: './dist/index.js' },
    { kind: 'require', target: './dist/index.cjs' },
  ]);
  rmSync(root, { recursive: true, force: true });
});

test('a publishable package with no exports map is evaluated, not skipped', () => {
  /* The other probe: Object.entries(undefined ?? {}) is empty, so the package
     contributed nothing and the gate still said OK. Nothing else in the build
     loads a bundle, so that package shipped with its module scope never run. */
  const root = packagesFixture({
    legacy: { name: '@domternal/legacy', main: './dist/index.cjs', module: './dist/index.js' },
  });
  const entries = collectEntries(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, '@domternal/legacy');
  assert.equal(entries[0].via, 'legacy');
  assert.deepEqual(entries[0].targets, [
    { kind: 'import', target: './dist/index.js' },
    { kind: 'require', target: './dist/index.cjs' },
  ]);
  rmSync(root, { recursive: true, force: true });
});

test('main is loaded as ESM when the package declares type: module', () => {
  assert.deepEqual(legacyTargets({ main: './dist/index.js', type: 'module' }), [
    { kind: 'import', target: './dist/index.js' },
  ]);
  /* One file named by both fields is still one file. */
  assert.deepEqual(legacyTargets({ main: './dist/index.js', module: './dist/index.js' }), [
    { kind: 'import', target: './dist/index.js' },
  ]);
});

test('a package with no exports map and no main or module is collected so it can fail', () => {
  const root = packagesFixture({ empty: { name: '@domternal/empty', version: '1.0.0' } });
  const [entry] = collectEntries(root);
  assert.equal(entry.label, '@domternal/empty');
  assert.deepEqual(entry.targets, []);
  rmSync(root, { recursive: true, force: true });
});

test('an exports map Node itself would refuse is reported against the package', () => {
  /* Mixed subpath and condition keys, and the empty map. Neither can be walked,
     and both used to come back as "no entries here", which reads as clean. */
  const mixed = exportEntries({ exports: { '.': './dist/index.js', require: './dist/index.cjs' } });
  assert.deepEqual(mixed.entries, []);
  assert.match(mixed.problem, /mixes subpath and condition keys/);
  const empty = exportEntries({ exports: {} });
  assert.match(empty.problem, /empty map/);
  const root = packagesFixture({ bad: { name: '@domternal/bad', exports: {} } });
  const [entry] = collectEntries(root);
  assert.equal(entry.problem !== null, true);
  assert.deepEqual(entry.targets, []);
  rmSync(root, { recursive: true, force: true });
});

test('the load plan never puts both halves of a package in one process', () => {
  /* This grouping is what makes a duplicate-copy warning actionable. If a group
     ever mixed kinds, the ESM and CJS copies of a dependency would meet again
     and the warning would go back to being noise. */
  const targets = [
    { label: 'a', kind: 'import', file: '/a/dist/index.js' },
    { label: 'a', kind: 'require', file: '/a/dist/index.cjs' },
    { label: 'b', kind: 'import', file: '/b/dist/index.js' },
  ];
  const plan = loadPlan(targets);
  assert.deepEqual(
    plan.map(([kind, group]) => [kind, group.length]),
    [
      ['import', 2],
      ['require', 1],
    ]
  );
  for (const [kind, group] of plan) {
    for (const target of group) assert.equal(target.kind, kind);
  }
  assert.equal(plan.flatMap(([, group]) => group).length, targets.length);
});

test('a duplicate-copy warning is recognised with the module it names, and ordinary output is not', () => {
  assert.deepEqual(
    duplicateInstanceWarnings(
      'ok\nTwo different copies of "prosemirror-model" are loaded on this page.\n"@domternal/core" registered one.\n'
    ),
    [
      {
        module: 'prosemirror-model',
        line: 'Two different copies of "prosemirror-model" are loaded on this page.',
      },
    ]
  );
  assert.deepEqual(duplicateInstanceWarnings('loading two copies of the docs\ncopies of "x"\n'), []);
});

test('a load that ends the process is attributed, and the entries after it are not counted', () => {
  /* Without the start record, a crash is a gap: the remaining entries simply
     never report, which is indistinguishable from a short run. */
  const group = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
  assert.deepEqual(
    outcomesFrom(
      [
        { event: 'start', index: 0 },
        { event: 'ok', index: 0 },
        { event: 'start', index: 1 },
      ],
      group
    ).map((outcome) => outcome.status),
    ['ok', 'crashed', 'not reached']
  );
  assert.deepEqual(
    outcomesFrom(
      [
        { event: 'start', index: 0 },
        { event: 'fail', index: 0, message: 'document is not defined' },
      ],
      [{ label: 'a' }]
    )[0],
    { label: 'a', status: 'failed', message: 'document is not defined' }
  );
});

test('a loader that never ran is reported once, against the gate, not once per entry', () => {
  /* "an earlier entry ended the process" is true of the second entry and false
     of the first, so printing it for every entry buries the only fact there is:
     nothing was evaluated. */
  const outcomes = [
    { label: 'a', status: 'not reached', message: null },
    { label: 'b', status: 'not reached', message: null },
  ];
  const failures = groupFailures('import', outcomes, { timedOut: false, status: 1, signal: null });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /the loader for the 2 import entries never ran \(exit 1\)/);
  assert.match(failures[0], /the gate itself failing, not the packages/);

  /* Once anything did run, the per-entry story is the true one again. */
  const mixed = groupFailures(
    'import',
    [
      { label: 'a', status: 'ok', message: null },
      { label: 'b', status: 'crashed', message: null },
      { label: 'c', status: 'not reached', message: null },
    ],
    { timedOut: false, status: 7, signal: null }
  );
  assert.equal(mixed.length, 2);
  assert.match(mixed[0], /b \(import\): loading it ended the process \(exit 7\)/);
  assert.match(mixed[1], /c \(import\): never evaluated/);
});

test('a group that never exits is reported as a timeout, not as an exit code', () => {
  const failures = groupFailures(
    'require',
    [{ label: 'a', status: 'crashed', message: null }],
    { timedOut: true, status: null, signal: 'SIGTERM' }
  );
  assert.match(failures[0], /no exit within 180s/);
});

test('--packages picks the tree to scan, and defaults to this repository', () => {
  assert.equal(parsePackagesArgument(['--packages', '/tmp/x'], '/default'), '/tmp/x');
  assert.equal(parsePackagesArgument([], '/default'), '/default');
  assert.throws(() => parsePackagesArgument(['--packages'], '/default'), /needs a directory/);
});

test('a clean fixture tree passes, and both halves are loaded', () => {
  const root = packagesFixture({
    clean: {
      name: '@fixture/clean',
      type: 'module',
      exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
    },
  });
  writeDist(root, 'clean', 'dist/index.js', 'export const value = 1;\n');
  writeDist(root, 'clean', 'dist/index.cjs', 'module.exports = { value: 1 };\n');
  const gate = runGate(root);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.match(gate.stdout, /ok {3}@fixture\/clean \(import\)/);
  assert.match(gate.stdout, /ok {3}@fixture\/clean \(require\)/);
  assert.match(gate.stdout, /2 module loads across 1 entries/);
  rmSync(root, { recursive: true, force: true });
});

test('a top-level document reference fails the gate, in an .mjs entry too', () => {
  /* The end-to-end proof that the extension filter is gone: under
     `endsWith('.js')` this entry was never loaded and the gate printed OK. */
  const root = packagesFixture({
    ng: { name: '@fixture/ng', exports: { '.': './dist/fesm2022/ng.mjs' } },
  });
  writeDist(root, 'ng', 'dist/fesm2022/ng.mjs', 'export const title = document.title;\n');
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /@fixture\/ng \(import\): document is not defined/);
  assert.match(gate.stderr, /document, window or navigator at module scope/);
  rmSync(root, { recursive: true, force: true });
});

test('an entry whose dist file was never emitted fails instead of passing silently', () => {
  const root = packagesFixture({
    missing: { name: '@fixture/missing', exports: { '.': { import: './dist/index.js' } } },
  });
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /dist\/index\.js does not exist; run pnpm build first/);
  rmSync(root, { recursive: true, force: true });
});

test('an entry that resolves to no runtime target fails the whole gate', () => {
  /* The clean package alongside it means the run has something to load, so the
     only thing that can fail here is the types-only entry itself: an entry
     counted as a stylesheet would leave the gate green. */
  const root = packagesFixture({
    clean: { name: '@fixture/clean', type: 'module', exports: { '.': { import: './dist/index.js' } } },
    typesonly: { name: '@fixture/types-only', exports: { '.': { types: './dist/index.d.ts' } } },
  });
  writeDist(root, 'clean', 'dist/index.js', 'export const value = 1;\n');
  const gate = runGate(root);
  assert.equal(gate.status, 1, gate.stdout + gate.stderr);
  assert.match(gate.stderr, /@fixture\/types-only: exports\["\."\] resolves to no runtime target/);
  rmSync(root, { recursive: true, force: true });
});

test('a stylesheet-only subpath is reported as having no module scope', () => {
  const root = packagesFixture({
    styled: {
      name: '@fixture/styled',
      type: 'module',
      exports: { '.': { import: './dist/index.js' }, './theme.css': { default: './dist/theme.css' } },
    },
  });
  writeDist(root, 'styled', 'dist/index.js', 'export const value = 1;\n');
  writeDist(root, 'styled', 'dist/theme.css', '.dm-editor { color: red; }\n');
  const gate = runGate(root);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.match(gate.stdout, /@fixture\/styled\/theme\.css \(stylesheet, nothing to evaluate\)/);
  assert.match(gate.stdout, /1 stylesheet-only entries have no module scope/);
  rmSync(root, { recursive: true, force: true });
});

test('the halves that trip the copy guard in one process do not trip it through the gate', () => {
  /* The fixture reproduces the guard in packages/core/src/utils/prosemirrorSingleton.ts,
     so loading both halves together prints the warning a single-process gate
     would print on every clean run and exit 0 through. The gate splits them, so
     the warning cannot appear, and the run is honestly green rather than
     green-with-a-warning. */
  const root = packagesFixture({
    guarded: {
      name: '@fixture/guarded',
      type: 'module',
      exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
    },
  });
  writeDist(root, 'guarded', 'dist/index.js', DUPLICATE_COPY_GUARD);
  writeDist(root, 'guarded', 'dist/index.cjs', DUPLICATE_COPY_GUARD);

  const together = spawnSync(
    process.execPath,
    [
      '-e',
      `import('file://${join(root, 'guarded', 'dist', 'index.js')}').then(() => {
         require('${join(root, 'guarded', 'dist', 'index.cjs')}');
       });`,
    ],
    { encoding: 'utf8' }
  );
  assert.match(together.stderr, /Two different copies of "prosemirror-model"/);

  const gate = runGate(root);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.doesNotMatch(gate.stdout + gate.stderr, /Two different copies/);
  rmSync(root, { recursive: true, force: true });
});

test('a duplicate copy inside one module system fails the gate', () => {
  /* Two packages carrying their own copy of a guarded dependency is what the
     warning is actually for, and the split leaves it no innocent explanation:
     both of these are ESM, so they share one process. */
  const root = packagesFixture({
    one: { name: '@fixture/one', type: 'module', exports: { '.': { import: './dist/index.js' } } },
    two: { name: '@fixture/two', type: 'module', exports: { '.': { import: './dist/index.js' } } },
  });
  writeDist(root, 'one', 'dist/index.js', DUPLICATE_COPY_GUARD);
  writeDist(root, 'two', 'dist/index.js', DUPLICATE_COPY_GUARD);
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /the import entries printed the duplicate-copy warning for prosemirror-model/);
  assert.match(gate.stderr, /pnpm test:single-prosemirror/);
  rmSync(root, { recursive: true, force: true });
});

test('an entry that ends the process is named, and the ones behind it are not called green', () => {
  const root = packagesFixture({
    a: { name: '@fixture/a-fine', type: 'module', exports: { '.': { import: './dist/index.js' } } },
    b: { name: '@fixture/b-exits', type: 'module', exports: { '.': { import: './dist/index.js' } } },
    c: { name: '@fixture/c-never-run', type: 'module', exports: { '.': { import: './dist/index.js' } } },
  });
  writeDist(root, 'a', 'dist/index.js', 'export const value = 1;\n');
  writeDist(root, 'b', 'dist/index.js', 'process.exit(7);\n');
  writeDist(root, 'c', 'dist/index.js', 'export const value = 3;\n');
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stdout, /ok {3}@fixture\/a-fine \(import\)/);
  assert.match(gate.stderr, /@fixture\/b-exits \(import\): loading it ended the process \(exit 7\)/);
  assert.match(gate.stderr, /@fixture\/c-never-run \(import\): never evaluated/);
  rmSync(root, { recursive: true, force: true });
});

test('the Angular compiler is loaded for its entry, and only for it', () => {
  /* End to end, inside the import child, because that is where the preload has
     to happen now: the parent process never loads a target. The two fixture
     packages assert the two halves of the property between them. @domternal/core
     fails if the compiler is already in the realm when it is evaluated, and
     @domternal/angular fails if it is not, which is what a real ng-packagr
     bundle does with "needs to be compiled using the JIT compiler". */
  const root = packagesFixture({
    angular: { name: '@domternal/angular', exports: { '.': './dist/fesm2022/a.mjs' } },
    core: { name: '@domternal/core', type: 'module', exports: { '.': { import: './dist/index.js' } } },
  });
  writeDist(
    root,
    'angular',
    'node_modules/@angular/compiler/package.json',
    JSON.stringify({ name: '@angular/compiler', version: '0.0.0', main: './index.js' })
  );
  writeDist(root, 'angular', 'node_modules/@angular/compiler/index.js', 'globalThis.__fixtureJit = true;\n');
  writeDist(
    root,
    'angular',
    'dist/fesm2022/a.mjs',
    "if (globalThis.__fixtureJit !== true) throw new Error('needs to be compiled using the JIT compiler');\nexport const value = 1;\n"
  );
  writeDist(
    root,
    'core',
    'dist/index.js',
    "if (globalThis.__fixtureJit === true) throw new Error('the compiler was in the realm before this entry ran');\nexport const value = 1;\n"
  );
  const gate = runGate(root);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.match(gate.stdout, /ok {3}@domternal\/core \(import\)/);
  assert.match(gate.stdout, /ok {3}@domternal\/angular \(import\)/);
  rmSync(root, { recursive: true, force: true });
});

test('a preload that cannot be resolved fails its entry, and names itself', () => {
  /* Without the node_modules copy above there is no compiler to load, and the
     entry cannot be checked at all. That is a failure of the gate's own setup,
     so it says which module it wanted rather than reporting the Angular error
     the entry would have thrown. */
  const root = packagesFixture({
    angular: { name: '@domternal/angular', exports: { '.': './dist/fesm2022/a.mjs' } },
  });
  writeDist(root, 'angular', 'dist/fesm2022/a.mjs', 'export const value = 1;\n');
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /@angular\/compiler could not be loaded first, so this entry cannot be checked/);
  rmSync(root, { recursive: true, force: true });
});

test('a tree with nothing importable fails rather than reporting a clean run', () => {
  const root = packagesFixture({
    styles: { name: '@fixture/styles', exports: { './theme.css': { default: './dist/theme.css' } } },
  });
  writeDist(root, 'styles', 'dist/theme.css', ':root { color: red; }\n');
  const gate = runGate(root);
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /no importable entries found; run pnpm build first/);
  rmSync(root, { recursive: true, force: true });
});
