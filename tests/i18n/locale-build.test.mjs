import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { buildLocales, checkLocaleBuild, localeEntries, recordLocaleBuild } from '../../scripts/locale-build.mjs';
import { generateLocales, localeExport } from './generate-locales.mjs';

const source = `import type { CompleteMessages, SearchAliases, coreMessages } from '@domternal/core';
export function core() {
  const deMessages = Object.freeze({ 'core.label': 'Beschriftung' } satisfies CompleteMessages<typeof coreMessages>);
  const deSearchAliases = Object.freeze({} satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}
`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-locale-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'packages/core');
  write(join(root, 'locales/de.ts'), source);
  write(join(root, 'tests/i18n/namespaces.json'), JSON.stringify({ '@domternal/core': 'core.' }));
  write(join(root, 'tests/i18n/inventory.json'), JSON.stringify({ messages: [{ owner: '@domternal/core', id: 'core.label', searchable: false }] }));
  write(join(directory, 'package.json'), JSON.stringify({ name: '@domternal/core', version: '1.2.3', exports: { '.': './dist/index.js' } }, null, 2) + '\n');
  for (const path of ['scripts/locale-build.mjs', 'tests/i18n/generate-locales.mjs', 'packages/core/tsup.config.ts']) {
    write(join(root, path), '// Fixture build input\n');
  }
  generateLocales({ root });
  for (const suffix of ['js', 'cjs', 'd.ts', 'd.cts']) write(join(directory, `dist/locales/de.${suffix}`), `fixture ${suffix}\n`);
  return { root, directory, stamp: join(directory, '.locale-build.json') };
}

function editManifest(directory, change) {
  const path = join(directory, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

function fakeCompiler(root, body, callback) {
  const bin = join(root, 'bin');
  const file = join(bin, 'pnpm');
  write(file, `#!${process.execPath}\n${body}\n`);
  chmodSync(file, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
  try { callback(); } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
}

test('a build receipt validates matching generated inputs and both module formats', (t) => {
  const { directory, stamp } = fixture(t);
  assert.throws(() => checkLocaleBuild(directory), /missing locale build receipt/);
  recordLocaleBuild(directory);
  assert.doesNotThrow(() => checkLocaleBuild(directory));
  const before = readFileSync(stamp, 'utf8');
  checkLocaleBuild(directory);
  assert.equal(readFileSync(stamp, 'utf8'), before);
  assert.equal(JSON.parse(before).owner, '@domternal/core');
});

test('central edits and manually edited generated modules block packing before any build', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  writeFileSync(join(root, 'locales/de.ts'), source.replace('Beschriftung', 'Changed'));
  assert.throws(() => checkLocaleBuild(directory), /Stale generated locale/);
  generateLocales({ root });
  assert.throws(() => checkLocaleBuild(directory), /inputs changed since the successful build/);
  writeFileSync(join(root, 'locales/de.ts'), source);
  generateLocales({ root });
  writeFileSync(join(directory, 'src/locales/de.ts'), '// manual change\n');
  assert.throws(() => checkLocaleBuild(directory), /Stale generated locale/);
});

test('changing a compiler input invalidates a receipt even when translations are unchanged', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  for (const path of ['scripts/locale-build.mjs', 'tests/i18n/generate-locales.mjs', 'packages/core/tsup.config.ts']) {
    writeFileSync(join(root, path), '// Changed compiler input\n');
    assert.throws(() => checkLocaleBuild(directory), /inputs changed since the successful build/);
    writeFileSync(join(root, path), '// Fixture build input\n');
    assert.doesNotThrow(() => checkLocaleBuild(directory));
  }
});

test('changed, missing and orphan compiled locale artifacts block packing', (t) => {
  const { directory } = fixture(t);
  recordLocaleBuild(directory);
  const path = join(directory, 'dist/locales/de.cjs');
  writeFileSync(path, 'changed\n');
  assert.throws(() => checkLocaleBuild(directory), /built locale artifacts changed/);
  rmSync(path);
  assert.throws(() => checkLocaleBuild(directory), /Missing locale artifact/);
  writeFileSync(path, 'fixture cjs\n');
  const extra = join(directory, 'dist/locales/fr.js');
  writeFileSync(extra, 'orphan\n');
  assert.throws(() => checkLocaleBuild(directory), /Unexpected locale artifact/);
  rmSync(extra);
  assert.doesNotThrow(() => checkLocaleBuild(directory));
});

test('published locale export paths must match the catalog and compiled formats', (t) => {
  const { directory } = fixture(t);
  recordLocaleBuild(directory);
  editManifest(directory, (manifest) => { manifest.exports['./locales/de'].require.default = './dist/locales/wrong.cjs'; });
  assert.throws(() => checkLocaleBuild(directory), /stale locale exports/);
  editManifest(directory, (manifest) => { manifest.exports['./locales/de'] = localeExport('de', '@domternal/source'); });
  editManifest(directory, (manifest) => { manifest.exports['./locales/fr'] = localeExport('fr'); });
  assert.throws(() => checkLocaleBuild(directory), /stale locale exports/);
});

test('legacy locale type resolution cannot drift after a successful build', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  editManifest(directory, (manifest) => {
    delete manifest.typesVersions['*']['locales/*'];
  });
  assert.throws(() => checkLocaleBuild(directory), /stale locale type resolution/);
  generateLocales({ root });
  assert.doesNotThrow(() => checkLocaleBuild(directory));
});

