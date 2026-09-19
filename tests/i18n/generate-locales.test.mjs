import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { centralLocaleProblems, createLocalePlan, GENERATED_HEADER, localeFileProblems } from './generate-locales.mjs';

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

test('unknown central language files require an explicit new contract', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'domternal-locale-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(centralLocaleProblems(root).join('\n'), /Missing central locale/);
  mkdirSync(join(root, 'locales'));
  writeFileSync(join(root, 'locales/de.ts'), source);
  writeFileSync(join(root, 'locales/README.md'), 'Documentation');
  assert.deepEqual(centralLocaleProblems(root), []);
  writeFileSync(join(root, 'locales/fr.ts'), source);
  assert.match(centralLocaleProblems(root).join('\n'), /Unsupported central locale source: locales\/fr.ts/);
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
