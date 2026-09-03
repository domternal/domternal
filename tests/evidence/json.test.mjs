/**
 * Python compatibility of the evidence JSON primitives.
 *
 * PYTHON_VECTORS were generated once with CPython 3.13.2, the interpreter the
 * original evidence scripts ran under, using only its standard `json` module:
 * each row is a name, a mode, the source text `json.dumps(value)` produced and
 * the text `json.dumps(value, **mode)` produced. CI has no Python, so the
 * expected strings are kept here as literals; they cover ensure_ascii escaping
 * (including DEL and surrogate pairs), float repr at every layout boundary,
 * integers beyond 2**53, indentation of empty containers, and code point key
 * order with a key outside the Basic Multilingual Plane.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvidenceJsonError,
  PyFloat,
  PyInt,
  canonicalBytes,
  codePointCompare,
  compactBytes,
  decodeUtf8,
  getPointer,
  indentedBytes,
  numberValue,
  parseJson,
  pointerDiff,
  pointerToken,
  pythonDumps,
  pythonFloatRepr,
  pythonReadText,
  pythonUtcIsoformat,
  sha256,
} from './json.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PYTHON_VECTORS = [
  ["escapes", "indent2-ascii", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}", "{\n  \"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"\n}"],
  ["escapes", "indent2-utf8", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}", "{\n  \"s\": \"\u017d \u2713 \u203a \u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \ud83d\ude00 \u2028 \u00e9\"\n}"],
  ["escapes", "canonical", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}", "{\"s\":\"\u017d \u2713 \u203a \u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \ud83d\ude00 \u2028 \u00e9\"}"],
  ["escapes", "compact-ascii", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}", "{\"s\":\"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}"],
  ["escapes", "default", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}", "{\"s\": \"\\u017d \\u2713 \\u203a \\u007f \\u0001 \\n\\t\\b\\f\\r \\\"q\\\" \\\\ \\ud83d\\ude00 \\u2028 \\u00e9\"}"],
  ["nested", "indent2-ascii", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}", "{\n  \"b\": [\n    1,\n    [],\n    {},\n    [\n      2,\n      {\n        \"x\": null\n      }\n    ]\n  ],\n  \"a\": true,\n  \"c\": false\n}"],
  ["nested", "indent2-utf8", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}", "{\n  \"b\": [\n    1,\n    [],\n    {},\n    [\n      2,\n      {\n        \"x\": null\n      }\n    ]\n  ],\n  \"a\": true,\n  \"c\": false\n}"],
  ["nested", "canonical", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}", "{\"a\":true,\"b\":[1,[],{},[2,{\"x\":null}]],\"c\":false}"],
  ["nested", "compact-ascii", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}", "{\"b\":[1,[],{},[2,{\"x\":null}]],\"a\":true,\"c\":false}"],
  ["nested", "default", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}", "{\"b\": [1, [], {}, [2, {\"x\": null}]], \"a\": true, \"c\": false}"],
  ["floats", "indent2-ascii", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]", "[\n  20.0,\n  1e-05,\n  0.0001,\n  1e+16,\n  1000000000000000.0,\n  123.456,\n  0.1,\n  0.3333333333333333,\n  5e-324,\n  1.7976931348623157e+308,\n  -0.0,\n  100.0,\n  1e+22,\n  1.2345678901234568e+16,\n  1234567890123456.0,\n  802902.19,\n  313169.96300000005,\n  2.5e-07,\n  -1.5e+300\n]"],
  ["floats", "indent2-utf8", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]", "[\n  20.0,\n  1e-05,\n  0.0001,\n  1e+16,\n  1000000000000000.0,\n  123.456,\n  0.1,\n  0.3333333333333333,\n  5e-324,\n  1.7976931348623157e+308,\n  -0.0,\n  100.0,\n  1e+22,\n  1.2345678901234568e+16,\n  1234567890123456.0,\n  802902.19,\n  313169.96300000005,\n  2.5e-07,\n  -1.5e+300\n]"],
  ["floats", "canonical", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]", "[20.0,1e-05,0.0001,1e+16,1000000000000000.0,123.456,0.1,0.3333333333333333,5e-324,1.7976931348623157e+308,-0.0,100.0,1e+22,1.2345678901234568e+16,1234567890123456.0,802902.19,313169.96300000005,2.5e-07,-1.5e+300]"],
  ["floats", "compact-ascii", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]", "[20.0,1e-05,0.0001,1e+16,1000000000000000.0,123.456,0.1,0.3333333333333333,5e-324,1.7976931348623157e+308,-0.0,100.0,1e+22,1.2345678901234568e+16,1234567890123456.0,802902.19,313169.96300000005,2.5e-07,-1.5e+300]"],
  ["floats", "default", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]", "[20.0, 1e-05, 0.0001, 1e+16, 1000000000000000.0, 123.456, 0.1, 0.3333333333333333, 5e-324, 1.7976931348623157e+308, -0.0, 100.0, 1e+22, 1.2345678901234568e+16, 1234567890123456.0, 802902.19, 313169.96300000005, 2.5e-07, -1.5e+300]"],
  ["ints", "indent2-ascii", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]", "[\n  0,\n  -1,\n  9007199254740991,\n  18446744073709551616,\n  -18446744073709551617\n]"],
  ["ints", "indent2-utf8", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]", "[\n  0,\n  -1,\n  9007199254740991,\n  18446744073709551616,\n  -18446744073709551617\n]"],
  ["ints", "canonical", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]", "[0,-1,9007199254740991,18446744073709551616,-18446744073709551617]"],
  ["ints", "compact-ascii", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]", "[0,-1,9007199254740991,18446744073709551616,-18446744073709551617]"],
  ["ints", "default", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]", "[0, -1, 9007199254740991, 18446744073709551616, -18446744073709551617]"],
  ["astral-keys", "canonical", "{\"\\uffff\": 1, \"\\ud83d\\ude00\": 2, \"a\": 3, \"\\ue000\": 4, \"Z\": 5}", "{\"Z\":5,\"a\":3,\"\ue000\":4,\"\uffff\":1,\"\ud83d\ude00\":2}"],
  ["astral-sorted-ascii", "sorted-ascii", "{\"\\uffff\": 1, \"\\ud83d\\ude00\": 2, \"a\": 3, \"\\ue000\": 4, \"Z\": 5}", "{\"Z\": 5, \"a\": 3, \"\\ue000\": 4, \"\\uffff\": 1, \"\\ud83d\\ude00\": 2}"],
  ["reparse", "indent2-ascii", "{\"a\": 20.0, \"b\": 1E5, \"c\": 1.10, \"d\": -0, \"e\": -0.0, \"f\": 12345678901234567890, \"g\": 1e-7, \"h\": 0.5}", "{\n  \"a\": 20.0,\n  \"b\": 100000.0,\n  \"c\": 1.1,\n  \"d\": 0,\n  \"e\": -0.0,\n  \"f\": 12345678901234567890,\n  \"g\": 1e-07,\n  \"h\": 0.5\n}"],
];

const MODES = {
  'indent2-ascii': { indent: 2, ensureAscii: true },
  'indent2-utf8': { indent: 2, ensureAscii: false },
  canonical: { ensureAscii: false, sortKeys: true, separators: [',', ':'] },
  'compact-ascii': { ensureAscii: true, separators: [',', ':'] },
  default: {},
  'sorted-ascii': { sortKeys: true },
};

test('every CPython json.dumps vector is reproduced byte for byte', () => {
  for (const [name, mode, source, expected] of PYTHON_VECTORS) {
    assert.equal(pythonDumps(parseJson(source), MODES[mode]), expected, `${name} in ${mode}`);
  }
});

test('the canonical digest input is UTF-8 bytes of the sorted compact form', () => {
  const value = { b: 1, a: [String.fromCodePoint(0x17d)] };
  assert.deepEqual(canonicalBytes(value), Buffer.from(`{"a":["${String.fromCodePoint(0x17d)}"],"b":1}`, 'utf8'));
  assert.equal(sha256(canonicalBytes([])), sha256('[]'));
});

test('parsing keeps the Python type of every number', () => {
  const value = parseJson('{"a": 20.0, "b": 1E5, "c": 1.10, "d": -0, "e": -0.0, "f": 12345678901234567890, "g": 7}');
  assert.ok(value.a instanceof PyFloat && value.a.value === 20);
  assert.ok(value.b instanceof PyFloat && value.b.value === 100000);
  assert.equal(value.c, 1.1);
  assert.ok(Object.is(value.d, 0), 'the integer lexeme -0 is the Python int 0');
  assert.ok(value.e instanceof PyFloat && Object.is(value.e.value, -0));
  assert.ok(value.f instanceof PyInt && value.f.value === 12345678901234567890n);
  assert.equal(value.g, 7);
  assert.equal(String(value.a), '20.0');
  assert.equal(numberValue(value.a), 20);
  assert.throws(() => numberValue(value.f), EvidenceJsonError);
});

test('values Node cannot reproduce exactly are refused, never approximated', () => {
  // Python json.loads accepts these literals and json.dumps writes them back; they are not JSON.
  for (const text of ['[NaN]', '[Infinity]', '[-Infinity]']) assert.throws(() => parseJson(text), SyntaxError, text);
  assert.throws(() => parseJson('[1e400]'), EvidenceJsonError, 'overflow to infinity');
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -0, undefined, () => 1, new Date(0), new Map()]) {
    assert.throws(() => pythonDumps([value]), EvidenceJsonError, String(value));
  }
  const lone = String.fromCharCode(0xd800);
  assert.throws(() => pythonDumps(lone, { ensureAscii: false }), EvidenceJsonError, 'a lone surrogate has no UTF-8 form');
  assert.equal(pythonDumps(lone), '"\\ud800"', 'with ensure_ascii Python escapes it');
  const cycle = [];
  cycle.push(cycle);
  assert.throws(() => pythonDumps(cycle), /Circular/);
  assert.throws(() => pythonDumps(new Array(2)), /Sparse/);
});

test('keys JS would reorder are refused unless sorting makes order irrelevant', () => {
  assert.throws(() => parseJson('{"b": 1, "10": 2}'), /array index/);
  assert.throws(() => parseJson('{"__proto__": 1}'), EvidenceJsonError);
  assert.throws(() => pythonDumps({ b: 1, 10: 2 }), /insertion order/);
  assert.equal(pythonDumps({ b: 1, 10: 2 }, { sortKeys: true }), '{"10": 2, "b": 1}');
  assert.deepEqual(parseJson('[[1, 2], {"a": [3]}]'), [[1, 2], { a: [3] }]);
});

test('code point order differs from UTF-16 order for astral characters', () => {
  const astral = String.fromCodePoint(0x1f600);
  const high = String.fromCodePoint(0xffff);
  assert.equal(codePointCompare(high, astral), -1);
  assert.ok(astral < high, 'plain JS string comparison orders them the other way');
  assert.equal(codePointCompare('a', 'a'), 0);
  assert.equal(codePointCompare('a', 'ab'), -1);
  assert.equal(codePointCompare('b', 'ab'), 1);
});

test('float repr follows the Python layout rules at every boundary', () => {
  const cases = [
    [20, '20.0'], [0.0001, '0.0001'], [0.00001, '1e-05'], [1e15, '1000000000000000.0'], [1e16, '1e+16'],
    [123.456, '123.456'], [-0, '-0.0'], [0, '0.0'], [5e-324, '5e-324'], [1.5e300, '1.5e+300'], [2.5e-7, '2.5e-07'],
  ];
  for (const [value, expected] of cases) assert.equal(pythonFloatRepr(value), expected, String(value));
  assert.equal(pythonDumps([new PyFloat(20), 20, 0.5, new PyInt(2n ** 64n), 2n ** 70n]), '[20.0, 20, 0.5, 18446744073709551616, 1180591620717411303424]');
});

test('bytes are read the way Path.read_text() reads them', () => {
  assert.equal(pythonReadText(Buffer.from('a\r\nb\rc\n', 'utf8')), 'a\nb\nc\n');
  assert.throws(() => decodeUtf8(Buffer.from([0xff, 0xfe, 0x41])), TypeError, 'invalid UTF-8 is an error, not a replacement character');
  assert.equal(decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).length, 2, 'a byte order mark stays a character');
});

test('timestamps match datetime.isoformat() for UTC', () => {
  assert.equal(pythonUtcIsoformat(new Date('2026-09-27T07:00:32.762Z')), '2026-09-27T07:00:32.762000+00:00');
  assert.equal(pythonUtcIsoformat(new Date('2026-09-27T07:00:32.000Z')), '2026-09-27T07:00:32+00:00');
});

test('JSON pointers resolve escaped tokens and report absent paths', () => {
  const document = { 'a/b': { '~c': [10, 20] } };
  assert.equal(getPointer(document, '/a~1b/~0c/1'), 20);
  assert.equal(getPointer(document, '/missing'), undefined);
  assert.equal(getPointer(document, ''), document);
  assert.equal(pointerToken('a/~'), 'a~1~0');
  assert.throws(() => getPointer(document, 'a'), EvidenceJsonError);
});

test('a pointer diff names additions, removals, replacements and reordering', () => {
  const before = parseJson('{"a": 1, "b": [1, 2], "c": {"x": 1, "y": 2}, "d": 20.0}');
  const after = parseJson('{"a": 2, "b": [1], "c": {"y": 2, "x": 1}, "d": 20, "e": true}');
  const ops = pointerDiff(before, after).map((op) => `${op.op} ${op.path}`);
  assert.deepEqual(ops, ['replace /a', 'remove /b/1', 'reorder /c', 'replace /d', 'add /e']);
  assert.deepEqual(pointerDiff(before, parseJson('{"a": 1, "b": [1, 2], "c": {"x": 1, "y": 2}, "d": 20.0}')), []);
});

test('the committed Free evidence reproduces through parse and dump', () => {
  for (const [path, ensureAscii] of [
    ['e2e/paste-cleanup-results/2026-09-27-styled-breaks.json', true],
    ['e2e/paste-cleanup-results/2026-09-27-list-markers.json', false],
  ]) {
    const bytes = readFileSync(join(repoRoot, path));
    assert.ok(indentedBytes(parseJson(bytes), { ensureAscii }).equals(bytes), path);
    assert.ok(compactBytes([1]).equals(Buffer.from('[1]')));
  }
});
