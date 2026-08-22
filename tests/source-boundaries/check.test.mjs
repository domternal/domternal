import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPOSITORY_EXEMPTIONS, sourceBoundaryViolations } from './check.mjs';

function kinds(source, file = 'fixture.ts', options) {
  return sourceBoundaryViolations(source, file, options).map(({ kind }) => kind);
}

test('accepts the shared @domternal/pm entry points and ordinary relative imports', () => {
  assert.deepEqual(
    kinds(`import { EditorState } from "@domternal/pm/state";\nexport { x } from './local.js';`),
    []
  );
});

test('finds relative module augmentations with either quote style', () => {
  const source = [
    `declare module "../commands.js" { interface Commands {} }`,
    `declare module './local.js' { interface Local {} }`,
    `declare module '@domternal/core' { interface Public {} }`,
  ].join('\n');
  assert.deepEqual(kinds(source), ['relative-module-augmentation', 'relative-module-augmentation']);
});

test('finds every static ProseMirror module form, including subpaths', () => {
  const source = [
    `import "prosemirror-state";`,
    `import type { EditorState } from 'prosemirror-state';`,
    `export { Node } from "prosemirror-model/dist/index.js";`,
    `import state = require('prosemirror-state');`,
    `type State = import("prosemirror-state").EditorState;`,
  ].join('\n');
  assert.deepEqual(kinds(source), Array(5).fill('direct-prosemirror-import'));
});

test('finds dynamic import and Node require call forms', () => {
  const source = [
    `const one = import("prosemirror-view");`,
    `const two = require('prosemirror-model');`,
    `const three = require.resolve("prosemirror-transform/subpath");`,
    `const four = module.require('prosemirror-schema-list');`,
  ].join('\n');
  assert.deepEqual(kinds(source), Array(4).fill('direct-prosemirror-import'));
});

test('does not mistake comments or ordinary strings for imports', () => {
  const source = [
    `// import x from "prosemirror-state"`,
    `const documentation = "require('prosemirror-view')";`,
    `const similarlyNamed = require('prosemirrorish-state');`,
  ].join('\n');
  assert.deepEqual(kinds(source), []);
});

test('the pm facade may import upstream packages but still may not augment relative modules', () => {
  const source = [
    `export * from 'prosemirror-state';`,
    `declare module "./state.js" { interface State {} }`,
  ].join('\n');
  assert.deepEqual(kinds(source, 'packages/pm/src/state.ts', { allowDirectProseMirror: true }), [
    'relative-module-augmentation',
  ]);
});

test('reports stable one-based source locations', () => {
  const [violation] = sourceBoundaryViolations(
    `const ok = true;\nexport * from "prosemirror-state";`,
    'fixture.ts'
  );
  assert.deepEqual(
    { line: violation.line, column: violation.column, specifier: violation.specifier },
    { line: 2, column: 15, specifier: 'prosemirror-state' }
  );
});

test('the real duplicate-copy negative control is the only repository exemption', () => {
  assert.deepEqual(
    [...REPOSITORY_EXEMPTIONS],
    [
      'core/src/utils/prosemirrorDuplicateCopy.test.ts\0direct-prosemirror-import\0prosemirror-model',
    ]
  );
});