test('Free publication may strip its source condition without changing the build receipt', (t) => {
  const { directory, stamp } = fixture(t);
  recordLocaleBuild(directory);
  const before = readFileSync(stamp, 'utf8');
  editManifest(directory, (manifest) => { delete manifest.exports['./locales/de']['@domternal/source']; });
  const manifestBefore = readFileSync(join(directory, 'package.json'), 'utf8');
  assert.doesNotThrow(() => checkLocaleBuild(directory));
  assert.equal(readFileSync(stamp, 'utf8'), before);
  assert.equal(readFileSync(join(directory, 'package.json'), 'utf8'), manifestBefore);
});

test('a newly added locale is generated by the build entry helper and needs a fresh receipt', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  write(join(root, 'locales/fr.ts'), source.replaceAll('deMessages', 'frMessages').replaceAll('deSearchAliases', 'frSearchAliases'));
  assert.deepEqual(localeEntries('@domternal/core', directory), { 'locales/de': 'src/locales/de.ts', 'locales/fr': 'src/locales/fr.ts' });
  assert.throws(() => checkLocaleBuild(directory), /inputs changed since the successful build/);
  assert.throws(() => recordLocaleBuild(directory), /Missing locale artifact dist\/locales\/fr.js/);
  for (const suffix of ['js', 'cjs', 'd.ts', 'd.cts']) write(join(directory, `dist/locales/fr.${suffix}`), `fixture fr ${suffix}\n`);
  recordLocaleBuild(directory);
  assert.doesNotThrow(() => checkLocaleBuild(directory));
});

test('owner names and package locations cannot cross their declared build boundary', (t) => {
  const { root, directory } = fixture(t);
  assert.throws(() => localeEntries('@domternal/extension-table', directory), /Expected locale owner/);
  const misplaced = join(root, 'packages/other');
  write(join(misplaced, 'package.json'), readFileSync(join(directory, 'package.json')));
  assert.throws(() => localeEntries('@domternal/core', misplaced), /owning package directory/);
  editManifest(directory, (manifest) => { manifest.name = '@domternal/unknown'; });
  assert.throws(() => checkLocaleBuild(directory), /does not own maintained locale messages/);
});

test('changed inputs during compilation cannot receive a successful build receipt', (t) => {
  const { root, directory, stamp } = fixture(t);
  recordLocaleBuild(directory);
  const before = JSON.parse(readFileSync(stamp, 'utf8')).inputs;
  writeFileSync(join(root, 'locales/de.ts'), source.replace('Beschriftung', 'Changed'));
  generateLocales({ root });
  assert.throws(() => recordLocaleBuild(directory, before), /inputs changed during the build/);
  assert.throws(() => checkLocaleBuild(directory), /inputs changed since the successful build/);
});

test('failed compilation removes an older receipt instead of validating stale output', (t) => {
  const { root, directory, stamp } = fixture(t);
  recordLocaleBuild(directory);
  fakeCompiler(root, 'process.exit(7);', () => {
    assert.throws(() => buildLocales(directory), /build failed \(7\)/);
  });
  assert.equal(existsSync(stamp), false);
  assert.throws(() => checkLocaleBuild(directory), /missing locale build receipt/);
});

test('the normal build records output only after a successful compiler exit', (t) => {
  const { root, directory, stamp } = fixture(t);
  fakeCompiler(root, 'process.exit(0);', () => buildLocales(directory));
  assert.equal(existsSync(stamp), true);
  assert.doesNotThrow(() => checkLocaleBuild(directory));
});

