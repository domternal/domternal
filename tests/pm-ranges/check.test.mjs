/**
 * Fixture tests for the range-agreement gate.
 *
 * The gate guards a failure that arrives once every few years and takes every
 * consumer with it, so its own logic has to be right the first time it matters:
 * there is no gradual signal, and by the time a lockfile shows two versions the
 * release is already out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCKFILES,
  STORES,
  caretsCanAgree,
  collectInstalled,
  compare,
  discoverSharers,
  findPm,
  parseCaret,
  parseStoreEntry,
  prosemirrorPeers,
} from './check.mjs';

test('a caret range is read into a major and a floor', () => {
  assert.deepEqual(parseCaret('^1.25.4'), { major: 1, floor: [1, 25, 4] });
  assert.deepEqual(parseCaret(' ^2.0.0 '), { major: 2, floor: [2, 0, 0] });
});

test('anything that is not a plain caret is refused rather than guessed at', () => {
  /* A range this check cannot read is a range it cannot vouch for, and
     silently passing one would be worse than not checking at all. */
  for (const range of ['~1.2.3', '>=1.2.3', '1.2.3', '^1.2', '1.x', '*']) {
    assert.equal(parseCaret(range), null, range);
  }
});

test('two carets in one major can always be satisfied together', () => {
  // Today's real pair: @domternal/pm ships ^1.25.4, y-prosemirror asks ^1.7.1.
  assert.equal(caretsCanAgree('^1.25.4', '^1.7.1'), true);
  assert.equal(caretsCanAgree('^1.4.4', '^1.2.3'), true);
});

test('two carets in different majors can never be', () => {
  /* The failure this exists for. Nothing warns at install time: the package
     manager simply installs both, and ProseMirror throws on the first
     document. */
  assert.equal(caretsCanAgree('^2.0.0', '^1.7.1'), false);
  assert.equal(caretsCanAgree('^1.7.1', '^2.0.0'), false);
});

test('an unreadable range on either side is reported, not assumed to be fine', () => {
  assert.equal(caretsCanAgree('>=1.7.1', '^1.7.1'), null);
  assert.equal(caretsCanAgree('^1.7.1', '1.x'), null);
});

test('a disagreement names both declarations and the module', () => {
  const problems = compare(
    { dependencies: { 'prosemirror-model': '^2.0.0' } },
    { name: 'y-prosemirror', peers: { 'prosemirror-model': '^1.7.1' } }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /prosemirror-model/);
  assert.match(problems[0], /\^2\.0\.0/);
  assert.match(problems[0], /\^1\.7\.1/);
});

test('a module only one side names is not a disagreement', () => {
  /* y-prosemirror peers on yjs and y-protocols too, which @domternal/pm does
     not ship at all. Reporting those would be noise, and noise is how a gate
     gets switched off. */
  const problems = compare(
    { dependencies: { 'prosemirror-model': '^1.25.4' } },
    { name: 'y-prosemirror', peers: { 'prosemirror-model': '^1.7.1' } }
  );
  assert.deepEqual(problems, []);
});

test('an unreadable range is reported with both sides quoted', () => {
  const problems = compare(
    { dependencies: { 'prosemirror-state': '>=1.4.4' } },
    { name: 'y-prosemirror', peers: { 'prosemirror-state': '^1.2.3' } }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /only understands caret ranges/);
});

test('a store directory name is split into package and version', () => {
  assert.deepEqual(parseStoreEntry('y-prosemirror@1.3.7'), {
    name: 'y-prosemirror',
    version: '1.3.7',
  });
  // A peer-context suffix follows the version and must not become part of it.
  assert.deepEqual(parseStoreEntry('y-prosemirror@1.3.7_prosemirror-model@1.25.11_x'), {
    name: 'y-prosemirror',
    version: '1.3.7',
  });
  assert.deepEqual(parseStoreEntry('y-prosemirror@1.3.7(yjs@13.6.32)'), {
    name: 'y-prosemirror',
    version: '1.3.7',
  });
  // A scoped name carries its slash as a plus.
  assert.deepEqual(parseStoreEntry('@domternal+pm@0.15.0'), {
    name: '@domternal/pm',
    version: '0.15.0',
  });
});

test('a directory that is not a store entry is ignored rather than guessed at', () => {
  assert.equal(parseStoreEntry('node_modules'), null);
  assert.equal(parseStoreEntry('lock.yaml'), null);
});

