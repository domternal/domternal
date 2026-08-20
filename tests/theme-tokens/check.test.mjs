/**
 * Fixture tests for the theme token gate.
 *
 * This gate compares two sets and passes when they agree, which is the shape
 * that fails silently: everything about it still works when it has read
 * nothing at all, because nothing agrees with nothing. So these fixtures prove
 * the failing half first, that a token present on one side and absent on the
 * other is reported and named, and then pin every way the reading itself could
 * go quiet while the run stayed green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_DEF, names } from '../css-vars/check.mjs';
import {
  DARK,
  LIGHT,
  MINIMUM_TOKENS,
  audit,
  declaredTokens,
  mixinBodies,
  report,
} from './check.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (file) => ({ ...file, text: readFileSync(join(repoRoot, file.path), 'utf8') });

/** The two files as the gate sees them, with the bodies given here. */
const pair = (lightBody, darkBody) => [
  { ...LIGHT, text: `@mixin light-tokens($important: '') {\n${lightBody}\n}\n` },
  { ...DARK, text: `@mixin dark-tokens {\n${darkBody}\n}\n` },
];

test('a property one mixin declares and the other does not is reported, by name and by side', () => {
  /* The case the gate exists for, and the one that reaches paper: a token
     added to the dark palette alone has nothing to reset it when _print.scss
     re-emits light-tokens, so it prints at its dark value. */
  const result = audit(...pair('  --dm-bg: #fff;', '  --dm-bg: #1e1e1e;\n  --dm-text: #e0e0e0;'), 0);
  assert.deepEqual(result.onlyInDark, ['--dm-text']);
  assert.deepEqual(result.onlyInLight, []);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(report(result), [
    '--dm-text is declared by dark-tokens and not by light-tokens',
  ]);
});

test('the comparison runs the other way too, and says which way round it is', () => {
  /* Light beyond dark is the quieter defect rather than a harmless one:
     light-tokens is emitted !important on every printed editor, so a token
     only it carries is overridden on paper for a reader who never asked for a
     theme at all. */
  const result = audit(...pair('  --dm-bg: #fff;\n  --dm-paper: #fafafa;', '  --dm-bg: #1e1e1e;'), 0);
  assert.deepEqual(result.onlyInLight, ['--dm-paper']);
  assert.deepEqual(result.onlyInDark, []);
  assert.deepEqual(report(result), [
    '--dm-paper is declared by light-tokens and not by dark-tokens',
  ]);
});

test('two agreeing palettes report nothing, so a failure means a difference', () => {
  const body = '  --dm-bg: #fff;\n  --dm-text: #1a1a1a;';
  const result = audit(...pair(body, '  --dm-bg: #1e1e1e;\n  --dm-text: #e0e0e0;'), 0);
  assert.deepEqual(report(result), []);
  assert.equal(result.light.size, 2);
});

test('a declaration that lives only in a comment does not answer for the real one', () => {
  /* A value parked in a comment while somebody decides what to do with it.
     Read as a declaration it would hold the pairing down with nothing behind
     it, which is the failure the css-vars gate ran into first; withoutComments
     is imported from there so both gates answer this the same way. */
  const light = '  --dm-bg: #fff;\n  // --dm-text: #1a1a1a;\n  /* --dm-muted: #6b7280; */';
  const result = audit(...pair(light, '  --dm-bg: #1e1e1e;\n  --dm-text: #e0e0e0;'), 0);
  assert.deepEqual(result.onlyInDark, ['--dm-text']);
});

test('a property declared outside the mixin is not part of the palette', () => {
  /* _dark.scss ends with dark variants for the floating ToC outline and the
     inline /toc block. They mount outside .dm-editor, their light values live
     in _variables.scss, and there is no light mixin they could be paired
     against, so a walk over the file rather than the mixin would report every
     one of them and be wrong every time. */
  const [light, dark] = pair('  --dm-bg: #fff;', '  --dm-bg: #1e1e1e;');
  dark.text += '\n.dm-theme-dark .dm-toc-outline {\n  --dm-toc-tick-color: rgba(255, 255, 255, 0.3);\n}\n';
  const result = audit(light, dark, 0);
  assert.equal(result.dark.has('--dm-toc-tick-color'), false);
  assert.deepEqual(report(result), []);
});

