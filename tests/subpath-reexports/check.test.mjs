/**
 * Fixture tests for the parsers and comparisons behind the subpath re-export
 * gate. The gate is only worth having if it accepts exactly the shape tsup and
 * rollup emit for a re-export and rejects every shape that would carry a second
 * copy of the registries, so both directions are pinned here against the
 * observed output and hand-written regressions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWN_BUNDLE_SUBPATHS,
  SUBPATHS,
  declarationExports,
  entryFiles,
  excerpt,
  mainParity,
  missingExperimentalTags,
  nameAgreement,
  parseCjsReexport,
  parseCoreArgument,
  parseEsmReexport,
  parseProbeOutput,
  resolveSubpath,
  undeclaredSubpaths,
} from './check.mjs';

// What tsup 8.5.1 emits for the clipboard subpath, comments included.
const OBSERVED_ESM = `export { armClipboardPasteTransaction, getClipboardImageDestination, setClipboardPasteBehavior } from './index.js';
//# sourceMappingURL=clipboard.js.map
//# sourceMappingURL=clipboard.js.map`;

const OBSERVED_CJS = `'use strict';

var index_cjs = require('./index.cjs');



Object.defineProperty(exports, "armClipboardPasteTransaction", {
  enumerable: true,
  get: function () { return index_cjs.armClipboardPasteTransaction; }
});
Object.defineProperty(exports, "setClipboardPasteBehavior", {
  enumerable: true,
  get: function () { return index_cjs.setClipboardPasteBehavior; }
});
//# sourceMappingURL=clipboard.cjs.map
//# sourceMappingURL=clipboard.cjs.map`;

test('the observed ESM re-export is accepted with its names', () => {
  const { names, problems } = parseEsmReexport(OBSERVED_ESM, './index.js');
  assert.deepEqual(problems, []);
  assert.deepEqual(names, ['armClipboardPasteTransaction', 'getClipboardImageDestination', 'setClipboardPasteBehavior']);
});

test('an ESM file that bundles its own copy is rejected once with the first foreign statement', () => {
  const bundled = `import '@domternal/pm/view';
var behaviors = new WeakMap();
function setClipboardPasteBehavior() { behaviors.set(1, 2); }
export { setClipboardPasteBehavior };`;
  const { problems } = parseEsmReexport(bundled, './index.js');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /found 4 other statements, the first: import '@domternal\/pm\/view'/);
});

test('an ESM star re-export is rejected, because it hides which names the subpath publishes', () => {
  const { problems } = parseEsmReexport("export * from './index.js';", './index.js');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /only named re-exports/);
});

test('an ESM file that re-exports the CommonJS main is rejected', () => {
  const { problems } = parseEsmReexport("export { a } from './index.cjs';", './index.js');
  assert.deepEqual(problems, ['ESM subpath: re-exports ./index.cjs, expected ./index.js']);
});

test('an ESM rename is rejected, while a same-name alias is accepted', () => {
  assert.match(parseEsmReexport("export { a as b } from './index.js';", './index.js').problems[0], /renames a to b/);
  assert.deepEqual(parseEsmReexport("export { a as a } from './index.js';", './index.js'), { names: ['a'], problems: [] });
});

test('an empty ESM file is rejected', () => {
  assert.deepEqual(parseEsmReexport('//# sourceMappingURL=x.map', './index.js').problems, ['ESM subpath: re-exports nothing']);
});

test('the observed CommonJS re-export is accepted with its names', () => {
  const { names, problems } = parseCjsReexport(OBSERVED_CJS, './index.cjs');
  assert.deepEqual(problems, []);
  assert.deepEqual(names, ['armClipboardPasteTransaction', 'setClipboardPasteBehavior']);
});

test('assignment re-exports and the __esModule marker are accepted', () => {
  const text = `"use strict";
Object.defineProperty(exports, '__esModule', { value: true });
const main = require("./index.cjs");
exports.a = main.a;`;
  assert.deepEqual(parseCjsReexport(text, './index.cjs'), { names: ['a'], problems: [] });
});

test('a CommonJS file that requires the ESM main is rejected, since require(esm) would load a second copy', () => {
  const text = OBSERVED_CJS.replace("require('./index.cjs')", "require('./index.js')");
  assert.deepEqual(parseCjsReexport(text, './index.cjs').problems, ['CommonJS subpath: requires ./index.js, expected ./index.cjs']);
});

test('a CommonJS file with a bundled copy or an extra require is rejected', () => {
  const bundled = `'use strict';
require('@domternal/pm/view');
var behaviors = new WeakMap();`;
  const bundledProblems = parseCjsReexport(bundled, './index.cjs').problems;
  assert.match(bundledProblems[0], /found: require\('@domternal\/pm\/view'\); var behaviors/);
  assert.ok(bundledProblems.includes('CommonJS subpath: expected exactly one require, found 0'));

  const twice = `var a = require('./index.cjs');
var b = require('./index.cjs');
exports.x = a.x;`;
  assert.deepEqual(parseCjsReexport(twice, './index.cjs').problems, ['CommonJS subpath: expected exactly one require, found 2']);
});

test('a CommonJS getter that reads another binding or another name is rejected', () => {
  const other = `var main = require('./index.cjs');
var copy = main;
exports.a = main.a;`;
  assert.match(parseCjsReexport(other, './index.cjs').problems[0], /found: var copy = main;/);
  const renamed = `var main = require('./index.cjs');
exports.a = main.b;`;
  assert.deepEqual(parseCjsReexport(renamed, './index.cjs').problems, ['CommonJS subpath: exports a from b']);
});

test('declaration exports separate values from types across every export form', () => {
  const text = `import { EditorView } from '@domternal/pm/view';
/** export { commented } from './nowhere'; */
interface Hidden { a: string }
declare function helper(): void;
export declare function declared(): void;
export declare const constant: number;
export declare class Service {}
export interface Shape { a: string }
export type Alias = string;
export { type ClipboardPasteBehavior, setClipboardPasteBehavior, internal as renamed };
export type { OnlyType } from './types';
export * from './star';`;
  const { values, types, stars } = declarationExports(text);
  assert.deepEqual([...values].sort(), ['Service', 'constant', 'declared', 'renamed', 'setClipboardPasteBehavior']);
  assert.deepEqual([...types].sort(), ['Alias', 'ClipboardPasteBehavior', 'OnlyType', 'Shape']);
  assert.equal(stars, 1);
});

test('an experimental subpath needs the tag on the declaration of every exported name', () => {
  const text = `import { EditorView } from '@domternal/pm/view';
