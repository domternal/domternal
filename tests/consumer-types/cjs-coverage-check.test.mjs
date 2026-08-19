/**
 * Fixture tests for the exports-map reader behind the CJS coverage check.
 *
 * The check is only worth having if it tells an ESM-only package apart from
 * one that ships a `require` condition, and if it reads the map that is
 * actually published rather than the development-time one. Both are exercised
 * here against the real shapes this repository uses, including the two that
 * motivated the check: the source-condition map on core and the plain
 * import-only map on the framework wrappers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, collectRequiredSpecifiers, rootRequireEntry, typesTarget } from './cjs-coverage-check.mjs';

test('the types target of a condition is read directly', () => {
  assert.equal(typesTarget({ types: './dist/index.d.cts', default: './dist/index.cjs' }), './dist/index.d.cts');
});

test('a types target nested under default is followed inward', () => {
  assert.equal(typesTarget({ default: { types: './dist/index.d.cts' } }), './dist/index.d.cts');
});

test('a bare string target has no types of its own', () => {
  assert.equal(typesTarget('./dist/index.cjs'), null);
});

test('a package with a require condition ships a CommonJS entry', () => {
  const entry = rootRequireEntry({
    name: '@domternal/extension-table',
    exports: {
      '.': {
        import: { types: './dist/index.d.ts', default: './dist/index.js' },
        require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
      },
    },
  });
  assert.deepEqual(entry, { specifier: '@domternal/extension-table', types: './dist/index.d.cts' });
});

test('an import-only package ships none', () => {
  assert.equal(
    rootRequireEntry({
      name: '@domternal/react',
      exports: {
        '.': {
          '@domternal/source': './src/index.ts',
          import: { types: './dist/index.d.ts', default: './dist/index.js' },
        },
      },
    }),
    null
  );
});

test('a package with no JS entry at all ships none', () => {
  assert.equal(
    rootRequireEntry({
      name: '@domternal/theme',
      exports: { '.': { types: './index.d.ts', default: './dist/domternal-theme.css' } },
    }),
    null
  );
});

test('a subpath-only package has no root entry to check', () => {
  assert.equal(
    rootRequireEntry({
      name: '@domternal/pm',
      exports: { './model': { require: { types: './src/model.d.cts' } } },
    }),
    null
  );
});

test('publishConfig.exports wins over the development-time map', () => {
  const entry = rootRequireEntry({
    name: '@domternal/core',
    exports: { '.': { '@domternal/source': './src/index.ts' } },
    publishConfig: {
      exports: { '.': { require: { types: './dist/index.d.cts', default: './dist/index.cjs' } } },
    },
  });
  assert.deepEqual(entry, { specifier: '@domternal/core', types: './dist/index.d.cts' });
});

test('the require form in the fixture is collected', () => {
  const found = collectRequiredSpecifiers(
    "import core = require('@domternal/core');\nimport table = require('@domternal/extension-table');"
  );
  assert.deepEqual([...found].sort(), ['@domternal/core', '@domternal/extension-table']);
});

test('an ESM import in the fixture is not collected', () => {
  // It would not compile in a .cts file, and it would resolve the wrong graph.
  assert.deepEqual([...collectRequiredSpecifiers("import '@domternal/extension-toc';")], []);
});

test('a commented-out require is not collected, which is how this check was defeated', () => {
  /* The review's exact input: line 36 of consumer-cjs.cts commented out and
     its two uses deleted. Read as text, the comment still matched, so the gate
     printed "12 of 12 CommonJS entries imported" while
     packages/extension-toc/dist/index.d.cts was never loaded by tsc. */
  const source = [
    "import table = require('@domternal/extension-table');",
    "// import toc = require('@domternal/extension-toc');",
  ].join('\n');
  assert.deepEqual([...collectRequiredSpecifiers(source)], ['@domternal/extension-table']);
});

test('a require commented out with a block comment is not collected either', () => {
  assert.deepEqual(
    [...collectRequiredSpecifiers("/* import toc = require('@domternal/extension-toc'); */")],
    []
  );
});

test('a require that is not an import binding is not collected', () => {
  /* Only `import x = require('...')` compiles in a .cts file, so anything else
     naming a package is prose or a runtime call, not a declaration graph tsc
     will read. */
  const source = "const toc = require('@domternal/extension-toc');";
  assert.deepEqual([...collectRequiredSpecifiers(source)], []);
});

test('a shipping dependency that is not imported fails', () => {
  const result = audit({
    shipping: [{ specifier: '@domternal/extension-toc' }],
    dependencies: new Set(['@domternal/extension-toc']),
    required: new Set(),
  });
  assert.deepEqual(result.missing, ['@domternal/extension-toc']);
  assert.deepEqual(result.unreachable, []);
});

test('a shipping package that is not a dependency is reported as unreachable, not missing', () => {
  const result = audit({
    shipping: [{ specifier: '@domternal/extension-block-menu' }],
    dependencies: new Set(),
    required: new Set(),
  });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unreachable, ['@domternal/extension-block-menu']);
});

test('an import of something no package ships is stale', () => {
  const result = audit({
    shipping: [],
    dependencies: new Set(),
    required: new Set(['@domternal/extension-gone']),
  });
  assert.deepEqual(result.stale, ['@domternal/extension-gone']);
});

test('a fully imported set is clean', () => {
  const result = audit({
    shipping: [{ specifier: '@domternal/core' }],
    dependencies: new Set(['@domternal/core']),
    required: new Set(['@domternal/core']),
  });
  assert.deepEqual(result, { missing: [], unreachable: [], stale: [] });
});
