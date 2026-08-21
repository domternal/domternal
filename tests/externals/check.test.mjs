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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  collectImports,
  splitBySurvival,
  stripComments,
  parseEntries,
  parseExternals,
  isExternal,
  isAssetImport,
  resolveRelative,
  walkEntryGraph,
  MUST_BE_EXTERNAL,
  SOURCE_SUFFIXES,
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
  const source = "const url = 'https://domternal.dev/v1/guides/';";
  assert.equal(stripComments(source), source);
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

/* ---------------------------------------------------------------------------
   Following the graph across file types.

   The gate walks source, so it can only see what its resolver can open. It
   accepted `.ts` alone, which made every import reachable only through a `.tsx`
   component invisible: a `prosemirror-model` value import inside one passed CI
   with the gate printing OK. These fixtures pin the suffixes it must follow and,
   more importantly, pin that an import it CANNOT follow is reported rather than
   stepped over, so a future file type shrinks the walk loudly.
--------------------------------------------------------------------------- */

/** Builds a throwaway package tree from `{ 'src/index.ts': 'source' }`. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'externals-fixture-'));
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

/** Walks a fixture from `src/index.ts` and cleans it up afterwards. */
function walk(files, entries = ['src/index.ts']) {
  const dir = fixture(files);
  try {
    return walkEntryGraph(dir, entries);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the walk follows a relative import into a .tsx file', () => {
  // The exact blind spot: @domternal/react is written in .tsx, so a value
  // import inside a component was never scanned.
  const found = walk({
    'src/index.ts': "export { Editor } from './Editor.js';",
    'src/Editor.tsx': "import { Fragment } from 'prosemirror-model';\nexport const Editor = Fragment;",
  });
  assert.deepEqual([...found.value], ['prosemirror-model']);
  assert.deepEqual(found.unresolved, []);
});

test('a .js specifier prefers its .ts sibling over a literal .js file', () => {
  // TypeScript sources import siblings as './foo.js'. Resolving to the built
  // .js instead would scan output rather than source.
  const dir = fixture({
    'src/index.ts': "export * from './helper.js';",
    'src/helper.ts': "import { Fragment } from 'prosemirror-model';\nexport { Fragment };",
    'src/helper.js': "import { Node } from 'prosemirror-model';\nexport { Node };",
  });
  try {
    assert.equal(resolveRelative(join(dir, 'src/index.ts'), './helper.js'), join(dir, 'src/helper.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory import resolves through index.tsx', () => {
  const found = walk({
    'src/index.ts': "export * from './parts';",
    'src/parts/index.tsx': "import { Fragment } from 'prosemirror-model';\nexport { Fragment };",
  });
  assert.deepEqual([...found.value], ['prosemirror-model']);
  assert.deepEqual(found.unresolved, []);
});

test('a stylesheet import is stepped over, not reported as unwalkable', () => {
  // A stylesheet cannot carry a second copy of an identity-compared module, so
  // reporting it would be noise that gets the gate switched off.
  const found = walk({
    'src/index.ts': "import './editor.css';\nimport { Fragment } from 'prosemirror-model';",
  });
  assert.deepEqual(found.unresolved, []);
  assert.deepEqual([...found.value], ['prosemirror-model']);
});

test('a relative import that resolves to nothing is reported, not skipped', () => {
  const found = walk({ 'src/index.ts': "export * from './missing.js';" });
  assert.equal(found.unresolved.length, 1);
  assert.equal(found.unresolved[0].specifier, './missing.js');
});

test('every source suffix the resolver claims to follow is actually followed', () => {
  // Pins the list itself: adding a suffix to SOURCE_SUFFIXES without teaching
  // the resolver about it would leave a gap this catches.
  for (const suffix of SOURCE_SUFFIXES) {
    const found = walk({
      'src/index.ts': "export * from './part.js';",
      [`src/part${suffix}`]: "import { Fragment } from 'prosemirror-model';\nexport { Fragment };",
    });
    assert.deepEqual([...found.value], ['prosemirror-model'], `suffix ${suffix} was not followed`);
    assert.deepEqual(found.unresolved, [], `suffix ${suffix} left an unresolved import`);
  }
});

test('isAssetImport recognises stylesheets and not sources', () => {
  assert.equal(isAssetImport('./editor.css'), true);
  assert.equal(isAssetImport('./editor.scss'), true);
  assert.equal(isAssetImport('./editor.tsx'), false);
  assert.equal(isAssetImport('./editor.js'), false);
});
