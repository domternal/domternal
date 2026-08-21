/**
 * Fixture tests for the manifest policy gate and the publish transform it runs.
 *
 * The transform is the only code between a working tree and npm, and npm is a
 * place nothing can be taken back from: a wrong floor or a dangling export
 * condition is public the moment it lands. So its behaviour is pinned here on
 * hand-written manifests rather than only on the eighteen real ones, which all
 * happen to be correct and would therefore prove nothing about the failures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STYLE_IMPORT,
  discoverPublishablePackages,
  installedVersion,
  lockstepViolations,
  packageFailures,
  peerRangeFailures,
  requiredNodeFloor,
} from './check.mjs';
import {
  exportTargets,
  preparePublishManifest,
  publishBlockers,
  versionFloor,
} from '../../scripts/prepare-publish-manifest.mjs';

/** A throwaway packages/ directory built from `{ dirName: manifest }`. */
function packagesFixture(entries) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-policy-'));
  for (const [name, manifest] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'package.json'), JSON.stringify(manifest, null, 2));
  }
  return root;
}

test('discovery refuses a publishable package outside the scope', () => {
  /* The whole point of discovering rather than listing. A filter here would
     drop the stray package from every check and still print OK. */
  const root = packagesFixture({ stray: { name: 'domternal-core', version: '0.15.0' } });
  assert.throws(() => discoverPublishablePackages(root), /must be named @domternal\//);
  rmSync(root, { recursive: true, force: true });
});

test('discovery skips private packages and anything that is not a directory', () => {
  const root = packagesFixture({
    core: { name: '@domternal/core', version: '0.15.0' },
    fixture: { name: 'internal-fixture', version: '0.0.0', private: true },
  });
  writeFileSync(join(root, '.DS_Store'), 'not a package');
  const found = discoverPublishablePackages(root).map(({ manifest }) => manifest.name);
  assert.deepEqual(found, ['@domternal/core']);
  rmSync(root, { recursive: true, force: true });
});

test('discovery refuses two directories claiming the same package name', () => {
  const root = packagesFixture({
    core: { name: '@domternal/core', version: '0.15.0' },
    'core-copy': { name: '@domternal/core', version: '0.15.0' },
  });
  assert.throws(() => discoverPublishablePackages(root), /duplicate publishable package/);
  rmSync(root, { recursive: true, force: true });
});

test('lockstep reports the buckets, not just that they exist', () => {
  assert.deepEqual(lockstepViolations([{ name: 'a', version: '1.0.0' }]), []);
  assert.deepEqual(
    lockstepViolations([
      { name: '@domternal/core', version: '0.15.0' },
      { name: '@domternal/pm', version: '0.15.0' },
      { name: '@domternal/extension-toc', version: '0.16.0' },
    ]),
    ['0.15.0: @domternal/core, @domternal/pm', '0.16.0: @domternal/extension-toc']
  );
});

test('the floor is the minor, so a patch release does not move it', () => {
  assert.equal(versionFloor('0.15.0'), '>=0.15.0');
  /* 0.12.1 shipped with floors at >=0.12.0. Deriving >=VERSION instead would
     have declared that release incompatible with its own minor. */
  assert.equal(versionFloor('0.12.1'), '>=0.12.0');
  assert.equal(versionFloor('1.4.17'), '>=1.4.0');
  assert.throws(() => versionFloor('next'), /not a plain MAJOR\.MINOR\.PATCH/);
});

test('a prerelease is refused rather than reduced to its release part', () => {
  /* `1.0.0-rc.1` would otherwise derive `>=1.0.0`, and semver ranges exclude
     prereleases: the whole workspace would publish at 1.0.0-rc.1 declaring a
     floor that 1.0.0-rc.1 does not satisfy, so installing the rc would fail
     with ETARGET until a stable 1.0.0 existed. Both gates would stay green
     while that happened, which is why it is refused here. */
  assert.throws(() => versionFloor('1.0.0-rc.1'), /decided by hand/);
  assert.throws(() => versionFloor('2.0.0-0'), /decided by hand/);
  assert.throws(() => versionFloor('0.16.0+build.5'), /decided by hand/);
});

test('the transform drops devDependencies and pins only the workspace protocol', () => {
  const { prepared, changes } = preparePublishManifest({
    name: '@domternal/core',
    version: '0.15.0',
    dependencies: { '@domternal/pm': 'workspace:*', linkifyjs: '^4.3.2' },
    devDependencies: { typescript: '~5.9.3' },
  });
  assert.equal(prepared.devDependencies, undefined);
  assert.deepEqual(prepared.dependencies, { '@domternal/pm': '>=0.15.0', linkifyjs: '^4.3.2' });
  assert.deepEqual(changes, ['dropped devDependencies', 'pinned @domternal/pm to >=0.15.0']);
});

test('the transform strips the dev-source condition wherever it sits', () => {
  const { prepared } = preparePublishManifest({
    name: '@domternal/core',
    version: '0.15.0',
    exports: {
      '.': {
        '@domternal/source': './src/index.ts',
        import: { types: './dist/index.d.ts', default: './dist/index.js' },
      },
      './nested': { browser: { '@domternal/source': './src/nested.ts', default: './dist/n.js' } },
    },
  });
  assert.deepEqual(prepared.exports, {
    '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' } },
    './nested': { browser: { default: './dist/n.js' } },
  });
});

