/**
 * Fixture tests for the frozen-contract gate.
 *
 * A gate that cannot see a violation is worse than no gate, because it reads
 * as proof. So the shapes that actually occur are pinned here: calls spread
 * over four lines, a template literal in the consumer argument, a namespaced
 * import, a deliberate observed registration, and prose that mentions an
 * export inside a comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FROZEN,
  auditSource,
  extractAdvice,
  bareName,
  collectCalls,
  parseDocumentedTable,
  splitArgs,
  stripComments,
} from './check.mjs';

test('a correct registration passes', () => {
  const source = "assertSingleProseMirrorCopy('yjs', Doc, '@domternal-pro/extension-collaboration');";
  assert.deepEqual(auditSource(source), []);
});

test('the wrong export for a module is caught', () => {
  /* The failure this whole gate exists for: `Map` and `Doc` are both yjs
     exports, so nothing else in the stack would object, and the result is two
     packages that agree being reported as a conflict. */
  const source = "assertSingleProseMirrorCopy('yjs', Map, '@domternal-pro/extension-comments');";
  const problems = auditSource(source);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'wrong-export');
  assert.match(problems[0].detail, /must be registered with `Doc`/);
});

test('a namespaced import is the same export', () => {
  // `import * as Y from 'yjs'` is as valid as a named import, and both reach
  // the identical class.
  assert.equal(bareName('Y.Doc'), 'Doc');
  assert.deepEqual(
    auditSource("assertSingleProseMirrorCopy('yjs', Y.Doc, '@domternal-pro/extension-version-history');"),
    []
  );
});

test('a call spread over several lines is still read', () => {
  const source = `
    assertSingleProseMirrorCopy(
      'y-prosemirror',
      ySyncPluginKey,
      '@domternal-pro/extension-collaboration-caret'
    );
  `;
  assert.deepEqual(auditSource(source), []);
  const wrong = source.replace('ySyncPluginKey', 'yUndoPluginKey');
  assert.equal(auditSource(wrong).length, 1);
});

test('a template literal in the consumer does not break the split', () => {
  const source =
    "assertSingleProseMirrorCopy('prosemirror-model', Fragment, `${PACKAGE} (extra)`);";
  assert.deepEqual(splitArgs(source.slice(source.indexOf('(') + 1, source.lastIndexOf(')'))).length, 3);
});

test('an observed registration is exempt, because it reports another library\'s copy', () => {
  /* These exist precisely to register a class that is NOT ours: the one
     y-prosemirror built with, or the one the app's own Y.Doc came from.
     Requiring our export here would defeat the check they perform. */
  const source =
    "assertSingleProseMirrorCopy('prosemirror-model', observed, `${PACKAGE} (via y-prosemirror)`);";
  assert.deepEqual(auditSource(source), []);
  const appDoc =
    "assertSingleProseMirrorCopy('yjs', providedDoc.constructor, `${PACKAGE} (the Y.Doc passed to Collaboration)`);";
  assert.deepEqual(auditSource(appDoc), []);
});

test('an exemption needs the label, not just an unusual argument', () => {
  // Without the "(via ...)" or "(the ...)" marker a reader has no way to know
  // the registration is deliberate, so the gate treats it as a mistake.
  const source = "assertSingleProseMirrorCopy('prosemirror-model', observed, PACKAGE);";
  assert.equal(auditSource(source).length, 1);
});

test('a module missing from the table is reported rather than ignored', () => {
  const source = "assertSingleProseMirrorCopy('y-protocols', Awareness, 'somewhere');";
  const problems = auditSource(source);
  assert.equal(problems[0].kind, 'unlisted');
});

test('a module name that is not a literal cannot be verified, and says so', () => {
  const source = 'assertSingleProseMirrorCopy(moduleName, Fragment, PACKAGE);';
  assert.equal(auditSource(source)[0].kind, 'unreadable');
});

test('prose in a comment is not read as a call', () => {
  const source = `
    /* Historically this called assertSingleProseMirrorCopy('yjs', Map, 'x'),
       which was wrong. */
    assertSingleProseMirrorCopy('yjs', Doc, 'x');
  `;
  assert.deepEqual(auditSource(source), []);
  assert.equal(collectCalls(source).length, 1);
});

test('stripComments leaves a URL inside a string alone', () => {
  const text = "const docs = 'https://domternal.dev/v1/guides/single-prosemirror-copy/';";
  assert.equal(stripComments(text), text);
});

test('the documented table is parsed out of the registry header', () => {
  const header = [
    ' * | module                | export     |',
    ' * | --------------------- | ---------- |',
    ' * | `prosemirror-model`   | `Fragment` |',
    ' * | `yjs`                 | `Doc`      |',
  ].join('\n');
  assert.deepEqual(parseDocumentedTable(header), {
    'prosemirror-model': 'Fragment',
    yjs: 'Doc',
  });
});

test('every module the stack compares by identity has an entry', () => {
  for (const module of [
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-transform',
    'prosemirror-tables',
    'yjs',
    'y-prosemirror',
    '@domternal/core',
  ]) {
    assert.ok(FROZEN[module], `${module} must be frozen`);
  }
});

test('the advice a message prints is read out of the source', () => {
  const source = [
    "const FIXES = [",
    "  'pnpm:    add the package to \"pnpm.overrides\"',",
    "  \"Vite:    depend on '<module>' in the app\",",
    "];",
    "",
    "const DOCS_URL = 'https://domternal.dev/v1/guides/single-prosemirror-copy/';",
  ].join('\n');
  const advice = extractAdvice(source);
  assert.match(advice.fixes, /pnpm:/);
  assert.match(advice.fixes, /Vite:/);
  assert.equal(advice.url, 'https://domternal.dev/v1/guides/single-prosemirror-copy/');
});

test('advice comparison ignores formatting but not wording', () => {
  /* The two copies live in two repositories and are formatted by two prettier
     runs, so line breaks and indentation are not drift. A changed word is. */
  const a = "const FIXES = [\n  'pnpm: overrides',\n];\nconst DOCS_URL = 'u';";
  const b = "const FIXES = ['pnpm: overrides'];\nconst DOCS_URL = 'u';";
  const c = "const FIXES = ['pnpm: resolutions'];\nconst DOCS_URL = 'u';";
  assert.equal(extractAdvice(a).fixes, extractAdvice(b).fixes);
  assert.notEqual(extractAdvice(a).fixes, extractAdvice(c).fixes);
});

test('a source with no advice yields nulls rather than throwing', () => {
  // A future refactor that moves FIXES elsewhere must fail loudly at the
  // comparison, not crash the gate before it reports anything.
  assert.deepEqual(extractAdvice('export const nothing = 1;'), { fixes: null, url: null });
});
