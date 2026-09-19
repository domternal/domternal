#!/usr/bin/env node
// Official locale subpaths must work without loading the editor or its dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLocales, localeSymbols } from '../i18n/generate-locales.mjs';
import { preparePublishManifest } from '../../scripts/prepare-publish-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const owners = Object.keys(
  JSON.parse(readFileSync(join(root, 'tests/i18n/namespaces.json'), 'utf8'))
);
const inventory = JSON.parse(
  readFileSync(join(root, 'tests/i18n/inventory.json'), 'utf8')
).messages;
const locales = discoverLocales(root).map((id) => ({ id, ...localeSymbols(id) }));
const scratch = mkdtempSync(join(tmpdir(), 'domternal-locale-consumer-'));

try {
  const catalogs = owners.flatMap((owner) =>
    locales.map((locale) => {
      const packageRoot = join(root, 'packages', owner.slice('@domternal/'.length));
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      const entry = manifest.exports[`./locales/${locale.id}`];
      assert.ok(entry, `${owner} must publish its complete official ${locale.id} catalog`);
      assert.equal(entry.import.default, `./dist/locales/${locale.id}.js`);
      assert.equal(entry.require.default, `./dist/locales/${locale.id}.cjs`);
      const destination = join(scratch, 'node_modules', owner);
      mkdirSync(join(destination, 'dist/locales'), { recursive: true });
      writeFileSync(
        join(destination, 'package.json'),
        JSON.stringify(preparePublishManifest(manifest).prepared)
      );
      // Deliberately omit the editor bundle, declarations and all dependencies.
      for (const target of [entry.import.default, entry.require.default]) {
        copyFileSync(join(packageRoot, target), join(destination, target));
      }
      const definitions = inventory.filter((message) => message.owner === owner);
      assert.ok(definitions.length > 0, `${owner} must have a checked English catalog`);
      return {
        owner,
        ...locale,
        keys: definitions.map((message) => message.id).sort(),
        searchable: definitions
          .filter((message) => message.searchable)
          .map((message) => message.id),
        allowEmpty: definitions
          .filter((message) => message.allowEmpty)
          .map((message) => message.id),
      };
    })
  );
  writeFileSync(join(scratch, 'catalogs.json'), JSON.stringify(catalogs));
  const check = join(scratch, 'check.mjs');
  writeFileSync(
    check,
    `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const catalogs = JSON.parse(readFileSync(new URL('./catalogs.json', import.meta.url), 'utf8'));
for (const catalog of catalogs) {
  const specifier = catalog.owner + '/locales/' + catalog.id;
  const esm = await import(specifier);
  const cjs = require(specifier);
  for (const [format, locale] of [['ESM', esm], ['CJS', cjs]]) {
    const label = specifier + ' (' + format + ')';
    assert.deepEqual(Object.keys(locale).sort(), [catalog.messages, catalog.searchAliases].sort(), label);
    assert.deepEqual(Object.keys(locale[catalog.messages]).sort(), catalog.keys, label);
    assert.ok(Object.isFrozen(locale[catalog.messages]), label + ': messages must be frozen');
    assert.ok(Object.isFrozen(locale[catalog.searchAliases]), label + ': search aliases must be frozen');
    for (const [key, value] of Object.entries(locale[catalog.messages])) {
      assert.ok(typeof value === 'string' || typeof value === 'function', label + ': ' + key);
      if (typeof value === 'string' && !catalog.allowEmpty.includes(key)) {
        assert.ok(value.trim().length > 0, label + ': empty ' + key);
      }
      assert.equal(typeof value, typeof esm[catalog.messages][key], label + ': parameter kind ' + key);
      if (typeof value === 'string') assert.equal(value, esm[catalog.messages][key], label + ': value ' + key);
    }
    for (const [key, aliases] of Object.entries(locale[catalog.searchAliases])) {
      assert.ok(catalog.searchable.includes(key), label + ': non-searchable alias ' + key);
      assert.ok(Array.isArray(aliases), label + ': aliases must be an array');
      assert.ok(Object.isFrozen(aliases), label + ': alias arrays must be frozen');
      assert.ok(aliases.every(alias => typeof alias === 'string' && alias.trim().length > 0), label);
      assert.equal(new Set(aliases).size, aliases.length, label + ': duplicate aliases');
    }
  }
  assert.deepEqual(cjs[catalog.searchAliases], esm[catalog.searchAliases], specifier + ': alias parity');
  console.log('[locale-consumers] ' + specifier + ': complete standalone ESM and CommonJS');
}
`
  );
  const result = spawnSync(process.execPath, [check], { stdio: 'inherit', timeout: 30000 });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    'Official locale subpaths must resolve without the editor runtime'
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