test('only prosemirror peers count as sharing', () => {
  /* y-prosemirror peers on yjs and y-protocols too. Those matter elsewhere but
     not here: this gate is about the packages @domternal/pm ships. */
  assert.deepEqual(
    prosemirrorPeers({ peerDependencies: { 'prosemirror-model': '^1.7.1', yjs: '^13.5.38' } }),
    { 'prosemirror-model': '^1.7.1' }
  );
  assert.equal(prosemirrorPeers({ peerDependencies: { yjs: '^13.5.38' } }), null);
  assert.equal(prosemirrorPeers({}), null);
});

test('the installed set is read from the lockfile, not from the store', () => {
  /* A pnpm store keeps orphaned directories after a dedupe. Judging a
     declaration nothing installs would be a false alarm, and a false alarm is
     how a gate gets switched off. */
  const lockfile = [
    'packages:',
    '  y-prosemirror@1.3.7:',
    '    resolution: {}',
    "  '@domternal/pm@0.15.0':",
    '    resolution: {}',
    'snapshots:',
    '  y-prosemirror@1.3.7(yjs@13.6.32):',
  ].join('\n');
  const installed = collectInstalled(lockfile);
  assert.ok(installed.has('y-prosemirror@1.3.7'));
  assert.ok(installed.has('@domternal/pm@0.15.0'));
  assert.ok(!installed.has('y-prosemirror@1.2.0'));
});

test('every nested project is scanned, not just this one', () => {
  /* Our package meets a sharer in each installed tree, and the site deploys
     from its own. Missing paths are skipped, so one list serves both
     repositories. */
  assert.ok(STORES.includes('node_modules/.pnpm'));
  assert.ok(STORES.some((path) => path.startsWith('domternal.dev/')));
  assert.ok(STORES.some((path) => path.startsWith('domternal-pro/')));
  assert.equal(STORES.length, LOCKFILES.length);
});

test('discovery reads the pnpm store, not node_modules/<name>', () => {
  /* The regression that prompted this: the first version of the gate looked
     only at `node_modules/<name>`, found nothing in the repository where
     @domternal/pm is actually edited, and printed SKIPPED. Built here rather
     than read off this checkout, because the store that holds a sharer belongs
     to a nested repository a public clone and CI do not have. */
  const root = mkdtempSync(join(tmpdir(), 'pm-ranges-'));
  try {
    const inStore = join(root, 'node_modules', '.pnpm', 'y-prosemirror@1.3.7');
    mkdirSync(join(inStore, 'node_modules', 'y-prosemirror'), { recursive: true });
    writeFileSync(
      join(inStore, 'node_modules', 'y-prosemirror', 'package.json'),
      JSON.stringify({
        name: 'y-prosemirror',
        peerDependencies: { 'prosemirror-model': '^1.7.1', yjs: '^13.5.38' },
      })
    );
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'packages:\n  y-prosemirror@1.3.7:\n');
    assert.deepEqual(discoverSharers(root), [
      { name: 'y-prosemirror', version: '1.3.7', peers: { 'prosemirror-model': '^1.7.1' } },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a sharer this checkout installs is discovered, not skipped past', (t) => {
  /* Only the nested repositories install one, so on a public clone and in CI
     there is nothing to find and nothing to prove. The lockfiles say which
     case this is, and being installed while going undiscovered is the whole
     regression. */
  const installsSharer = LOCKFILES.map((rel) => join(process.cwd(), rel))
    .filter((path) => existsSync(path))
    .some((path) =>
      [...collectInstalled(readFileSync(path, 'utf8'))].some((key) =>
        key.startsWith('y-prosemirror@')
      )
    );
  if (!installsSharer) {
    t.skip('nothing installed in this checkout takes ProseMirror as a peer');
    return;
  }
  const sharer = discoverSharers(process.cwd()).find((one) => one.name === 'y-prosemirror');
  assert.ok(sharer, 'y-prosemirror is installed here, but discovery missed it');
  assert.ok(sharer.peers['prosemirror-model']);
});

test('the pm being judged is this workspace source where there is one', () => {
  const pm = findPm(process.cwd());
  assert.ok(pm, '@domternal/pm not found');
  assert.equal(pm.json.name, '@domternal/pm');
  // Every module a sharer can ask for must be declared, or the comparison
  // would quietly have nothing to compare.
  for (const module of ['prosemirror-model', 'prosemirror-state', 'prosemirror-view']) {
    assert.ok(pm.json.dependencies[module], `${module} must be declared`);
  }
});

test('the real declarations in this checkout agree today', () => {
  // The assertion the gate itself makes, kept here so a bump that breaks it
  // fails the unit run too rather than only the gate.
  const pm = findPm(process.cwd());
  for (const sharer of discoverSharers(process.cwd())) {
    assert.deepEqual(compare(pm.json, sharer), [], `${sharer.name} disagrees`);
  }
});
