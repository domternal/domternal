import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FIXTURES, fixtureById, validateDocument } from './fixtures.mjs';

const metadata = [
  ['rich-20k', 54, 20628, 20628, 'bad91f74279fd2716f8d781d6d8b310a5eb0a30f811a9e420fefd91e460f9686'],
  ['word-20k', 64, 20608, 20608, 'a4ca1ebe8dc27871e9d6898fe755b7a9b4605e0b20ed15076d7ca3a6a2551f84'],
  ['office-lists-20k', 35, 20929, 20859, 'bb1e0503fcd7dde5af99677efc2886a5c133f9b999eb70284f1dc0fc8821fe2f'],
];
for (const [id, groups, bytes, units, hash] of metadata) test(`frozen synthetic source ${id}`, () => {
  const fixture = fixtureById(id);
  assert.equal(fixture.groups, groups);
  assert.equal(fixture.utf8Bytes, bytes);
  assert.equal(fixture.utf16Units, units);
  assert.equal(Buffer.byteLength(fixture.html), bytes);
  assert.equal(fixture.html.length, units);
  assert.equal(createHash('sha256').update(fixture.html).digest('hex'), hash);
  assert.ok(bytes >= 20 * 1024 && bytes <= 22 * 1024);
  assert.equal(new Set(fixture.tokens).size, fixture.tokens.length);
  assert.ok(Object.isFrozen(fixture) && Object.isFrozen(fixture.tokens) && Object.isFrozen(fixture.expected.counts));
  assert.doesNotMatch(fixture.html, /<script|<img|<iframe|\b(?:src|href)=|url\(/iu);
});

test('fixtures have explicit independent structural expectations and reject unknown IDs', () => {
  assert.equal(FIXTURES.length, 3);
  assert.deepEqual(fixtureById('rich-20k').expected.counts, { heading: 54, paragraph: 216, blockquote: 54, table: 54, tableRow: 54, tableCell: 108 });
  assert.deepEqual(fixtureById('word-20k').expected.counts, { paragraph: 64 });
  assert.deepEqual(fixtureById('office-lists-20k').expected.counts, { paragraph: 140, orderedList: 70, bulletList: 35, listItem: 140 });
  assert.throws(() => fixtureById('unknown'));
});

const word = { kind: 'word', groups: 1,
  tokens: ['Bold 001', 'Plain 001', 'Again 001', 'Italic 001', 'Roman 001'], expected: { counts: { paragraph: 1 } } };
function wordDocument(formatting = 'preserve') {
  const text = (value, names, color = '#123456') => ({ type: 'text', text: value,
    marks: [...names.map(type => ({ type })), ...(formatting === 'preserve' ? [{ type: 'textStyle', attrs: { fontFamily: 'Calibri', fontSize: '16px', color } }] : [])] });
  return { type: 'doc', content: [{ type: 'paragraph', content: [
    text('Bold 001', ['bold']), text('Plain 001', [], '#654321'), text('Again 001', ['bold']),
    text('Italic 001', ['italic']), text('Roman 001', []),
  ] }] };
}

for (const formatting of ['preserve', 'adapt']) test(`accepts authored Word inheritance/reset invariants in ${formatting}`, () => {
  assert.equal(validateDocument(wordDocument(formatting), word, formatting, 'on-raw').tokenCount, 5);
  assert.equal(validateDocument(wordDocument(formatting), word, formatting, 'off-normalized').counts.paragraph, 1);
});

for (const mutation of ['missing', 'duplicate', 'reordered', 'bold-reset', 'font', 'extra-node']) test(`rejects ${mutation} despite a successful paste receipt`, () => {
  const document = wordDocument();
  const content = document.content[0].content;
  if (mutation === 'missing') content.splice(1, 1);
  if (mutation === 'duplicate') content.push(structuredClone(content[0]));
  if (mutation === 'reordered') [content[0], content[1]] = [content[1], content[0]];
  if (mutation === 'bold-reset') content[1].marks.push({ type: 'bold' });
  if (mutation === 'font') content[0].marks[1].attrs.fontFamily = 'Other';
  if (mutation === 'extra-node') document.content.push({ type: 'heading', content: [] });
  assert.throws(() => validateDocument(document, word, 'preserve', 'on-raw'));
});

test('the disabled raw baseline does not certify inherited style preservation', () => {
  const document = wordDocument('adapt');
  assert.equal(validateDocument(document, word, 'preserve', 'off-raw').tokenCount, 5);
  assert.throws(() => validateDocument(document, word, 'preserve', 'on-raw'));
});

test('intentional adapt typography cannot be counted as successful preservation', () => {
  assert.throws(() => validateDocument(wordDocument(), word, 'adapt', 'on-raw'));
});

test('document validation is itself structurally bounded', () => {
  const cycle = { type: 'doc', content: [] };
  cycle.content.push(cycle);
  assert.throws(() => validateDocument(cycle, word, 'preserve', 'on-raw'), /envelope/u);
});
