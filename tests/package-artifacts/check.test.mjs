/**
 * Fixture tests for the tarball policy gate.
 *
 * Packing eighteen real packages takes eight seconds and proves only that today
 * is fine. What has to be right is the judgement: an allowlist that quietly
 * stops being one, a required file that is not really required, an exports
 * target checked against the wrong file list. Those are exercised here on
 * archives built by hand, including the archive shapes npm would happily
 * unpack and this repository never produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compilePolicy,
  fileFailures,
  loadPolicy,
  manifestFailures,
  packedFiles,
  policyGaps,
} from './check.mjs';

/** Builds package/<files> into a .tgz and returns its path. */
function tarballOf(files, extra) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-tar-'));
  const stage = join(root, 'package');
  mkdirSync(stage);
  for (const [name, content] of Object.entries(files)) {
    const target = join(stage, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  if (extra !== undefined) extra(stage);
  const tarball = join(root, 'probe.tgz');
  const result = spawnSync('tar', ['-czf', tarball, '-C', root, 'package'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { root, tarball };
}

test('a package with no policy entry, and an entry naming no package, both fail', () => {
  const policy = new Map([
    ['@domternal/core', {}],
    ['@domternal/gone', {}],
  ]);
  assert.deepEqual(policyGaps(['@domternal/core', '@domternal/new'], policy), [
    '@domternal/new has no entry in policy.json, so nothing bounds what it publishes',
    'policy.json still describes @domternal/gone, which is no longer published',
  ]);
});

test('an unanchored pattern is refused, because it would stop being an allowlist', () => {
  const base = { maxPackedBytes: 1000, requiredFiles: [], allowedPatterns: [] };
  assert.throws(
    () => compilePolicy('probe', { ...base, allowedPatterns: ['dist/'] }),
    /anchored with \^ and \$/
  );
  assert.throws(
    () => compilePolicy('probe', { ...base, allowedPatterns: ['^dist/.*'] }),
    /anchored with \^ and \$/
  );
  assert.doesNotThrow(() => compilePolicy('probe', { ...base, allowedPatterns: ['^dist/a\\.js$'] }));
});

test('a policy that would bound nothing is refused', () => {
  assert.throws(() => compilePolicy('probe', undefined), /no policy entry/);
  assert.throws(
    () => compilePolicy('probe', { maxPackedBytes: 0, requiredFiles: [], allowedPatterns: [] }),
    /positive integer/
  );
  assert.throws(
    () => compilePolicy('probe', { maxPackedBytes: 10, requiredFiles: ['a', 'a'], allowedPatterns: [] }),
    /duplicate/
  );
});

test('the shipped policy compiles for every package it describes', () => {
  const policy = loadPolicy();
  for (const [name, entry] of policy) assert.doesNotThrow(() => compilePolicy(name, entry));
  assert.ok(policy.size >= 17, `expected every package to be described, got ${String(policy.size)}`);
});

test('a missing required file and a file nothing allows are both named', () => {
  const entry = { requiredFiles: ['LICENSE', 'package.json'], allowedPatterns: ['^dist/index\\.js$'] };
  const patterns = entry.allowedPatterns.map((pattern) => new RegExp(pattern));
  assert.deepEqual(fileFailures(['LICENSE', 'package.json', 'dist/index.js'], entry, patterns), []);
  const failures = fileFailures(['package.json', 'dist/index.js', 'dist/.env'], entry, patterns);
  assert.equal(failures.length, 2);
  assert.match(failures[0], /missing required files: LICENSE/);
  assert.match(failures[1], /files nothing allows: dist\/\.env/);
});

test('the file list is read from the archive, and an unsafe archive is refused', () => {
  const { root, tarball } = tarballOf({ 'package.json': '{}', 'dist/index.js': '' });
  assert.deepEqual(packedFiles(tarball, root), ['dist/index.js', 'package.json']);
  rmSync(root, { recursive: true, force: true });

  /* npm unpacks whatever is in the archive. Nothing this build produces could
     contain a symlink, which is exactly why it costs nothing to refuse one. */
  const linked = tarballOf({ 'package.json': '{}' }, (stage) => {
    symlinkSync('/etc/passwd', join(stage, 'secrets'));
  });
  assert.throws(() => packedFiles(linked.tarball, linked.root), /other than files and directories/);
  rmSync(linked.root, { recursive: true, force: true });
});

test('the exports of the PUBLISHED manifest are resolved against the tarball', () => {
  /* The 0.15.0 shape: the dev-source condition first in the map, dist-only in
     the tarball. It must pass, because the publish transform removes the
     condition before npm ever sees it. */
  const source = { name: '@domternal/core', version: '0.15.0' };
  const packed = {
    name: '@domternal/core',
    version: '0.15.0',
    license: 'MIT',
    files: ['dist'],
    exports: {
      '.': {
        '@domternal/source': './src/index.ts',
        import: { types: './dist/index.d.ts', default: './dist/index.js' },
      },
    },
  };
  const files = ['dist/index.d.ts', 'dist/index.js', 'package.json'];
  assert.deepEqual(manifestFailures(source, packed, files), []);

  /* A condition the transform does NOT know about, pointing at the same file,
     is the failure the transform cannot fix and this check must catch. */
  const leaking = {
    ...packed,
    exports: { '.': { browser: './src/index.ts', import: './dist/index.js' } },
  };
  const failures = manifestFailures(source, leaking, files);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /\.\/src\/index\.ts, which is not in the tarball/);
});

test('a repacked name, version or license is caught', () => {
  const source = { name: '@domternal/core', version: '0.15.0' };
  const failures = manifestFailures(
    source,
    { name: '@domternal/core-2', version: '0.14.0', license: 'ISC' },
    ['package.json']
  );
  assert.deepEqual(failures, [
    'packed name is @domternal/core-2',
    'packed version is 0.14.0',
    'packed license is ISC',
  ]);
});

test('a workspace specifier the publish transform cannot resolve is caught', () => {
  const source = { name: '@domternal/core', version: '0.15.0' };
  const base = { ...source, license: 'MIT' };

  /* workspace:* is understood: the transform turns it into the floor, which is
     what the published manifest carries, so it is not a failure here. */
  assert.deepEqual(
    manifestFailures(source, { ...base, dependencies: { '@domternal/pm': 'workspace:*' } }, [
      'package.json',
    ]),
    []
  );

  /* Any other workspace form is not rewritten, deliberately, and would reach a
     consumer as a literal nothing can resolve. */
  const failures = manifestFailures(
    source,
    { ...base, dependencies: { '@domternal/pm': 'workspace:^' } },
    ['package.json']
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /workspace protocol/);
});
