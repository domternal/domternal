import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { centralLocaleProblems, createLocalePlan, createRepositoryLocalePlan, discoverLocales, generateLocales, generatedHeader, GENERATED_HEADER, localeExport, localeFileProblems, localeSymbols } from './generate-locales.mjs';

const namespaces = { '@domternal/core': 'core.', '@domternal/extension-table': 'table.' };
const inventory = { messages: [
  { owner: '@domternal/core', id: 'core.label', searchable: true, allowEmpty: false },
  { owner: '@domternal/extension-table', id: 'table.label', searchable: true, allowEmpty: false },
] };
const source = `import type { CompleteMessages, SearchAliases, coreMessages } from '@domternal/core';
import type { tableMessages, UnusedType } from '../packages/extension-table/src/messages.js';
export function core() {
  const deMessages = Object.freeze({ 'core.label': 'Beschriftung' } satisfies CompleteMessages<typeof coreMessages>);
  const deSearchAliases = Object.freeze({ 'core.label': Object.freeze(['suchen']) } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}
export function extensionTable() {
  const words = ['eins', 'mehrere'];
  const deMessages = Object.freeze({ 'table.label': ({ count }) => words[count === 1 ? 0 : 1] } satisfies CompleteMessages<typeof tableMessages>);
  const deSearchAliases = Object.freeze({ 'table.label': Object.freeze(['tabelle']) } satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}
`;
const plan = (text = source) => createLocalePlan(text, { namespaces, inventory, root: '/fixture' });

