/**
 * Fixture tests for the bundle-size gate.
 *
 * The half of this gate that fails on a budget being exceeded announces itself
 * loudly the first time it is wrong. The half that fails on a MISSING budget
 * cannot: if the discovery is subtly wrong, an entry drops off the list and the
 * gate keeps printing OK, which is exactly the silent state it was written to
 * end. So the resolution rules are pinned here against fixtures, and the real
 * packages/ tree is checked for the entries that were unguarded before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNTIME_ARTIFACT,
  budgetKey,
  completeness,
  discoverEntries,
  manifestEntries,
  runtimeTarget,
  subpathMap,
  suggestBudget,
} from './check.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a plain string export is its own target', () => {
  assert.equal(runtimeTarget('./dist/index.js'), './dist/index.js');
});

test('import wins, and nested condition objects are followed to the file', () => {
  const entry = {
    import: { types: './dist/index.d.ts', default: './dist/index.js' },
    require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
  };
  assert.equal(runtimeTarget(entry), './dist/index.js');
});

test('default is taken when there is no import condition', () => {
  // How @domternal/theme and @domternal/angular are both written.
  assert.equal(
    runtimeTarget({ types: './index.d.ts', style: './dist/t.css', default: './dist/t.css' }),
    './dist/t.css'
  );
});

test('the workspace source condition is ignored even though it is declared first', () => {
  /* The failure this prevents: taking the first key would budget
     src/index.ts, a file no consumer downloads, and leave the published
     bundle with no ceiling while the gate reported a number for it. */
  const entry = {
    '@domternal/source': './src/index.ts',
    import: { types: './dist/index.d.ts', default: './dist/index.js' },
  };
  assert.equal(runtimeTarget(entry), './dist/index.js');
});

test('an entry that resolves to nothing runnable is null rather than a guess', () => {
  assert.equal(runtimeTarget({ types: './dist/index.d.ts' }), null);
  assert.equal(runtimeTarget({ '@domternal/source': './src/index.ts' }), null);
  assert.equal(runtimeTarget(null), null);
  assert.equal(runtimeTarget(undefined), null);
});

test('a budget key is the package name, or the package and its subpath', () => {
  assert.equal(budgetKey('core', '.'), 'core');
  assert.equal(budgetKey('pm', './model'), 'pm/model');
  assert.equal(budgetKey('extension-export', './docx'), 'extension-export/docx');
});

test('runtime artifacts are the four a consumer loads as shipped', () => {
  for (const file of ['./a.js', './a.mjs', './a.cjs', './a.css']) {
    assert.equal(RUNTIME_ARTIFACT.test(file), true, file);
  }
  for (const file of ['./a.scss', './a.ts', './a.d.ts', './a.json']) {
    assert.equal(RUNTIME_ARTIFACT.test(file), false, file);
  }
});

test('the exports string shorthand is read as a single root entry', () => {
  assert.deepEqual(manifestEntries('thing', { exports: './dist/index.js' }), [
    { key: 'thing', target: './dist/index.js', measurable: true },
  ]);
});

test('an exports object is a subpath map only when its keys are subpaths', () => {
  assert.deepEqual(subpathMap('./dist/index.js'), { '.': './dist/index.js' });
  assert.deepEqual(subpathMap({ '.': './a.js', './b': './b.js' }), {
    '.': './a.js',
    './b': './b.js',
  });
  // Keys that are conditions describe the root, not twelve subpaths.
  assert.deepEqual(subpathMap({ import: './a.js', require: './a.cjs' }), {
    '.': { import: './a.js', require: './a.cjs' },
  });
});

test('an exports field with nothing in it yields no map', () => {
  for (const raw of [undefined, null, {}, [], 42]) {
    assert.equal(subpathMap(raw), null, JSON.stringify(raw));
  }
});

test('the conditions shorthand produces one root entry, not one key per condition', () => {
  /* Read as subpaths it would invent "thing/import" and "thing/require",
     fail on both as unbudgeted, and say nothing true about the package.
     No package here is written this way yet, which is the point: the
     entries this gate exists to catch are the ones not yet written. */
  assert.deepEqual(
    manifestEntries('thing', {
      exports: { import: './dist/index.js', require: './dist/index.cjs' },
    }),
    [{ key: 'thing', target: './dist/index.js', measurable: true }]
  );
});

