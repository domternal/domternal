/**
 * Fixture tests for the comment stripper both coverage checks read through.
 *
 * The stripper is the difference between a coverage number that is true and
 * one that is only shaped like the truth, so the shapes that matter are pinned
 * here: the commented-out line the review used, a comment after code on the
 * same line, and the URLs in string literals that a cruder regex would cut.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from './strip-comments.mjs';

test('a commented-out line leaves nothing behind to match', () => {
  // The exact line the review commented out to defeat the CJS coverage check.
  const stripped = stripComments("// import toc = require('@domternal/extension-toc');\n");
  assert.equal(stripped.includes('require'), false);
});

test('a comment after code on the same line goes, and the code stays', () => {
  const stripped = stripComments("editor.commands.focus(); // editor.commands.printDocument();");
  assert.equal(stripped.includes('printDocument'), false);
  assert.equal(stripped.includes('editor.commands.focus()'), true);
});

test('a block comment goes even when it wraps a whole statement', () => {
  assert.equal(stripComments('/* editor.commands.insertNbsp(); */').trim(), '');
});

test('a URL inside a string survives, which is why this is a walk and not a regex', () => {
  const source = "editor.commands.setLink({ href: 'https://example.com' });";
  assert.equal(stripComments(source), source);
});

test('comment markers inside strings and template literals are just characters', () => {
  const block = 'const a = "/* not a comment */";';
  assert.equal(stripComments(block), block);
  assert.equal(stripComments('const b = `a // b`;'), 'const b = `a // b`;');
  assert.equal(stripComments("const c = 'it\\'s // fine';"), "const c = 'it\\'s // fine';");
});

test('line numbering survives, so a report still points at the right line', () => {
  const source = ['const a = 1;', '/* two', '   lines */', 'const b = 2;'].join('\n');
  const lines = stripComments(source).split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[3], 'const b = 2;');
});

test('an unterminated comment swallows the rest, rather than reappearing as code', () => {
  assert.equal(stripComments('const a = 1;\n/* trailing').trim(), 'const a = 1;');
});
