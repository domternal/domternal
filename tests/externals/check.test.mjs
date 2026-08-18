/**
 * Fixture tests for the import scanner behind the externals gate.
 *
 * The gate is only worth having if it distinguishes a value import (which
 * esbuild would inline) from a type import (which erases), and if it follows
 * the entry graph rather than every file under `src`. Both are exercised here
 * against hand-written shapes, including the one that made the gate necessary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectImports,
  splitBySurvival,
  stripComments,
  parseEntries,
  parseExternals,
  isExternal,
  MUST_BE_EXTERNAL,
} from './check.mjs';

/** Scans a source snippet the way the gate does, split into value/type-only. */
function scan(text) {
  return splitBySurvival(collectImports(text));
}

test('a plain value import is a value import', () => {
  const found = scan("import { Fragment } from '@domternal/pm/model';");
  assert.deepEqual([...found.value], ['@domternal/pm/model']);
  assert.deepEqual([...found.typeOnly], []);
});

test('`import type` is type-only', () => {
  const found = scan("import type { Node } from '@domternal/pm/model';");
  assert.deepEqual([...found.value], []);
  assert.deepEqual([...found.typeOnly], ['@domternal/pm/model']);
});

test('a clause where every binding carries `type` is type-only', () => {
  const found = scan("import { type Node, type Mark } from '@domternal/pm/model';");
  assert.deepEqual([...found.typeOnly], ['@domternal/pm/model']);
});

test('a mixed clause is a value import, because one binding survives', () => {
  const found = scan("import { Fragment, type Node } from '@domternal/pm/model';");
  assert.deepEqual([...found.value], ['@domternal/pm/model']);
  assert.deepEqual([...found.typeOnly], []);
});

test('the same specifier imported both ways counts as a value import', () => {
  // Exactly the shape that made this gate necessary: a package held
  // `@domternal/pm/model` as a type import until a guard needed `Fragment`.
  const found = scan(
    "import type { Schema } from '@domternal/pm/model';\nimport { Fragment } from '@domternal/pm/model';"
  );
  assert.deepEqual([...found.value], ['@domternal/pm/model']);
  assert.deepEqual([...found.typeOnly], []);
});

test('a default import is a value import', () => {
  const found = scan("import Table from '@domternal/extension-table';");
  assert.deepEqual([...found.value], ['@domternal/extension-table']);
});

test('a namespace import is a value import', () => {
  const found = scan("import * as PM from '@domternal/pm/model';");
  assert.deepEqual([...found.value], ['@domternal/pm/model']);
});

test('a re-export is scanned like an import', () => {
  // `export ... from` pulls the module into the bundle just as an import does.
  const found = scan("export { Fragment } from '@domternal/pm/model';");
  assert.deepEqual([...found.value], ['@domternal/pm/model']);
});

test('unrelated packages are ignored', () => {
  const found = scan("import { z } from 'zod';\nimport { a } from './local.js';");
  assert.equal(found.value.size, 0);
  assert.equal(found.typeOnly.size, 0);
});

test('the watch pattern covers the identity-compared modules and nothing stray', () => {
  for (const spec of ['@domternal/core', '@domternal/pm/model', 'prosemirror-state']) {
    assert.ok(MUST_BE_EXTERNAL.test(spec), `${spec} must be watched`);
  }
  for (const spec of ['zod', 'vue', 'react', 'linkifyjs', 'prosemirrorish']) {
    assert.ok(!MUST_BE_EXTERNAL.test(spec), `${spec} must not be watched`);
  }
});

test('an import inside a JSDoc example is not a real import', () => {
  /* Every wrapper package documents itself with a fenced example, and the gate
     reported `@domternal/vue` as inlined into its own dist until comments were
     stripped. A false alarm is how a gate gets switched off. */
  const found = scan(`
/**
 * @example
 * import { useEditor, EditorContent } from '@domternal/vue';
 */
import { Editor } from '@domternal/core';
`);
  assert.deepEqual([...found.value], ['@domternal/core']);
});

test('a commented-out import is not a real import', () => {
  const found = scan("// import { Fragment } from '@domternal/pm/model';\nimport { Editor } from '@domternal/core';");
  assert.deepEqual([...found.value], ['@domternal/core']);
});

test('stripComments leaves a URL inside a string intact', () => {
  // Line comments are only stripped when `//` opens the line, so an https://
  // inside a docs link does not eat the rest of that line.
  const kept = stripComments("const url = 'https://domternal.dev/v1/guides/';");
  assert.ok(kept.includes('https://domternal.dev/v1/guides/'));
});

test('an externalised package covers its subpaths', () => {
  const externals = new Set(['@domternal/pm']);
  assert.ok(isExternal('@domternal/pm/model', externals));
  assert.ok(isExternal('@domternal/pm', externals));
  // Not a subpath, just a prefix: a different package entirely.
  assert.ok(!isExternal('@domternal/pm-extras', externals));
});

test('entries and externals are read out of a tsup config', () => {
  const config = `
export default defineConfig({
  entry: ['src/index.ts', 'src/status/index.ts'],
  external: [
    '@domternal/core',
    'y-prosemirror',
  ],
});`;
  assert.deepEqual(parseEntries(config), ['src/index.ts', 'src/status/index.ts']);
  assert.deepEqual([...parseExternals(config)].sort(), ['@domternal/core', 'y-prosemirror']);
});

test('a config with no external list yields an empty set, not a crash', () => {
  assert.equal(parseExternals('export default defineConfig({ entry: [] });').size, 0);
  assert.deepEqual(parseEntries('export default defineConfig({});'), []);
});