test('publishConfig.exports wins over exports when a package rewrites it on publish', () => {
  const entries = manifestEntries('thing', {
    exports: { '.': './src/index.ts' },
    publishConfig: { exports: { '.': './dist/index.js' } },
  });
  assert.deepEqual(entries, [{ key: 'thing', target: './dist/index.js', measurable: true }]);
});

test('a private package publishes nothing and so is budgeted for nothing', () => {
  assert.deepEqual(manifestEntries('inside', { private: true, exports: './dist/index.js' }), []);
});

test('an entry that resolves to no file is a failure, not a silent skip', () => {
  /* The review's exact input. `require` plus `browser` is a legal map with
     neither an import nor a default condition, so the resolver returned null
     and the entry was dropped: not measured, not an alias, not a source, not
     unbudgeted. The package shipped with no ceiling and the gate printed OK.
     tests/ssr-import/check.mjs already failed on this shape, and the two gates
     disagreeing is how one of them ends up looking at nothing. */
  const entries = manifestEntries('newpkg', {
    exports: { '.': { require: './dist/index.cjs', browser: './dist/index.js' } },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].unresolved, true);
  assert.equal(entries[0].package, 'newpkg');
  assert.equal(entries[0].exportKey, '.');
  assert.match(entries[0].reason, /no runtime target/);
});

test('an unresolvable subpath names that subpath, not just the package', () => {
  const entries = manifestEntries('newpkg', {
    exports: { '.': './dist/index.js', './docx': { types: './dist/docx.d.ts' } },
  });
  const unresolved = entries.filter((entry) => entry.unresolved === true);
  assert.deepEqual(
    unresolved.map((entry) => [entry.package, entry.exportKey, entry.key]),
    [['newpkg', './docx', 'newpkg/docx']]
  );
});

test('a publishable package with no exports map fails rather than counting as nothing', () => {
  /* It still publishes, and a consumer still resolves it through `main`. Every
     gate here that asks what a package ships asks its exports map, so no map
     means no gate is looking, which is the state this one exists to end. */
  const entries = manifestEntries('thing', { main: './dist/index.js' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].unresolved, true);
  assert.match(entries[0].reason, /no exports map/);
});

test('an exports field that is not a map of entries fails the same way', () => {
  for (const raw of [null, {}, [], 42]) {
    const entries = manifestEntries('thing', { exports: raw });
    assert.equal(entries.length, 1, JSON.stringify(raw));
    assert.equal(entries[0].unresolved, true, JSON.stringify(raw));
    assert.match(entries[0].reason, /not a map of entries/);
  }
});

test('a private package is exempt, because it publishes nothing to budget', () => {
  assert.deepEqual(manifestEntries('inside', { private: true }), []);
  const hidden = { private: true, exports: { '.': { browser: './b.js' } } };
  assert.deepEqual(manifestEntries('inside', hidden), []);
});

test('the root entry is listed first whatever order the manifest uses', () => {
  /* Which key claims a shared file decides which one carries the budget, so
     a manifest listing ./css before . must not hand the budget to ./css. */
  const entries = manifestEntries('theme', {
    exports: { './css': './dist/t.css', '.': './dist/t.css', './scss': './src/index.scss' },
  });
  assert.equal(entries[0].key, 'theme');
});

test('source formats are kept but marked unmeasurable', () => {
  const entries = manifestEntries('theme', { exports: { './scss': './src/index.scss' } });
  assert.deepEqual(entries, [
    { key: 'theme/scss', target: './src/index.scss', measurable: false },
  ]);
});

test('an entry with no budget is reported, which is the whole point of the change', () => {
  const { unbudgeted, stale } = completeness(['core', 'theme'], { core: 80000 });
  assert.deepEqual(unbudgeted, ['theme']);
  assert.deepEqual(stale, []);
});

test('a budget key matching no entry is reported too', () => {
  const { unbudgeted, stale } = completeness(['core'], { core: 80000, 'extension-gone': 1000 });
  assert.deepEqual(unbudgeted, []);
  assert.deepEqual(stale, ['extension-gone']);
});