test('owner modules retain scoped helpers and only the type imports they use', () => {
  const { outputs, errors } = plan();
  assert.deepEqual(errors, []);
  assert.equal(outputs.size, 2);
  const core = outputs.get('packages/core/src/locales/de.ts');
  const table = outputs.get('packages/extension-table/src/locales/de.ts');
  assert.ok(core.startsWith(GENERATED_HEADER));
  assert.match(core, /import type.*coreMessages.*from ['"]@domternal\/core['"]/);
  assert.doesNotMatch(core, /tableMessages|UnusedType|const words|export function/);
  assert.match(table, /import type.*tableMessages.*from ['"]\.\.\/messages\.js['"]/);
  assert.doesNotMatch(table, /coreMessages|UnusedType|export function/);
  assert.match(table, /const words =/);
  assert.match(table, /export const deMessages = Object\.freeze/);
  assert.match(table, /export const deSearchAliases = Object\.freeze/);
  assert.doesNotMatch(table, /export const words/);
  assert.deepEqual([...plan().outputs], [...outputs]);
});

test('no source function or helper initializer executes during generation', () => {
  const changed = source.replace("const words = ['eins', 'mehrere'];", "const words = (() => { throw new Error('must never execute'); })();");
  assert.deepEqual(plan(changed).errors, []);
  assert.match(plan(changed).outputs.get('packages/extension-table/src/locales/de.ts'), /must never execute/);
});

test('individual type-only import specifiers become valid whole type imports', () => {
  const changed = source.replace('import type { CompleteMessages, SearchAliases, coreMessages }',
    'import { type CompleteMessages, type SearchAliases, type coreMessages }');
  const result = plan(changed);
  assert.deepEqual(result.errors, []);
  const core = result.outputs.get('packages/core/src/locales/de.ts');
  assert.match(core, /import type \{ CompleteMessages, SearchAliases, coreMessages \}/);
  assert.doesNotMatch(core, /import type \{ type /);
});

test('central editing instructions do not leak into generated package modules', () => {
  const result = plan('// Edit this central source, not the generated modules.\n' + source);
  assert.deepEqual(result.errors, []);
  for (const content of result.outputs.values()) {
    assert.ok(content.startsWith(GENERATED_HEADER));
    assert.doesNotMatch(content, /Edit this central source/);
  }
});

test('missing, unknown and duplicate owner functions fail closed', () => {
  for (const [text, expected] of [
    [source.replace('function core()', 'function wrong()'), /missing owner function core/],
    [source + 'export function extra() { return { deMessages, deSearchAliases }; }', /Unknown owner function: extra/],
    [source + 'export function core() { return { deMessages, deSearchAliases }; }', /duplicate owner function core/],
  ]) assert.match(plan(text).errors.join('\n'), expected);
});

test('catalog completeness rejects missing, foreign, duplicate and computed keys', () => {
  for (const [before, after, expected] of [
    ["'core.label': 'Beschriftung'", '', /missing message core.label/],
    ["'core.label': 'Beschriftung'", "'core.label': 'Beschriftung', 'table.label': 'Falsch'", /cross-owner message table.label/],
    ["'core.label': 'Beschriftung'", "'core.label': 'Eins', 'core.label': 'Zwei'", /duplicate key core.label/],
    ["'core.label': 'Beschriftung'", "['core.label']: 'Beschriftung'", /explicit quoted keys/],
    ["'core.label': 'Beschriftung'", "...otherMessages", /without spreads/],
    ["'core.label': 'Beschriftung'", "'core.label': ''", /cannot be empty/],
    ["'core.label': 'Beschriftung'", "'core.label': 42", /must be text or a typed translation function/],
    ["'core.label': 'Beschriftung'", "'core.label': false", /must be text or a typed translation function/],
    ["'core.label': 'Beschriftung'", "'core.label': null", /must be text or a typed translation function/],
  ]) assert.match(plan(source.replace(before, after)).errors.join('\n'), expected);
});

test('search aliases must be owned, searchable, frozen and unique', () => {
  for (const [before, after, expected] of [
    ["'core.label': Object.freeze(['suchen'])", "'table.label': Object.freeze(['suchen'])", /owned searchable message/],
    ["Object.freeze(['suchen'])", "['suchen']", /must freeze an array/],
    ["['suchen']", "['suchen', 'suchen']", /duplicate aliases/],
    ["['suchen']", "['']", /non-empty string literals/],
    ["['suchen']", '[lookup()]', /non-empty string literals/],
  ]) assert.match(plan(source.replace(before, after)).errors.join('\n'), expected);
  const unsearchable = { messages: inventory.messages.map((message) => ({ ...message, searchable: false })) };
  assert.match(createLocalePlan(source, { namespaces, inventory: unsearchable }).errors.join('\n'), /owned searchable message/);
});

test('runtime imports, global helpers, unsupported function bodies and mutable maps are rejected', () => {
  for (const [text, expected] of [
    [source.replace('import type { CompleteMessages', 'import { CompleteMessages'), /only type-only imports/],
    ["import './side-effect.js';\n" + source, /only type-only imports/],
    ['const shared = {};\n' + source, /only type imports and exported/],
    [source.replace('export function core()', 'export async function core()'), /synchronous zero-argument/],
    [source.replace('function core()', 'function core(options)'), /synchronous zero-argument/],
    [source.replace('const deMessages =', 'let deMessages ='), /individual const declarations/],
    [source.replace('const words =', 'const Object ='), /Object cannot be shadowed/],
    [source.replace('return { deMessages, deSearchAliases };', 'return { deMessages };'), /finish with return/],
    [source.replace("Object.freeze({ 'core.label': 'Beschriftung' } satisfies CompleteMessages<typeof coreMessages>)", "{ 'core.label': 'Beschriftung' }"), /deMessages must freeze/],
  ]) assert.match(plan(text).errors.join('\n'), expected);
});

test('runtime imports remain forbidden inside scoped helpers and translation callbacks', () => {
  for (const expression of ["import('@domternal/core')", "require('@domternal/core')",
    "module.require('@domternal/core')", "require.resolve('@domternal/core')"]) {
    const changed = source.replace("const words = ['eins', 'mehrere'];", `const words = ${expression};`);
    assert.match(plan(changed).errors.join('\n'), /runtime import and require calls are not allowed/);
  }
  const changed = source.replace("'core.label': 'Beschriftung'", "'core.label': () => { require('@domternal/core'); return 'Beschriftung'; }");
  assert.match(plan(changed).errors.join('\n'), /runtime import and require calls are not allowed/);
});

test('malformed TypeScript is rejected without executing partial source', () => {
  assert.ok(plan('export function core( {').errors.length > 0);
});

test('drift checks detect missing, edited and unexpected generated files without writing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'domternal-locales-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { outputs } = plan();
  assert.equal(localeFileProblems(root, outputs).length, 2);
  for (const [path, value] of outputs) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  assert.deepEqual(localeFileProblems(root, outputs), []);
  const path = 'packages/core/src/locales/de.ts';
  writeFileSync(join(root, path), 'edited\n');
  assert.match(localeFileProblems(root, outputs).join('\n'), /Stale generated locale/);
  assert.equal(readFileSync(join(root, path), 'utf8'), 'edited\n');
  const unexpected = join(root, 'packages/core/src/locales/extra.ts');
  writeFileSync(unexpected, GENERATED_HEADER + '\n');
  assert.match(localeFileProblems(root, outputs).join('\n'), /Unexpected generated locale/);
  const nested = join(root, 'packages/core/src/locales/stale/extra.ts');
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(nested, GENERATED_HEADER + '\n');
  assert.match(localeFileProblems(root, outputs).join('\n'), /stale\/extra.ts/);
  const foreign = join(root, 'packages/unknown/src/locales/de.ts');
  mkdirSync(dirname(foreign), { recursive: true });
  writeFileSync(foreign, 'export const deMessages = {};\n');
  assert.match(localeFileProblems(root, outputs).join('\n'), /packages\/unknown\/src\/locales\/de.ts/);
});

test('new canonical language sources are discovered without a registry', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'domternal-locale-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(centralLocaleProblems(root).join('\n'), /Missing central locale/);
  mkdirSync(join(root, 'locales'));
  writeFileSync(join(root, 'locales/de.ts'), source);
  writeFileSync(join(root, 'locales/README.md'), 'Documentation');
  assert.deepEqual(centralLocaleProblems(root), []);
  writeFileSync(join(root, 'locales/fr.ts'), source);
  assert.deepEqual(centralLocaleProblems(root), []);
  assert.deepEqual(discoverLocales(root), ['de', 'fr']);
});

test('the same owner convention supports the Pro repository without a Free checkout', () => {
  const proNamespaces = { '@domternal-pro/core': 'pro.core.' };
  const proInventory = { messages: [{ owner: '@domternal-pro/core', id: 'pro.core.label', searchable: false }] };
  const proSource = `import type { CompleteMessages, SearchAliases } from '@domternal/core';
import type { proCoreMessages } from '../packages/core/src/messages.js';
export function core() {
  const deMessages = Object.freeze({ 'pro.core.label': 'Pro' } satisfies CompleteMessages<typeof proCoreMessages>);
  const deSearchAliases = Object.freeze({} satisfies SearchAliases);
  return { deMessages, deSearchAliases };
}`;
  const result = createLocalePlan(proSource, { namespaces: proNamespaces, inventory: proInventory, root: '/pro' });
  assert.deepEqual(result.errors, []);
  assert.match(result.outputs.get('packages/core/src/locales/de.ts'), /from ['"]\.\.\/messages\.js['"]/);
});


function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-locale-generation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'locales'), { recursive: true });
  mkdirSync(join(root, 'tests/i18n'), { recursive: true });
  writeFileSync(join(root, 'locales/de.ts'), source);
  writeFileSync(join(root, 'tests/i18n/namespaces.json'), JSON.stringify(namespaces));
  writeFileSync(join(root, 'tests/i18n/inventory.json'), JSON.stringify(inventory));
  for (const owner of Object.keys(namespaces)) {
    const path = join(root, 'packages', owner.split('/')[1], 'package.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ name: owner, exports: { '.': './dist/index.js', './style.css': './dist/style.css' }, scripts: { build: 'unchanged' } }, null, 2) + '\n');
  }
  return root;
}

const localeSource = (locale) => {
  const symbols = localeSymbols(locale);
  return source.replaceAll('deMessages', symbols.messages).replaceAll('deSearchAliases', symbols.searchAliases);
};
const manifestAt = (root, name = 'core') => JSON.parse(readFileSync(join(root, `packages/${name}/package.json`), 'utf8'));

test('locale symbols and exports preserve canonical language, script and region names', () => {
  for (const [locale, prefix] of [['fr', 'fr'], ['pt-BR', 'ptBR'], ['zh-Hant-TW', 'zhHantTW'], ['es-419', 'es419']]) {
    assert.deepEqual(localeSymbols(locale), { messages: `${prefix}Messages`, searchAliases: `${prefix}SearchAliases` });
    const published = localeExport(locale);
    assert.deepEqual(Object.keys(published), ['import', 'require']);
    assert.equal(published.import.types, `./dist/locales/${locale}.d.ts`);
    assert.equal(published.require.default, `./dist/locales/${locale}.cjs`);
    assert.equal(localeExport(locale, '@domternal/source')['@domternal/source'], `./src/locales/${locale}.ts`);
    const result = createLocalePlan(localeSource(locale), { namespaces, inventory, root: '/fixture', locale });
    assert.deepEqual(result.errors, []);
    assert.match(result.outputs.get(`packages/core/src/locales/${locale}.ts`), new RegExp(`export const ${prefix}Messages`));
    assert.ok(result.outputs.get(`packages/core/src/locales/${locale}.ts`).startsWith(generatedHeader(locale)));
  }
});

test('invalid and non-canonical locale filenames are rejected before generation', (t) => {
  for (const locale of ['../fr', 'FR', 'pt-br', 'en_US', 'iw', 'fr.test', 'en-u-ca-gregory', 'x-private', 'a', '']) {
    assert.throws(() => localeSymbols(locale), /locale tag/);
    assert.ok(createLocalePlan(source, { namespaces, inventory, locale }).errors.length > 0);
  }
  const root = fixture(t);
  writeFileSync(join(root, 'locales/FR.ts'), localeSource('fr'));
  assert.throws(() => discoverLocales(root), /locale tag/);
  assert.throws(() => generateLocales({ root }), /locale tag/);
  assert.equal(manifestAt(root).exports['./locales/de'], undefined);
});

test('adding a French file alone generates every owner module and explicit public export', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'locales/fr.ts'), localeSource('fr'));
  const result = generateLocales({ root });
  assert.deepEqual(result.locales, ['de', 'fr']);
  assert.equal(result.outputs.size, 6);
  for (const name of ['core', 'extension-table']) {
    const manifest = manifestAt(root, name);
    assert.deepEqual(manifest.exports['./locales/fr'], localeExport('fr', '@domternal/source'));
    assert.equal(manifest.exports['./style.css'], './dist/style.css');
    assert.equal(manifest.scripts.build, 'unchanged');
    assert.match(readFileSync(join(root, `packages/${name}/src/locales/fr.ts`), 'utf8'), /export const frMessages/);
  }
  assert.doesNotThrow(() => generateLocales({ root, check: true }));
  const second = generateLocales({ root });
  assert.deepEqual([...second.outputs], [...result.outputs]);
});

