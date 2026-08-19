/**
 * Fixture tests for the command reader behind the ESM coverage check.
 *
 * This gate's output is a number, "133 commands across 15 dists, all
 * exercised", and a number is believed. It has to be false-proof in both
 * directions: a command declared in a dist must be found, and a call that tsc
 * never compiles must not count as exercising one. The second half is what an
 * adversarial review broke, so the input it used is pinned first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCalledCommands,
  declaredCommands,
  extractRawCommandsBodies,
} from './coverage-check.mjs';

test('a commented-out call does not count as exercising a command', () => {
  /* The review's exact input: one line of consumer.ts turned into a comment.
     Counted as a call, the gate kept printing "133 commands across 15 dists,
     all exercised" while nothing type-checked printDocument at all. */
  const source = ['editor.commands.focus();', '// editor.commands.printDocument();'].join('\n');
  assert.deepEqual([...collectCalledCommands(source)], ['focus']);
});

test('a call wrapped in a block comment does not count either', () => {
  assert.deepEqual([...collectCalledCommands('/* editor.commands.insertNbsp(); */')], []);
});

test('a call with a comment after it on the same line still counts', () => {
  const called = collectCalledCommands('editor.commands.focus(); // and nothing else');
  assert.deepEqual([...called], ['focus']);
});

test('a URL in a string does not swallow the rest of the line', () => {
  /* The failure this prevents is the opposite one: strip from `//` to end of
     line without knowing about strings and setLink's own line is truncated,
     which would leave a real call uncounted and fail the gate for no reason. */
  const source =
    "editor.commands.setLink({ href: 'https://example.com' });\neditor.commands.blur();";
  assert.deepEqual([...collectCalledCommands(source)].sort(), ['blur', 'setLink']);
});

test('the command directly after chain() or can() counts, and only that one', () => {
  /* Everything further along a chain is read off the returned builder, not off
     the commands surface, so the pattern stops there on purpose. Which is why
     consumer.ts spells each command out as `editor.commands.NAME(...)` rather
     than leaning on one long chain: the tail of a chain proves nothing here. */
  const called = collectCalledCommands(
    'editor.chain().focus().toggleBold().run();\neditor.can().toggleItalic();'
  );
  assert.deepEqual([...called].sort(), ['focus', 'toggleItalic']);
});

test('a nested brace in a signature does not end the RawCommands block early', () => {
  const dts = [
    'interface RawCommands {',
    '  insertTable: CommandSpec<[options?: { rows?: number }]>;',
    '  deleteTable: CommandSpec<[]>;',
    '}',
  ].join('\n');
  assert.deepEqual(declaredCommands(dts), ['insertTable', 'deleteTable']);
  assert.equal(extractRawCommandsBodies(dts).length, 1);
});

test('a declaration file with no RawCommands block declares no commands', () => {
  assert.deepEqual(declaredCommands('export declare const Thing: Extension;'), []);
});
