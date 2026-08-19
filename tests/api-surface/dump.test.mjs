/**
 * Fixture tests for the discovery and parsing behind the api-surface gate.
 *
 * The gate's whole value is its count: "OK - N entries match committed
 * snapshots" is read as proof that N entry points were compared. Its first
 * version got that wrong in silence, reporting fifteen packages while fourteen
 * snapshots existed and four of eighteen packages were never looked at. So the
 * cases below are mostly about the ways an entry point can fail to be seen:
 * a package whose entries are all subpaths, one whose declaration file is a
 * single re-export line, one whose types are missing, and a snapshot with no
 * entry point left behind it. Every one of those has to raise something, and
 * none of them may pass quietly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARATION_SUFFIXES,
  SOURCE_CONDITION,
  collectRuntimeTargets,
  collectTypeTargets,
  discoverTargets,
  exportEntriesOf,
  exportOrigin,
  extractExports,
  isDeclarationTarget,
  planSnapshots,
  renderSnapshot,
  snapshotLabel,
} from './dump.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Builds a throwaway `packages/` tree from a plain description of it. */
function fixture(t, packages) {
  const root = mkdtempSync(join(tmpdir(), 'api-surface-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, { manifest, files = {} }] of Object.entries(packages)) {
    const packageDir = join(root, name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest, null, 2));
    for (const [relative, content] of Object.entries(files)) {
      const path = join(packageDir, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return root;
}

/** The two-condition entry every bundled package here publishes. */
function dualEntry() {
  return {
    [SOURCE_CONDITION]: './src/index.ts',
    import: { types: './dist/index.d.ts', default: './dist/index.js' },
    require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
  };
}

test('a tsup export block is read into names', () => {
  const found = extractExports('export { Details, DetailsContent, type DetailsOptions };');
  assert.deepEqual([...found].sort(), ['Details', 'DetailsContent', 'DetailsOptions']);
});

test('an `export type { ... }` block counts the same as an inline type', () => {
  const found = extractExports('export type { EmojiPickerItem };');
  assert.deepEqual([...found], ['EmojiPickerItem']);
});

test('an alias is recorded under the name a consumer imports', () => {
  const found = extractExports("export { Internal as Public } from './chunk.js';");
  assert.deepEqual([...found], ['Public']);
});

test('the default export records what it is bound to', () => {
  /* Rebinding default to another symbol is a breaking change that changes no
     name at all, so the source is part of the recorded surface. */
  assert.deepEqual([...extractExports('export { Editor as default };')], ['default(Editor)']);
});

test('an adjacent import block cannot bleed into an export block', () => {
  const found = extractExports("import { Fragment } from 'prosemirror-model';\nexport { Editor };");
  assert.deepEqual([...found], ['Editor']);
});

test('direct declarations are picked up', () => {
  const found = extractExports(
    [
      'export declare const VERSION: string;',
      'export declare abstract class Base {}',
      'export interface Options {}',
      'export enum Kind {}',
      'export function make(): void;',
    ].join('\n')
  );
  assert.deepEqual([...found].sort(), ['Base', 'Kind', 'Options', 'VERSION', 'make']);
});

test('a star re-export is recorded as the edge, not resolved through', () => {
  /* This is the shape that used to make a package count as covered while
     contributing nothing. What the package owns is the edge, so that is what
     is frozen: repointing it at another module moves the snapshot, while an
     upstream patch release does not. */
  assert.deepEqual(
    [...extractExports("export * from '@domternal/extension-block-controls';")],
    ['*(@domternal/extension-block-controls)']
  );
  assert.deepEqual(
    [...extractExports("export * from 'prosemirror-model';")],
    ['*(prosemirror-model)']
  );
});

test('a type-only star is still the same edge', () => {
  assert.deepEqual(
    [...extractExports("export type * from 'prosemirror-view';")],
    ['*(prosemirror-view)']
  );
});

test('a namespaced star owns a name, so the name is recorded', () => {
  assert.deepEqual([...extractExports("export * as pm from 'prosemirror-model';")], ['pm']);
});

test('a declaration file with nothing recognisable yields nothing', () => {
  /* Deliberate: an empty surface is a loud failure upstream. If this ever
     returned something for an unreadable file, the skip would be silent
     again. */
  assert.equal(extractExports("import './chunk.js';\n").size, 0);
});

test('snapshot text is sorted and newline-terminated', () => {
  assert.equal(renderSnapshot(new Set(['b', 'a', 'c'])), 'a\nb\nc\n');
});

test('types are collected from both conditions and never from source', () => {
  const found = collectTypeTargets(dualEntry());
  assert.deepEqual([...found].sort(), ['./dist/index.d.cts', './dist/index.d.ts']);
});

test('the source condition is skipped even when it carries its own types', () => {
  /* The workspace resolves TypeScript source through this condition. Reading
     it would snapshot a surface nobody installs and would pass while the
     published build was missing. */
  const found = collectTypeTargets({
    [SOURCE_CONDITION]: { types: './src/index.ts', default: './src/index.ts' },
    import: { types: './dist/index.d.ts', default: './dist/index.js' },
  });
  assert.deepEqual([...found], ['./dist/index.d.ts']);
});

test('runtime targets are the JavaScript a consumer would load', () => {
  const found = collectRuntimeTargets(dualEntry());
  assert.deepEqual([...found].sort(), ['./dist/index.cjs', './dist/index.js']);
});

test('an entry that publishes only stylesheets has no runtime target', () => {
  /* @domternal/theme. It publishes CSS and SCSS, and its index.d.ts is
     `export {}` so a side-effect import type-checks. There is no API to
     record, and an empty snapshot would read like coverage while being none. */
  const theme = {
    types: './index.d.ts',
    sass: './src/index.scss',
    style: './dist/domternal-theme.css',
    default: './dist/domternal-theme.css',
  };
  assert.equal(collectRuntimeTargets(theme).size, 0);
  assert.equal(collectRuntimeTargets('./dist/domternal-theme.css').size, 0);
});

test('only built declaration files are accepted as a types target', () => {
  for (const suffix of DECLARATION_SUFFIXES)
    assert.equal(isDeclarationTarget(`./dist/index${suffix}`), true);
  assert.equal(isDeclarationTarget('./src/index.ts'), false);
});

test('a subpath map and a condition map are both understood', () => {
  const subpaths = exportEntriesOf({ exports: { './model': {}, './view': {} } });
  assert.equal(subpaths.error, null);
  assert.deepEqual(
    subpaths.entries.map(([key]) => key),
    ['./model', './view']
  );

  const conditions = exportEntriesOf({ exports: dualEntry() });
  assert.equal(conditions.error, null);
  assert.deepEqual(
    conditions.entries.map(([key]) => key),
    ['.']
  );
});

test('publishConfig.exports wins, because that is what gets published', () => {
  const { entries } = exportEntriesOf({
    exports: { '.': dualEntry() },
    publishConfig: { exports: { './only': dualEntry() } },
  });
  assert.deepEqual(
    entries.map(([key]) => key),
    ['./only']
  );
});

test('a map mixing subpaths and conditions is refused rather than half-read', () => {
  const { error } = exportEntriesOf({ exports: { './model': {}, import: './index.js' } });
  assert.match(error, /mixes subpath and condition keys/);
});

test('a package with no exports map is a failure, not a skip', () => {
  const { error } = exportEntriesOf({ name: '@domternal/thing', main: './dist/index.js' });
  assert.match(error, /declares no exports map/);
});

test('subpath labels and origins round-trip the way the messages need', () => {
  assert.equal(snapshotLabel('pm', '.'), 'pm');
  assert.equal(snapshotLabel('pm', './commands'), 'pm__commands');
  assert.equal(snapshotLabel('pm', './a/b'), 'pm__a__b');
  assert.equal(exportOrigin('@domternal/pm', '.'), '@domternal/pm');
  assert.equal(exportOrigin('@domternal/pm', './commands'), '@domternal/pm/commands');
});

test('every subpath of a multi-entry package becomes its own target', (t) => {
  /* @domternal/pm has no `.` entry at all, which is why the path-guessing
     version of this gate found nothing there and left the repository's
     single-copy chokepoint unguarded. */
  const root = fixture(t, {
    pm: {
      manifest: {
        name: '@domternal/pm',
        exports: {
          './model': {
            import: { types: './src/model.d.ts', default: './src/model.js' },
            require: { types: './src/model.d.cts', default: './src/model.cjs' },
          },
          './view': {
            import: { types: './src/view.d.ts', default: './src/view.js' },
          },
        },
      },
      files: {
        'src/model.d.ts': "export * from 'prosemirror-model';\n",
        'src/model.d.cts': "export * from 'prosemirror-model';\n",
        'src/view.d.ts': "export * from 'prosemirror-view';\n",
      },
    },
  });

  const { targets, discoveryErrors } = discoverTargets(root);
  assert.deepEqual(discoveryErrors, []);
  assert.deepEqual(
    targets.map((target) => target.label),
    ['pm__model', 'pm__view']
  );
  assert.equal(targets[0].declarations.length, 2);

  const { planned, errors } = planSnapshots(targets, '/snapshots');
  assert.deepEqual(errors, []);
  assert.equal(planned.get('/snapshots/pm__model.txt').out, '*(prosemirror-model)\n');
  assert.equal(planned.get('/snapshots/pm__view.txt').out, '*(prosemirror-view)\n');
});

test('an asset-only entry is reported by name instead of vanishing', (t) => {
  const root = fixture(t, {
    theme: {
      manifest: {
        name: '@domternal/theme',
        exports: {
          '.': { types: './index.d.ts', default: './dist/theme.css' },
          './css': './dist/theme.css',
        },
      },
      files: { 'index.d.ts': 'export {};\n' },
    },
  });

  const { targets, assetOnly, discoveryErrors } = discoverTargets(root);
  assert.deepEqual(targets, []);
  assert.deepEqual(discoveryErrors, []);
  assert.deepEqual(assetOnly, ['@domternal/theme', '@domternal/theme/css']);
});

test('a published JS entry with no types target fails loudly', (t) => {
  const root = fixture(t, {
    thing: {
      manifest: { name: '@domternal/thing', exports: { '.': { import: './dist/index.js' } } },
      files: { 'dist/index.js': '' },
    },
  });
  const { discoveryErrors } = discoverTargets(root);
  assert.equal(discoveryErrors.length, 1);
  assert.match(discoveryErrors[0], /^@domternal\/thing: published JS entry has no types target/);
});

test('a types target pointing at source fails rather than being parsed', (t) => {
  /* The free-repo hazard: the `@domternal/source` condition really does point
     at ./src/index.ts, and a gate that followed it would snapshot source and
     go green with no build at all. */
  const root = fixture(t, {
    thing: {
      manifest: {
        name: '@domternal/thing',
        exports: { '.': { import: { types: './src/index.ts', default: './dist/index.js' } } },
      },
      files: { 'src/index.ts': 'export const a = 1;\n' },
    },
  });
  const { discoveryErrors } = discoverTargets(root);
  assert.equal(discoveryErrors.length, 1);
  assert.match(discoveryErrors[0], /types target is not a declaration file \(\.\/src\/index\.ts\)/);
});

test('an unbuilt declaration file says to build rather than reporting no API', (t) => {
  const root = fixture(t, {
    thing: {
      manifest: {
        name: '@domternal/thing',
        exports: { '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' } } },
      },
    },
  });
  const { targets, discoveryErrors } = discoverTargets(root);
  assert.deepEqual(targets, []);
  assert.equal(discoveryErrors.length, 1);
  assert.match(
    discoveryErrors[0],
    /declaration target is missing \(\.\/dist\/index\.d\.ts\); build the packages first/
  );
});

test('a private package is not expected to publish anything', (t) => {
  const root = fixture(t, {
    internal: { manifest: { name: '@domternal/internal', private: true } },
  });
  const { targets, assetOnly, discoveryErrors } = discoverTargets(root);
  assert.deepEqual([targets, assetOnly, discoveryErrors], [[], [], []]);
});

test('two entries claiming one snapshot file is a collision, not an overwrite', (t) => {
  const entry = { import: { types: './index.d.ts', default: './index.js' } };
  const root = fixture(t, {
    pm: {
      manifest: { name: '@domternal/pm', exports: { './model': entry } },
      files: { 'index.d.ts': "export * from 'prosemirror-model';\n" },
    },
    pm__model: {
      manifest: { name: '@domternal/pm-model', exports: { '.': entry } },
      files: { 'index.d.ts': 'export declare const a: number;\n' },
    },
  });
  const { discoveryErrors } = discoverTargets(root);
  assert.equal(discoveryErrors.length, 1);
  assert.match(discoveryErrors[0], /snapshot label collides with/);
});

test('a declaration file the parser cannot read is an error, never a skip', (t) => {
  /* @domternal/extension-block-menu, exactly. Its whole d.ts is one re-export
     line, and the old gate counted it as a covered package while writing no
     snapshot for it. */
  const root = fixture(t, {
    'extension-block-menu': {
      manifest: {
        name: '@domternal/extension-block-menu',
        exports: { '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' } } },
      },
      files: { 'dist/index.d.ts': "import './chunk.js';\n" },
    },
  });
  const { targets } = discoverTargets(root);
  const { planned, errors } = planSnapshots(targets, '/snapshots');
  assert.equal(planned.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exposes no detectable public API/);
});