/** Plain description. */
interface Shape { a: string }
/** @experimental Tagged. */
type Alias = string;
/**
 * @experimental Tagged over several lines.
 */
declare function tagged(view: EditorView): void;
/** @experimental Tags only the declaration it precedes. */
declare function first(): void;
declare function second(): void;
export { type Alias, type Shape, first, second, tagged, type Missing };`;
  assert.deepEqual(missingExperimentalTags(text, ['Alias', 'Missing', 'Shape', 'first', 'second', 'tagged']), ['Missing', 'Shape', 'second']);
});

test('the clipboard subpath is declared experimental', () => {
  assert.equal(SUBPATHS.find((declared) => declared.subpath === './clipboard')?.experimental, true);
});

test('name agreement names the file whose set differs', () => {
  assert.deepEqual(nameAgreement({ esm: ['a', 'b'], cjs: ['b', 'a'], dts: new Set(['a', 'b']), dcts: new Set(['a', 'b']) }, 'x'), []);
  const problems = nameAgreement({ esm: ['a', 'b'], cjs: ['a'], dts: new Set(['a', 'b']), dcts: new Set(['a', 'b', 'c']) }, 'x');
  assert.deepEqual(problems, [
    'x: the CommonJS file exports a, the ESM file a, b',
    'x: the CommonJS declarations exports a, b, c, the ESM file a, b',
  ]);
});

const main = { values: new Set(['Editor', 'writeToClipboard']), types: new Set(['EditorOptions']) };
const subpath = { values: new Set(['registerA']), types: new Set(['APolicy']) };

test('main parity accepts a runtime that hides exactly the subpath names', () => {
  assert.deepEqual(mainParity({
    runtimeKeys: ['Editor', 'writeToClipboard', 'registerA'], mainDeclarations: main,
    subpathDeclarations: subpath, subpathNames: ['registerA'],
  }, 'x'), []);
});

test('main parity rejects a leaked helper, a missing binding and a name the runtime lacks', () => {
  const problems = mainParity({
    runtimeKeys: ['Editor', 'internalHelper'], mainDeclarations: main,
    subpathDeclarations: subpath, subpathNames: ['registerA'],
  }, 'x');
  assert.deepEqual(problems, [
    'x: the main runtime exports undeclared names that no subpath re-exports: internalHelper',
    'x: subpath names missing from the main runtime or declared on it: registerA',
    'x: the main declarations name values the runtime lacks: writeToClipboard',
  ]);
});

test('main parity rejects a subpath value or type the main declarations also export', () => {
  const advertised = { values: new Set([...main.values, 'registerA']), types: new Set([...main.types, 'APolicy']) };
  const problems = mainParity({
    runtimeKeys: ['Editor', 'writeToClipboard', 'registerA'], mainDeclarations: advertised,
    subpathDeclarations: subpath, subpathNames: ['registerA'],
  }, 'x');
  assert.deepEqual(problems, [
    'x: subpath names missing from the main runtime or declared on it: registerA',
    'x: the main declarations also export APolicy, registerA',
  ]);
});

const manifest = {
  name: '@domternal/core',
  exports: {
    '.': { '@domternal/source': './src/index.ts', import: { types: './dist/index.d.ts', default: './dist/index.js' }, require: { types: './dist/index.d.cts', default: './dist/index.cjs' } },
    './clipboard': { '@domternal/source': './src/clipboard.ts', import: { types: './dist/clipboard.d.ts', default: './dist/clipboard.js' }, require: { types: './dist/clipboard.d.cts', default: './dist/clipboard.cjs' } },
    './locales/de': { import: { types: './dist/locales/de.d.ts', default: './dist/locales/de.js' } },
  },
};

test('entry files follow import and require, never the source condition', () => {
  assert.deepEqual(entryFiles(manifest.exports['./clipboard']), {
    esm: './dist/clipboard.js', cjs: './dist/clipboard.cjs', esmTypes: './dist/clipboard.d.ts', cjsTypes: './dist/clipboard.d.cts',
  });
});

test('a declared subpath resolves next to its main files', () => {
  const { problems, main: mainFiles, files } = resolveSubpath(manifest, './clipboard');
  assert.deepEqual(problems, []);
  assert.equal(mainFiles.esm, './dist/index.js');
  assert.equal(files.cjs, './dist/clipboard.cjs');
});

test('a missing, incomplete or displaced subpath is reported', () => {
  assert.deepEqual(resolveSubpath(manifest, './missing').problems, ['exports has no "./missing"; the subpath is not published']);
  const incomplete = { exports: { ...manifest.exports, './clipboard': { import: './dist/clipboard.js' } } };
  assert.deepEqual(resolveSubpath(incomplete, './clipboard').problems, [
    'exports["./clipboard"] names no cjs target',
    'exports["./clipboard"] names no esmTypes target',
    'exports["./clipboard"] names no cjsTypes target',
  ]);
  const displaced = structuredClone(manifest);
  displaced.exports['./clipboard'].import.default = './dist/sub/clipboard.js';
  assert.deepEqual(resolveSubpath(displaced, './clipboard').problems, [
    './dist/sub/clipboard.js is not next to ./dist/index.js, so it cannot re-export it relatively',
  ]);
});

test('only declared and locale subpaths may exist on a checked package', () => {
  assert.deepEqual(undeclaredSubpaths(manifest, new Set(['./clipboard'])), []);
  assert.deepEqual(undeclaredSubpaths(manifest, new Set()), ['./clipboard']);
  assert.ok(OWN_BUNDLE_SUBPATHS.test('./locales/de'));
  assert.ok(!OWN_BUNDLE_SUBPATHS.test('./clipboard'));
});

test('the declared subpaths name workspace packages', () => {
  for (const declared of SUBPATHS) {
    assert.match(declared.package, /^@domternal\//);
    assert.match(declared.subpath, /^\.\/[a-z]/);
    assert.match(declared.directory, /^packages\//);
  }
});

test('probe output is read from its prefixed line only', () => {
  const result = { kind: 'esm', checks: [] };
  assert.deepEqual(parseProbeOutput(`noise\nSUBPATH_REEXPORT_RESULT ${JSON.stringify(result)}\nmore`), result);
  assert.equal(parseProbeOutput('no result'), null);
  assert.equal(parseProbeOutput('SUBPATH_REEXPORT_RESULT {broken'), null);
});

test('the --core argument selects another built copy', () => {
  assert.equal(parseCoreArgument([], '/fallback'), '/fallback');
  assert.equal(parseCoreArgument(['--core', '/elsewhere'], '/fallback'), '/elsewhere');
  assert.throws(() => parseCoreArgument(['--core'], '/fallback'), /--core needs a package directory/);
});

test('excerpts are one bounded line', () => {
  assert.equal(excerpt('a\n\n  b'), 'a b');
  assert.equal(excerpt('x'.repeat(200)).length, 123);
});