test('the transform leaves a manifest it has already prepared alone', () => {
  /* postpublish restores the file with git, but a publish that dies between the
     two leaves a prepared manifest on disk. Running it again must not turn
     ">=0.15.0" into something else or report changes it did not make. */
  const source = {
    name: '@domternal/core',
    version: '0.15.0',
    dependencies: { '@domternal/pm': 'workspace:*' },
    exports: { '.': { '@domternal/source': './src/index.ts', default: './dist/index.js' } },
  };
  const once = preparePublishManifest(source).prepared;
  const twice = preparePublishManifest(once);
  assert.deepEqual(twice.prepared, once);
  assert.deepEqual(twice.changes, []);
});

test('every exports target is found, at any depth and under any condition', () => {
  assert.deepEqual(
    exportTargets({
      '.': { import: { types: './a.d.ts', default: './a.js' }, require: './a.cjs' },
      './css': './dist/theme.css',
    }),
    ['./a.d.ts', './a.js', './a.cjs', './dist/theme.css']
  );
});

test('a surviving workspace specifier blocks the publish', () => {
  /* workspace:^ is not rewritten, deliberately: only the form this repo uses is
     understood, and an unfamiliar one must stop the publish rather than reach
     npm as a literal no consumer can resolve. */
  const blockers = publishBlockers({
    name: '@domternal/probe',
    version: '0.15.0',
    dependencies: { '@domternal/core': 'workspace:^' },
  });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /workspace protocol/);
});

test('an exports target that is missing, or that files does not ship, blocks the publish', () => {
  const root = mkdtempSync(join(tmpdir(), 'domternal-blockers-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.js'), '');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), '');

  const manifest = {
    name: '@domternal/probe',
    version: '0.15.0',
    files: ['dist'],
    exports: {
      '.': { default: './dist/index.js' },
      './source': './src/index.ts',
      './gone': './dist/missing.js',
    },
  };
  const blockers = publishBlockers(manifest, root);
  assert.deepEqual(blockers.sort(), [
    'the manifest points at ./dist/missing.js, which does not exist',
    'the manifest points at ./src/index.ts, which "files" does not ship',
  ]);

  /* The legacy fields are judged too. Nothing here uses `main` today, but a
     resolver that has not implemented exports reads it, and a dangling one
     fails exactly as hard. */
  assert.deepEqual(publishBlockers({ ...manifest, exports: undefined, main: './dist/gone.js' }, root), [
    'the manifest points at ./dist/gone.js, which does not exist',
  ]);

  /* The shipped case: src/index.ts exists here, so only "files" separates a
     working consumer from ERR_MODULE_NOT_FOUND. That distinction is the whole
     reason this check reads both. */
  assert.deepEqual(publishBlockers({ ...manifest, exports: { '.': './dist/index.js' } }, root), []);
  rmSync(root, { recursive: true, force: true });
});

test('a package whose floors did not move with its version is reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'domternal-failures-'));
  writeFileSync(join(root, 'LICENSE'), 'MIT');
  const failures = packageFailures(
    {
      directory: root,
      name: 'extension-toc',
      manifest: {
        name: '@domternal/extension-toc',
        version: '0.16.0',
        license: 'MIT',
        description: 'd',
        author: 'a',
        homepage: 'h',
        bugs: { url: 'u' },
        keywords: ['k'],
        sideEffects: false,
        files: ['LICENSE'],
        repository: { directory: 'packages/extension-toc' },
        peerDependencies: { '@domternal/core': '>=0.15.0' },
        scripts: { prepublishOnly: 'x', postpublish: 'y' },
      },
    },
    new Set(['@domternal/core']),
    'MIT'
  );
  assert.ok(
    failures.some((failure) => /peerDependencies\.@domternal\/core is ">=0\.15\.0"/.test(failure)),
    failures.join('\n')
  );
  rmSync(root, { recursive: true, force: true });
});

test('the Node floor is read from .nvmrc, not written into the gate', () => {
  assert.equal(requiredNodeFloor('22\n'), '>=22');
  assert.equal(requiredNodeFloor('v24'), '>=24');
  assert.equal(requiredNodeFloor('  20.11.0  '), '>=20');
  assert.throws(() => requiredNodeFloor('lts/*'), /does not name a Node major/);
});

