/**
 * Fixture tests for the range-agreement gate.
 *
 * The gate guards a failure that arrives once every few years and takes every
 * consumer with it, so its own logic has to be right the first time it matters:
 * there is no gradual signal, and by the time a lockfile shows two versions the
 * release is already out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARERS, caretsCanAgree, compare, parseCaret } from './check.mjs';

test('a caret range is read into a major and a floor', () => {
  assert.deepEqual(parseCaret('^1.25.4'), { major: 1, floor: [1, 25, 4] });
  assert.deepEqual(parseCaret(' ^2.0.0 '), { major: 2, floor: [2, 0, 0] });
});

test('anything that is not a plain caret is refused rather than guessed at', () => {
  /* A range this check cannot read is a range it cannot vouch for, and
     silently passing one would be worse than not checking at all. */
  for (const range of ['~1.2.3', '>=1.2.3', '1.2.3', '^1.2', '1.x', '*']) {
    assert.equal(parseCaret(range), null, range);
  }
});

test('two carets in one major can always be satisfied together', () => {
  // Today's real pair: @domternal/pm ships ^1.25.4, y-prosemirror asks ^1.7.1.
  assert.equal(caretsCanAgree('^1.25.4', '^1.7.1'), true);
  assert.equal(caretsCanAgree('^1.4.4', '^1.2.3'), true);
});

test('two carets in different majors can never be', () => {
  /* The failure this exists for. Nothing warns at install time: the package
     manager simply installs both, and ProseMirror throws on the first
     document. */
  assert.equal(caretsCanAgree('^2.0.0', '^1.7.1'), false);
  assert.equal(caretsCanAgree('^1.7.1', '^2.0.0'), false);
});

test('an unreadable range on either side is reported, not assumed to be fine', () => {
  assert.equal(caretsCanAgree('>=1.7.1', '^1.7.1'), null);
  assert.equal(caretsCanAgree('^1.7.1', '1.x'), null);
});

test('a disagreement names both declarations and the module', () => {
  const problems = compare(
    { dependencies: { 'prosemirror-model': '^2.0.0' } },
    { peerDependencies: { 'prosemirror-model': '^1.7.1' } },
    'y-prosemirror'
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /prosemirror-model/);
  assert.match(problems[0], /\^2\.0\.0/);
  assert.match(problems[0], /\^1\.7\.1/);
});

test('a module only one side names is not a disagreement', () => {
  /* y-prosemirror peers on yjs and y-protocols too, which @domternal/pm does
     not ship at all. Reporting those would be noise, and noise is how a gate
     gets switched off. */
  const problems = compare(
    { dependencies: { 'prosemirror-model': '^1.25.4' } },
    { peerDependencies: { 'prosemirror-model': '^1.7.1', yjs: '^13.5.38' } },
    'y-prosemirror'
  );
  assert.deepEqual(problems, []);
});

test('an unreadable range is reported with both sides quoted', () => {
  const problems = compare(
    { dependencies: { 'prosemirror-state': '>=1.4.4' } },
    { peerDependencies: { 'prosemirror-state': '^1.2.3' } },
    'y-prosemirror'
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /only understands caret ranges/);
});

test('y-prosemirror is watched, because it is the library that shares', () => {
  // The one package in the stack that declares ProseMirror as a peer and takes
  // whatever the application root offers.
  assert.ok(SHARERS.includes('y-prosemirror'));
});