test('all central sources are validated before any source or manifest is written', (t) => {
  const root = fixture(t);
  generateLocales({ root });
  const before = readFileSync(join(root, 'packages/core/package.json'), 'utf8');
  const germanBefore = readFileSync(join(root, 'packages/core/src/locales/de.ts'), 'utf8');
  writeFileSync(join(root, 'locales/de.ts'), source.replace('Beschriftung', 'Changed'));
  writeFileSync(join(root, 'locales/fr.ts'), localeSource('fr').replace("'core.label': 'Beschriftung'", ''));
  assert.throws(() => generateLocales({ root }), /fr:.*missing message core.label/);
  assert.equal(readFileSync(join(root, 'packages/core/package.json'), 'utf8'), before);
  assert.equal(readFileSync(join(root, 'packages/core/src/locales/de.ts'), 'utf8'), germanBefore);
});

test('check mode detects manifest and source drift without modifying either', (t) => {
  const root = fixture(t);
  generateLocales({ root });
  const path = join(root, 'packages/core/package.json');
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, original.replace('./dist/locales/de.js', './dist/locales/wrong.js'));
  writeFileSync(join(root, 'locales/fr.ts'), localeSource('fr'));
  const changed = readFileSync(path, 'utf8');
  assert.throws(() => generateLocales({ root, check: true }), /Stale locale owner manifest/);
  assert.equal(readFileSync(path, 'utf8'), changed);
  assert.equal(createRepositoryLocalePlan(root).outputs.size, 6);
  assert.match(localeFileProblems(root, createRepositoryLocalePlan(root).outputs).join('\n'), /Missing generated locale: packages\/core\/src\/locales\/fr.ts/);
});