test('a package whose engines.node disagrees with .nvmrc is reported', () => {
  /* The exact drift this closes: twelve packages said >=20 while everything was
     tested on 22, and six said nothing at all. Both shapes must fail. */
  const root = mkdtempSync(join(tmpdir(), 'domternal-engines-'));
  writeFileSync(join(root, 'LICENSE'), 'MIT');
  const base = {
    name: '@domternal/probe',
    version: '0.15.0',
    license: 'MIT',
    description: 'd',
    author: 'a',
    homepage: 'h',
    bugs: { url: 'u' },
    keywords: ['k'],
    sideEffects: false,
    files: ['LICENSE'],
    repository: { directory: 'packages/probe' },
    scripts: {
      prepublishOnly: 'node ../../scripts/prepare-publish-manifest.mjs',
      postpublish: 'git checkout package.json',
    },
  };
  const run = (engines) =>
    packageFailures(
      { directory: root, name: 'probe', manifest: { ...base, ...(engines ? { engines } : {}) } },
      new Set(),
      'MIT',
      '>=22'
    ).filter((failure) => failure.includes('engines.node'));

  assert.deepEqual(run({ node: '>=22' }), []);
  assert.match(run({ node: '>=20' })[0], /is ">=20", expected ">=22"/);
  assert.match(run(undefined)[0], /is undefined, expected ">=22"/);
  /* A range that merely overlaps is still a mismatch: the point is that the
     declaration and the tested version are the same statement. */
  assert.equal(run({ node: '^22.12.0 || >=24' }).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('a peer range that excludes the version this repository tests is reported', () => {
  /* The ranges nothing was checking: react >=18, katex ^0.16.0 || ^0.17.0, the
     three @angular/* at >=17.1.0. A range promising versions nobody here runs
     can only honestly be held to one thing, that it admits the version we do
     run, and a range excluding that is contradicted by our own CI. */
  const root = mkdtempSync(join(tmpdir(), 'domternal-peers-'));
  mkdirSync(join(root, 'node_modules', 'katex'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules', 'katex', 'package.json'),
    JSON.stringify({ name: 'katex', version: '0.17.0' })
  );
  const entry = (peer, dev) => ({
    directory: root,
    manifest: {
      name: '@domternal/extension-math',
      peerDependencies: { '@domternal/core': '>=0.15.0', katex: peer },
      devDependencies: dev === null ? {} : { katex: dev },
    },
  });

  assert.deepEqual(peerRangeFailures(entry('^0.16.0 || ^0.17.0', '^0.17.0')), []);
  assert.match(
    peerRangeFailures(entry('^0.16.0', '^0.17.0'))[0],
    /is "\^0\.16\.0", which excludes the 0\.17\.0 this repository builds and tests against/
  );
  assert.match(peerRangeFailures(entry('^0.17.0', null))[0], /not in devDependencies/);
  /* An in-scope peer is judged by the floor rule instead, not here, so it must
     not be double-reported. */
  assert.equal(
    peerRangeFailures(entry('^0.17.0', '^0.17.0')).filter((f) => f.includes('@domternal/core'))
      .length,
    0
  );
  rmSync(root, { recursive: true, force: true });
});

test('an installed version is found even when the package hides its own manifest', () => {
  /* lowlight restricts its exports map, so require.resolve throws
     ERR_PACKAGE_PATH_NOT_EXPORTED for its package.json and the peer would read
     as "not installed" while sitting right there in node_modules. */
  const root = mkdtempSync(join(tmpdir(), 'domternal-installed-'));
  const nested = join(root, 'packages', 'probe');
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(root, 'node_modules', '@scope', 'pkg'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules', '@scope', 'pkg', 'package.json'),
    JSON.stringify({ name: '@scope/pkg', version: '2.3.4', exports: { '.': './index.js' } })
  );
  /* Found by walking up from the package, the way pnpm's per-package trees
     require, and a scoped name is split into its two path segments. */
  assert.equal(installedVersion(nested, '@scope/pkg'), '2.3.4');
  assert.equal(installedVersion(nested, 'absent'), null);
  rmSync(root, { recursive: true, force: true });
});

test('a stylesheet import is recognised, and an ordinary import is not', () => {
  assert.equal(STYLE_IMPORT.exec("import './styles.css';")?.[1], './styles.css');
  assert.equal(STYLE_IMPORT.exec('import styles from "./a.scss";')?.[1], './a.scss');
  assert.equal(STYLE_IMPORT.exec("import { Editor } from './Editor.js';"), null);
  /* A path that merely mentions a stylesheet extension inside a longer name is
     not an import of one. */
  assert.equal(STYLE_IMPORT.exec("import './cssHelpers.js';"), null);
});