test('a central source changed by the compiler is detected before recording success', (t) => {
  const { root, directory, stamp } = fixture(t);
  fakeCompiler(root, `const fs = require('node:fs');
const path = require('node:path').resolve('../../locales/de.ts');
fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace('Beschriftung', 'Changed'));
`, () => {
    assert.throws(() => buildLocales(directory), /Stale generated locale/);
  });
  assert.equal(existsSync(stamp), false);
});

test('orphan generated source modules block packing even when they were never compiled', (t) => {
  const { directory } = fixture(t);
  recordLocaleBuild(directory);
  write(join(directory, 'src/locales/fr.ts'), '// Generated from locales/fr.ts. Run pnpm locales:generate; do not edit.\n');
  assert.throws(() => checkLocaleBuild(directory), /Unexpected generated locale/);
});

test('unknown source conditions cannot be silently removed from published locale exports', (t) => {
  const { directory } = fixture(t);
  recordLocaleBuild(directory);
  editManifest(directory, (manifest) => { manifest.exports['./locales/de']['@foreign/source'] = './missing.ts'; });
  assert.throws(() => checkLocaleBuild(directory), /stale locale exports/);
});

test('receipt schema and owner mismatches cannot validate compiled locales', (t) => {
  const { directory, stamp } = fixture(t);
  recordLocaleBuild(directory);
  const original = JSON.parse(readFileSync(stamp, 'utf8'));
  for (const invalid of [
    { ...original, version: 2 },
    { ...original, owner: '@domternal/other' },
    { ...original, inputs: {} },
    { ...original, artifacts: {} },
  ]) {
    writeFileSync(stamp, JSON.stringify(invalid));
    assert.throws(() => checkLocaleBuild(directory), /inputs changed|artifacts changed/);
  }
});


test('symlinked artifacts and locale directories cannot receive or validate a receipt', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  const artifact = join(directory, 'dist/locales/de.js');
  const target = join(root, 'external.js');
  renameSync(artifact, target);
  symlinkSync(target, artifact);
  assert.throws(() => checkLocaleBuild(directory), /regular file|symlink/);
  assert.throws(() => recordLocaleBuild(directory), /regular file|symlink/);
  rmSync(artifact);
  renameSync(target, artifact);
  const locales = join(directory, 'dist/locales');
  const outside = join(root, 'external-locales');
  renameSync(locales, outside);
  symlinkSync(outside, locales);
  assert.throws(() => checkLocaleBuild(directory), /symlink/);
});

test('a symlinked dist parent cannot bypass compiled locale ownership', (t) => {
  const { root, directory } = fixture(t);
  recordLocaleBuild(directory);
  const dist = join(directory, 'dist');
  const outside = join(root, 'external-dist');
  renameSync(dist, outside);
  symlinkSync(outside, dist);
  assert.throws(() => checkLocaleBuild(directory), /symlink/);
  assert.throws(() => recordLocaleBuild(directory), /symlink/);
});

test('compiler overrides cannot certify stale default artifacts or mutate build inputs', (t) => {
  const { root, directory, stamp } = fixture(t);
  recordLocaleBuild(directory);
  const receiptBefore = readFileSync(stamp, 'utf8');
  const generatedPath = join(directory, 'src/locales/de.ts');
  const generatedBefore = readFileSync(generatedPath, 'utf8');
  const manifestBefore = readFileSync(join(directory, 'package.json'), 'utf8');
  writeFileSync(join(root, 'locales/de.ts'), source.replace('Beschriftung', 'Changed'));
  for (const args of [
    ['--out-dir', 'alternate'],
    ['--outDir=alternate'],
    ['--clean', 'false'],
    ['--no-clean'],
    ['--entry', 'src/index.ts'],
    ['--config', 'alternate.config.ts'],
    ['--format', 'esm'],
    ['--watch'],
    ['--', '--out-dir', 'alternate'],
  ]) {
    assert.throws(() => buildLocales(directory, args), /override|argument|custom/i);
    assert.equal(readFileSync(stamp, 'utf8'), receiptBefore);
    assert.equal(readFileSync(generatedPath, 'utf8'), generatedBefore);
    assert.equal(readFileSync(join(directory, 'package.json'), 'utf8'), manifestBefore);
  }
  assert.throws(() => checkLocaleBuild(directory), /Stale generated locale/);
});

test('a standalone pnpm argument separator preserves the normal build contract', (t) => {
  const { root, directory } = fixture(t);
  fakeCompiler(root, 'process.exit(0);', () => buildLocales(directory, ['--']));
  assert.doesNotThrow(() => checkLocaleBuild(directory));
});