test('removing a language removes only its generated modules and managed manifest exports', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'locales/fr.ts'), localeSource('fr'));
  generateLocales({ root });
  const testPath = join(root, 'packages/core/src/locales/de.test.ts');
  writeFileSync(testPath, 'untouched test');
  rmSync(join(root, 'locales/fr.ts'));
  assert.throws(() => generateLocales({ root, check: true }), /Unexpected generated locale/);
  generateLocales({ root });
  assert.equal(manifestAt(root).exports['./locales/fr'], undefined);
  assert.throws(() => readFileSync(join(root, 'packages/core/src/locales/fr.ts')), /ENOENT/);
  assert.equal(readFileSync(testPath, 'utf8'), 'untouched test');
  assert.doesNotThrow(() => generateLocales({ root, check: true }));
});

test('handwritten output is never overwritten or deleted, including after a source removal', (t) => {
  const root = fixture(t);
  generateLocales({ root });
  for (const filename of ['de.ts', 'fr.ts']) {
    const path = join(root, `packages/core/src/locales/${filename}`);
    writeFileSync(path, 'export const userAuthored = true;\n');
    assert.throws(() => generateLocales({ root }), /Unmanaged locale output/);
    assert.equal(readFileSync(path, 'utf8'), 'export const userAuthored = true;\n');
    rmSync(path);
    generateLocales({ root });
  }
});