test('ESM and CJS declarations that disagree fail instead of picking one', (t) => {
  /* Only half the ecosystem would ever see the difference, so neither half is
     allowed to be the answer. */
  const root = fixture(t, {
    thing: {
      manifest: {
        name: '@domternal/thing',
        exports: {
          '.': {
            import: { types: './dist/index.d.ts', default: './dist/index.js' },
            require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
          },
        },
      },
      files: {
        'dist/index.d.ts': 'export declare const a: number;\nexport declare const b: number;\n',
        'dist/index.d.cts': 'export declare const a: number;\n',
      },
    },
  });
  const { targets } = discoverTargets(root);
  const { planned, errors } = planSnapshots(targets, '/snapshots');
  assert.equal(planned.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /declaration surfaces differ between/);
});

test('this repository is covered end to end, with nothing dropping out', () => {
  /* The regression itself. Every published package under packages/ has to end
     up either snapshotted or named as asset-only, and the four that used to be
     invisible are checked by name so that losing one again fails here. */
  const packagesDir = join(repoRoot, 'packages');
  const { targets, assetOnly, discoveryErrors } = discoverTargets(packagesDir);
  assert.deepEqual(discoveryErrors, []);

  const covered = new Set(
    [...targets.map((t) => t.origin), ...assetOnly].map((origin) =>
      origin.split('/').slice(0, 2).join('/')
    )
  );
  for (const name of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.ok(covered.has(manifest.name), `${manifest.name} is neither snapshotted nor asset-only`);
  }

  const labels = new Set(targets.map((target) => target.label));
  assert.ok(labels.has('angular'), 'ng-packagr output is covered');
  assert.ok(labels.has('extension-block-menu'), 'the re-export shim is covered');
  assert.ok(labels.has('pm__model'), 'every @domternal/pm subpath is covered');
  assert.equal([...labels].filter((label) => label.startsWith('pm__')).length, 12);
  assert.deepEqual(assetOnly, [
    '@domternal/theme',
    '@domternal/theme/css',
    '@domternal/theme/scss',
  ]);
});

test('every planned snapshot exists on disk and matches, and none is orphaned', () => {
  /* What the gate asserts in CI, asserted here too so that a broken --check
     shows up as a failing test rather than only as a red pipeline. */
  const snapshotsDir = join(here, 'snapshots');
  const { targets } = discoverTargets(join(repoRoot, 'packages'));
  const { planned, errors } = planSnapshots(targets, snapshotsDir);
  assert.deepEqual(errors, []);

  for (const [path, { out }] of planned) {
    assert.equal(readFileSync(path, 'utf8'), out, `${path} is out of date`);
  }
  const onDisk = readdirSync(snapshotsDir).filter((name) => name.endsWith('.txt'));
  assert.equal(onDisk.length, planned.size, 'a snapshot file has no entry point behind it');
});
