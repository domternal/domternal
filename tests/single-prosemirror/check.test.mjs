/**
 * Fixture tests for the lockfile parser behind the single-copy gate.
 *
 * The gate's whole value is that it fails on a real duplicate and stays quiet
 * otherwise, so the parser is exercised against hand-written lockfile shapes:
 * scoped names, peer-suffixed keys, the `snapshots:` section that must NOT be
 * counted, and the exact duplicate that shipped in this repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePackageKey,
  collectVersions,
  findDuplicates,
  IDENTITY_SENSITIVE,
  LOCKFILES,
} from './check.mjs';

test('parsePackageKey splits an unscoped name', () => {
  assert.deepEqual(parsePackageKey('prosemirror-model@1.25.11'), {
    pkg: 'prosemirror-model',
    version: '1.25.11',
  });
});

test('parsePackageKey splits a scoped name on the LAST @', () => {
  assert.deepEqual(parsePackageKey('@domternal/core@0.15.0'), {
    pkg: '@domternal/core',
    version: '0.15.0',
  });
});

test('parsePackageKey drops a pnpm peer suffix', () => {
  assert.deepEqual(parsePackageKey('y-prosemirror@1.3.7_prosemirror-model@1.25.11'), {
    pkg: 'y-prosemirror',
    version: '1.3.7',
  });
});

test('parsePackageKey drops a parenthesised peer context', () => {
  assert.deepEqual(parsePackageKey('y-protocols@1.0.7(yjs@13.6.32)'), {
    pkg: 'y-protocols',
    version: '1.0.7',
  });
});

test('parsePackageKey rejects a key with no version', () => {
  assert.equal(parsePackageKey('prosemirror-model'), null);
  assert.equal(parsePackageKey('@domternal/core'), null);
  assert.equal(parsePackageKey(''), null);
});

const LOCK_CLEAN = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      prosemirror-model:
        specifier: ^1.25.11
        version: 1.25.11

packages:

  prosemirror-model@1.25.11:
    resolution: {integrity: sha512-aaa}

  prosemirror-state@1.4.4:
    resolution: {integrity: sha512-bbb}

  '@domternal/core@0.15.0':
    resolution: {integrity: sha512-ccc}

snapshots:

  prosemirror-model@1.25.11: {}
`;

test('a clean lockfile reports one version per package and no duplicates', () => {
  const versions = collectVersions(LOCK_CLEAN);
  assert.equal(versions.get('prosemirror-model').size, 1);
  assert.equal(versions.get('prosemirror-state').size, 1);
  assert.deepEqual(findDuplicates(versions), []);
});

test('quoted scoped keys are parsed, so @domternal/* is not silently skipped', () => {
  // pnpm quotes any key starting with @; an unquoted-only regex would miss
  // every scoped package and the gate would pass while core was duplicated.
  const versions = collectVersions(LOCK_CLEAN.replace("'@domternal/core@0.15.0'", '"@domternal/core@0.15.0"'));
  assert.ok(versions.has('@domternal/core'));
});

const LOCK_DUPLICATE = `lockfileVersion: '9.0'

packages:

  prosemirror-model@1.25.11:
    resolution: {integrity: sha512-aaa}

  prosemirror-model@1.25.4:
    resolution: {integrity: sha512-bbb}

  prosemirror-view@1.42.2:
    resolution: {integrity: sha512-ccc}

  prosemirror-view@1.41.5:
    resolution: {integrity: sha512-ddd}

snapshots:

  prosemirror-model@1.25.11: {}
`;

test('the duplicate this repo actually shipped is reported', () => {
  const duplicates = findDuplicates(collectVersions(LOCK_DUPLICATE));
  assert.deepEqual(duplicates, [
    { pkg: 'prosemirror-model', versions: ['1.25.11', '1.25.4'] },
    { pkg: 'prosemirror-view', versions: ['1.41.5', '1.42.2'] },
  ]);
});

test('duplicates come back sorted by package, so the report is stable', () => {
  const [first, second] = findDuplicates(collectVersions(LOCK_DUPLICATE));
  assert.ok(first.pkg < second.pkg);
});

const LOCK_SNAPSHOT_ONLY_REPEAT = `lockfileVersion: '9.0'

packages:

  y-prosemirror@1.3.7:
    resolution: {integrity: sha512-aaa}

snapshots:

  y-prosemirror@1.3.7(prosemirror-model@1.25.11)(yjs@13.6.32): {}

  y-prosemirror@1.3.7(prosemirror-model@1.25.4)(yjs@13.6.32): {}
`;

test('repeated snapshot entries are not counted as separate copies', () => {
  // One physical copy resolved under two peer contexts is still one copy;
  // counting `snapshots:` would fail the gate on a perfectly fine tree.
  const versions = collectVersions(LOCK_SNAPSHOT_ONLY_REPEAT);
  assert.equal(versions.get('y-prosemirror').size, 1);
  assert.deepEqual(findDuplicates(versions), []);
});

test('packages outside the watch list are ignored', () => {
  const lock = `lockfileVersion: '9.0'

packages:

  lodash@4.17.20:
    resolution: {integrity: sha512-aaa}

  lodash@4.17.21:
    resolution: {integrity: sha512-bbb}
`;
  assert.deepEqual(findDuplicates(collectVersions(lock)), []);
});

test('a lockfile with no packages section yields nothing rather than throwing', () => {
  assert.equal(collectVersions("lockfileVersion: '9.0'\n").size, 0);
  assert.equal(collectVersions('').size, 0);
});

test('nested keys deeper than two spaces are not mistaken for packages', () => {
  const lock = `lockfileVersion: '9.0'

packages:

  prosemirror-model@1.25.11:
    resolution: {integrity: sha512-aaa}
    engines:
      prosemirror-model@1.25.4:
`;
  assert.equal(collectVersions(lock).get('prosemirror-model').size, 1);
});

test('the watch list covers every module the stack compares by identity', () => {
  for (const pkg of [
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-transform',
    'prosemirror-tables',
    'yjs',
    'y-prosemirror',
    'y-protocols',
    '@domternal/core',
    '@domternal/pm',
  ]) {
    assert.ok(IDENTITY_SENSITIVE.includes(pkg), `${pkg} must be watched`);
  }
});

test('both lockfiles are checked, including the one the site deploys from', () => {
  assert.ok(LOCKFILES.includes('pnpm-lock.yaml'));
  assert.ok(LOCKFILES.includes('domternal.dev/pnpm-lock.yaml'));
});