test('owner generation updates only that package while validating all source owners', (t) => {
  const root = fixture(t);
  const untouched = readFileSync(join(root, 'packages/extension-table/package.json'), 'utf8');
  const result = generateLocales({ root, owner: '@domternal/core' });
  assert.equal(result.outputs.size, 2);
  assert.equal(readFileSync(join(root, 'packages/extension-table/package.json'), 'utf8'), untouched);
  assert.throws(() => readFileSync(join(root, 'packages/extension-table/src/locales/de.ts')), /ENOENT/);
  assert.throws(() => generateLocales({ root, owner: '@domternal/unknown' }), /Unknown locale owner/);
  writeFileSync(join(root, 'locales/de.ts'), source.replace("'table.label': ({ count }) => words[count === 1 ? 0 : 1]", ''));
  assert.throws(() => generateLocales({ root, owner: '@domternal/core' }), /missing message table.label/);
});

test('Pro published manifests receive locale exports without workspace conditions', (t) => {
  const root = fixture(t);
  const owner = '@domternal-pro/core';
  writeFileSync(join(root, 'tests/i18n/namespaces.json'), JSON.stringify({ [owner]: 'core.' }));
  writeFileSync(join(root, 'tests/i18n/inventory.json'), JSON.stringify({ messages: [{ owner, id: 'core.label', searchable: true }] }));
  writeFileSync(join(root, 'locales/de.ts'), source.slice(0, source.indexOf('export function extensionTable')));
  const manifest = { name: owner, exports: { '.': './dist/index.js' }, publishConfig: { access: 'public', exports: { '.': './dist/index.js' } } };
  writeFileSync(join(root, 'packages/core/package.json'), JSON.stringify(manifest));
  generateLocales({ root });
  const result = manifestAt(root);
  assert.deepEqual(result.exports['./locales/de'], localeExport('de', '@domternal-pro/source'));
  assert.deepEqual(result.publishConfig.exports['./locales/de'], localeExport('de'));
  assert.equal(result.publishConfig.access, 'public');
});

test('missing owner metadata and malformed manifests fail closed', (t) => {
  const root = fixture(t);
  rmSync(join(root, 'packages/core/package.json'));
  assert.throws(() => generateLocales({ root }), /Missing locale owner manifest/);
  writeFileSync(join(root, 'tests/i18n/namespaces.json'), '{}');
  assert.throws(() => generateLocales({ root }), /at least one message owner/);
  assert.match(createLocalePlan(source, { namespaces: {}, inventory }).errors.join('\n'), /at least one message owner/);
});

test('symlinked central sources and output ancestors are rejected without touching targets', (t) => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'domternal-locale-target-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const sourceTarget = join(outside, 'fr.ts');
  writeFileSync(sourceTarget, localeSource('fr'));
  symlinkSync(sourceTarget, join(root, 'locales/fr.ts'));
  assert.throws(() => generateLocales({ root }), /regular file/);
  rmSync(join(root, 'locales/fr.ts'));
  symlinkSync(outside, join(root, 'packages/core/src'));
  assert.throws(() => generateLocales({ root }), /symbolic link/);
  assert.equal(readFileSync(sourceTarget, 'utf8'), localeSource('fr'));
  assert.throws(() => readFileSync(join(outside, 'locales/de.ts')), /ENOENT/);
});