test('the real dark file does declare properties outside its mixin', () => {
  /* The premise of the test above, pinned against the file itself rather than
     against a fixture that agrees with me. If those blocks ever move into the
     mixin, the narrow walk stops being the right one and this says so. */
  const dark = read(DARK);
  const [body] = declaredTokens(dark);
  const wholeFile = new Set(names(dark.text, CSS_DEF));
  const outside = [...wholeFile].filter((name) => !body.has(name));
  assert.ok(outside.length > 0, 'expected tokens below the mixin, found none');
  assert.ok(outside.some((name) => name.startsWith('--dm-toc-')), `unexpected set: ${outside}`);
});

test('a mixin that is not there fails, instead of agreeing with an equally empty twin', () => {
  /* The way this gate goes quiet. A rename, or a body the brace matcher could
     not follow, leaves two empty sets, and two empty sets are identical. */
  const [light, dark] = pair('  --dm-bg: #fff;', '  --dm-bg: #1e1e1e;');
  light.text = light.text.replace('light-tokens', 'palette-light');
  const result = audit(light, dark, 0);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /declares no @mixin light-tokens/);
  // Not also fifty-one names reported missing from a set nobody could read.
  assert.deepEqual(result.onlyInDark, []);
  assert.ok(report(result).length > 0);
});

test('two palettes that agree and are both too small fail the floor', () => {
  /* The half of the same failure a name check cannot see: both bodies read,
     both thin, both identical. A palette does not shrink to three, so this is
     a parse that stopped early. */
  const body = '  --dm-bg: #fff;\n  --dm-text: #111;';
  const result = audit(...pair(body, body), 3);
  assert.deepEqual(result.onlyInDark, []);
  assert.equal(result.problems.length, 2);
  for (const problem of result.problems) assert.match(problem, /below the floor of 3/);
});

test('a mixin defined twice is reported, and the body Sass uses is the one compared', () => {
  const [light, dark] = pair('  --dm-bg: #fff;', '  --dm-bg: #1e1e1e;');
  light.text += "@mixin light-tokens($important: '') {\n  --dm-bg: #fff;\n  --dm-late: #eee;\n}\n";
  const result = audit(light, dark, 0);
  assert.match(result.problems[0], /defines @mixin light-tokens 2 times/);
  assert.deepEqual(result.onlyInLight, ['--dm-late']);
});

test('a brace inside the body does not end it early', () => {
  /* Every declaration in light-tokens ends with `#{$important}`, and a nested
     block is ordinary Sass. Both open a brace, so a matcher that stopped at
     the first `}` would read one property and call the palette parsed. */
  const body = [
    "  --dm-bg: #ffffff#{$important};",
    '  @media (forced-colors: active) {',
    '    --dm-border-color: CanvasText;',
    '  }',
    "  --dm-text: #1a1a1a#{$important};",
  ].join('\n');
  const [found] = declaredTokens({ ...LIGHT, text: `@mixin light-tokens($important: '') {\n${body}\n}\n` });
  assert.deepEqual([...found], ['--dm-bg', '--dm-border-color', '--dm-text']);
});

test('a mixin whose name merely starts the same is a different mixin', () => {
  assert.deepEqual(mixinBodies('@mixin light-tokens-extra {\n  --dm-bg: #fff;\n}', 'light-tokens'), []);
  assert.deepEqual(mixinBodies('@mixin light-tokens {\n  --dm-bg: #fff;\n}', 'light-tokens'), [
    '\n  --dm-bg: #fff;\n',
  ]);
});

test('the palettes this repository ships are the same set today', () => {
  /* The gate run as the CI step runs it. The two landmarks are the first and
     last declarations of both bodies, so a body read from one end to the other
     is the only way to hold them. */
  const result = audit(read(LIGHT), read(DARK));
  assert.deepEqual(report(result), []);
  assert.ok(
    result.light.size >= MINIMUM_TOKENS,
    `expected at least ${MINIMUM_TOKENS} properties, got ${result.light.size}`
  );
  for (const palette of [result.light, result.dark]) {
    assert.ok(palette.has('--dm-color-scheme'), 'the first declaration of the body');
    assert.ok(palette.has('--dm-block-selected-halo'), 'the last declaration of the body');
  }
});