test('comment keys are prose, not budgets, and are in neither list', () => {
  const { unbudgeted, stale } = completeness(['core'], {
    $comment: 'why these numbers are what they are',
    '$comment-completeness': 'and why these ones were added',
    core: 80000,
  });
  assert.deepEqual(unbudgeted, []);
  assert.deepEqual(stale, []);
});

test('a suggested budget keeps about a tenth of headroom and lands on a round number', () => {
  assert.equal(suggestBudget(13992), 15500);
  assert.equal(suggestBudget(24650), 27500);
  assert.equal(suggestBudget(58), 70);
  for (const size of [54, 61, 2367, 13992, 78409]) {
    assert.ok(suggestBudget(size) >= size * 1.1, `${size} needs headroom`);
  }
});

test('discovery finds the three packages that had no ceiling before', () => {
  /* @domternal/theme is the one that mattered: dist/domternal-theme.css is
     loaded by every consumer and nothing capped it. */
  const { measured } = discoverEntries(repoRoot);
  const byKey = new Map(measured.map((entry) => [entry.key, entry]));
  assert.ok(byKey.get('theme').file.endsWith('packages/theme/dist/domternal-theme.css'));
  assert.ok(byKey.get('angular').file.endsWith('packages/angular/dist/fesm2022/domternal-angular.mjs'));
  assert.ok(byKey.get('pm/model').file.endsWith('packages/pm/src/model.js'));
});

test('every pm subpath is discovered on its own, none folded into a sum', () => {
  const { measured } = discoverEntries(repoRoot);
  const pm = measured.filter((entry) => entry.key.startsWith('pm/')).map((entry) => entry.key);
  assert.equal(pm.length, 12);
  assert.ok(pm.includes('pm/schema-list'));
  assert.ok(!measured.some((entry) => entry.key === 'pm'));
});

test('a wrapper resolves to its built bundle, not to the workspace TypeScript', () => {
  const { measured } = discoverEntries(repoRoot);
  for (const key of ['core', 'react', 'vue', 'vanilla']) {
    const entry = measured.find((candidate) => candidate.key === key);
    assert.equal(entry.target, './dist/index.js', key);
  }
});

test('one file under two export keys is measured once, under the root key', () => {
  const { measured, aliases } = discoverEntries(repoRoot);
  assert.equal(measured.filter((entry) => entry.key === 'theme/css').length, 0);
  assert.deepEqual(
    aliases.map((alias) => [alias.key, alias.of]),
    [['theme/css', 'theme']]
  );
});

test('the Sass barrel is named as skipped rather than dropped in silence', () => {
  const { sources } = discoverEntries(repoRoot);
  assert.deepEqual(
    sources.map((source) => source.key),
    ['theme/scss']
  );
});

test('a stray file in packages/ is not mistaken for a package', () => {
  /* packages/.DS_Store exists on this machine. Reading it as a package
     directory would throw before a single size was measured. */
  assert.doesNotThrow(() => discoverEntries(repoRoot));
});

test('every entry in this repository lands in one of the four lists', () => {
  /* The gate's OK is only worth reading if nothing fell out of discovery on
     the way, so the real tree is asserted to have no unresolved entries. */
  assert.deepEqual(discoverEntries(repoRoot).unresolved, []);
});

test('discovery routes an unresolvable package to unresolved, not out of the run', () => {
  /* End to end over a real directory, because the skip that hid this entry was
     in discovery rather than in the resolver. */
  const root = mkdtempSync(join(tmpdir(), 'bundle-size-'));
  try {
    const packageDir = join(root, 'packages', 'newpkg');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@domternal/newpkg',
        exports: { '.': { require: './dist/index.cjs', browser: './dist/index.js' } },
      })
    );
    const { measured, aliases, sources, unresolved } = discoverEntries(root);
    assert.deepEqual([measured, aliases, sources], [[], [], []]);
    assert.deepEqual(
      unresolved.map((entry) => [entry.package, entry.exportKey]),
      [['newpkg', '.']]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
