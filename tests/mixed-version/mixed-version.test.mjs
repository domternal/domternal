// Documents saved by the published 1.2.0 packages, and 1.2.0 clients editing one shared document
// with current ones over Yjs. Every scenario checks that no client throws, loses text or keeps
// rewriting the shared document, and that values change only through normalizeContentAttributes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIX, codes, counts, destroy, editSeed, linkText, makeEditor, makeOldEditor, network, nodeValues, oldSeedFromJSON,
  settle, sharedAttributes, sharedText, typeAfter, words,
} from './clients.mjs';

const SPAN_HTML = '<table><tbody><tr>'
  + '<td colspan="0"><p>zero</p></td>'
  + '<td colspan="abc" data-background="url(https://evil.example/x)"><p>nan</p></td>'
  + '<td colspan="-1" data-background="red"><p>minus</p></td>'
  + '<td colspan="5000"><p>many</p></td>'
  + '</tr></tbody></table>';
const SAVED_HTML = '<h2>Title</h2><h5>five</h5><h6>six</h6>'
  + '<ul><li><p>bullet</p></li></ul><ol start="3"><li><p>ordered</p></li></ol>'
  + '<p><a href="https://example.com">safe</a> and script</p>'
  + SPAN_HTML;

/** A document as a 1.2.0 app with six heading levels saves it, including values 1.2.0 never validated. */
function savedBy120() {
  const editor = makeOldEditor({ levels: SIX, content: SAVED_HTML });
  linkText(editor, 'script', 'javascript:alert(1)');
  const { state } = editor;
  editor.view.dispatch(state.tr.insert(state.doc.content.size, state.schema.nodes.image.create({ src: 'javascript:alert(2)', alt: 'picture' })));
  // Stored as JSON text, as an app saves it: a span 1.2.0 parsed as NaN is saved as null.
  const saved = { json: JSON.parse(JSON.stringify(editor.getJSON())), html: editor.getHTML(), words: words(editor) };
  editor.destroy();
  return saved;
}

/** Every node of this type in a JSON document, in document order. */
function jsonNodes(json, type, found = []) {
  if (json.type === type) found.push(json);
  for (const child of json.content ?? []) jsonNodes(child, type, found);
  return found;
}

function textRuns(json, found = []) {
  if (json.type === 'text') found.push({ text: json.text, marks: (json.marks ?? []).map(mark => `${mark.type}:${String(mark.attrs?.href)}`) });
  for (const child of json.content ?? []) textRuns(child, found);
  return found;
}

test('1.2.0 saves the values a current editor must replace or refuse', () => {
  const saved = savedBy120();
  const cells = saved.json.content.find(node => node.type === 'table').content[0].content;
  assert.deepEqual(cells.map(cell => cell.attrs.colspan), [0, null, -1, 5000]);
  assert.deepEqual(saved.json.content.filter(node => node.type === 'heading').map(node => node.attrs.level), [2, 5, 6]);
  assert.equal(saved.json.content.find(node => node.type === 'bulletList').attrs, undefined);
  assert.ok(textRuns(saved.json).some(run => run.marks.includes('link:javascript:alert(1)')));
  assert.deepEqual(jsonNodes(saved.json, 'image').map(image => image.attrs.src), ['javascript:alert(2)']);
});

for (const levels of [undefined, SIX]) {
  const name = levels ? 'six heading levels' : 'the default heading levels';
  test(`a 1.2.0 JSON document loads in a current editor with ${name}`, () => {
    const saved = savedBy120();
    const { editor, diagnostics } = makeEditor({ levels, content: saved.json });
    const json = editor.getJSON();
    const html = editor.getHTML();

    // Nothing a reader wrote is lost.
    assert.equal(words(editor), saved.words);
    // Lists gain the new attribute with its default; nothing is reported for them.
    assert.deepEqual(nodeValues(editor, 'bulletList', 'listStyleType'), [null]);
    assert.deepEqual({ ...json.content.find(node => node.type === 'orderedList').attrs }, { listStyleType: null, start: 3 });
    // Levels the configuration lacks take the nearest configured level.
    assert.deepEqual(nodeValues(editor, 'heading', 'level'), levels ? [2, 5, 6] : [2, 4, 4]);
    // The refused link is removed and its text kept; the allowed one stays.
    assert.deepEqual(textRuns(json).filter(run => run.marks.length > 0).map(run => run.marks[0]), ['link:https://example.com']);
    assert.ok(!html.includes('javascript:'));
    // Spans take their replacement; the unsafe background stays stored and is never rendered.
    assert.deepEqual(nodeValues(editor, 'tableCell', 'colspan'), [1, 1, 1, 1000]);
    assert.deepEqual(nodeValues(editor, 'tableCell', 'background'), [null, 'url(https://evil.example/x)', 'red', null]);
    assert.ok(!html.includes('evil.example'));
    // The refused image source stays stored and is never rendered.
    assert.deepEqual(nodeValues(editor, 'image', 'src'), ['javascript:alert(2)']);
    // Every replacement is reported once, as the content option loaded it.
    assert.deepEqual(diagnostics.map(report => report.source), ['content']);
    const expected = [
      ...(levels ? [] : ['unsupported-heading-level', 'unsupported-heading-level']),
      'unsafe-url',
      'unsupported-table-span', 'unsupported-table-span', 'unsupported-table-span', 'unsupported-table-span',
    ];
    assert.deepEqual(codes(diagnostics).sort(), expected.sort());
    editor.destroy();
  });
}

test('a 1.2.0 HTML save loads in a current editor', () => {
  const saved = savedBy120();
  // What 1.2.0 renders for the values it never validated.
  assert.match(saved.html, /<td colspan="0">/);
  assert.match(saved.html, /<td colspan="NaN"/);
  assert.match(saved.html, /<a>script<\/a>/);

  const current = makeEditor({ content: saved.html });
  assert.equal(words(current.editor), saved.words);
  assert.deepEqual(nodeValues(current.editor, 'heading', 'level'), [2, 4, 4]);
  assert.deepEqual(nodeValues(current.editor, 'tableCell', 'colspan'), [1, 1, 1, 1000]);
  assert.deepEqual(nodeValues(current.editor, 'bulletList', 'listStyleType'), [null]);
  assert.ok(!current.editor.getHTML().includes('javascript:'));
  assert.ok(!current.editor.getHTML().includes('evil.example'));
  current.editor.destroy();

  // A 1.2.0 app with the default levels read the same save's h5 and h6 as paragraphs.
  const old = makeOldEditor({ content: saved.html });
  assert.deepEqual(nodeValues(old, 'heading', 'level'), [2]);
  old.destroy();
});

test('a current JSON or HTML save loads in a 1.2.0 editor without lost text', () => {
  const html = '<h5>five</h5><ul style="list-style-type: square"><li><p>bullet</p></li></ul>'
    + '<ol style="list-style-type: lower-roman" start="2"><li><p>ordered</p></li></ol>'
    + '<table><tbody><tr><td colspan="2"><p>wide</p></td></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>';
  const current = makeEditor({ levels: SIX, content: html });
  const json = current.editor.getJSON();
  const saved = current.editor.getHTML();
  assert.match(saved, /list-style-type: square/);

  for (const content of [json, saved]) {
    const old = makeOldEditor({ content });
    assert.equal(words(old), words(current.editor));
    // 1.2.0 ignores the marker and drops it when it saves.
    assert.ok(!old.getHTML().includes('list-style-type'));
    assert.equal(old.getJSON().content.find(node => node.type === 'bulletList').attrs, undefined);
    assert.deepEqual(nodeValues(old, 'tableCell', 'colspan'), [2, 1, 1]);
    old.destroy();
  }
  // A level its configuration lacks: 1.2.0 keeps the JSON value and renders it as h1.
  const fromJSON = makeOldEditor({ content: json });
  assert.deepEqual(nodeValues(fromJSON, 'heading', 'level'), [5]);
  assert.match(fromJSON.getHTML(), /<h1>five<\/h1>/);
  fromJSON.destroy();
  current.editor.destroy();
});

/** Asserts that every client shows the same text and none of them reported an error. */
function assertSameText(clients) {
  const [first] = clients;
  for (const client of clients) {
    assert.deepEqual(client.errors, []);
    assert.equal(words(client.editor), words(first.editor), `${client.kind} shows different text`);
  }
}

test('Yjs: list markers written by a current client, with a 1.2.0 client editing', async () => {
  const clients = network([{ kind: 'current' }, { kind: 'old' }]);
  const [current, old] = clients;
  await settle();
  current.editor.commands.setContent('<ul style="list-style-type: square"><li><p>bullet</p></li></ul>'
    + '<ol style="list-style-type: lower-roman" start="3"><li><p>ordered</p></li></ol><p>para</p>');
  await settle();
  assert.deepEqual(sharedAttributes(old, 'bulletList'), [{ listStyleType: 'square' }]);
  // 1.2.0 renders the default marker and writes nothing back.
  assert.ok(!old.editor.getHTML().includes('list-style-type'));
  const quiet = await counts(clients);

  // A 1.2.0 edit outside the lists keeps the markers.
  typeAfter(old, 'para', '!');
  await settle();
  assert.deepEqual(sharedAttributes(current, 'bulletList'), [{ listStyleType: 'square' }]);
  assert.deepEqual(sharedAttributes(current, 'orderedList'), [{ listStyleType: 'lower-roman', start: 3 }]);
  assert.equal(current.localUpdates, quiet[0]);

  // A 1.2.0 edit inside a list writes the list again without the attribute it does not know.
  typeAfter(old, 'bullet', 'X');
  typeAfter(old, 'ordered', 'Y');
  await settle();
  assert.deepEqual(sharedAttributes(current, 'bulletList'), [{}]);
  assert.deepEqual(nodeValues(current.editor, 'bulletList', 'listStyleType'), [null]);
  assert.deepEqual(nodeValues(current.editor, 'orderedList', 'start'), [3]);
  assertSameText(clients);
  // Neither client answers the other's writes: the counts stay put once the edits stop.
  const after = await counts(clients);
  assert.deepEqual(await counts(clients), after);
  assert.equal(after[0], quiet[0]);
  destroy(clients);
});

test('Yjs: heading levels from a six-level client, a 1.2.0 client and a default client, rewritten by none of them', async () => {
  const clients = network([{ kind: 'current', levels: SIX }, { kind: 'old' }, { kind: 'current' }]);
  const [six, old, standard] = clients;
  await settle();
  six.editor.commands.setContent('<h5>five</h5><h6>six</h6><p>p</p>');
  await settle();
  assert.deepEqual(sharedAttributes(standard, 'heading'), [{ level: 5 }, { level: 6 }]);
  assert.match(six.editor.getHTML(), /^<h5>five<\/h5><h6>six<\/h6>/);
  assert.match(old.editor.getHTML(), /^<h1>five<\/h1><h1>six<\/h1>/);
  assert.match(standard.editor.getHTML(), /^<h4>five<\/h4><h4>six<\/h4>/);
  const [, oldBefore, standardBefore] = await counts(clients);
  assert.deepEqual([oldBefore, standardBefore], [0, 0]);

  typeAfter(old, 'five', 'B');
  typeAfter(standard, 'six', 'C');
  await settle();
  // Nobody rewrites a level: the edits change text only.
  assert.deepEqual(sharedAttributes(six, 'heading'), [{ level: 5 }, { level: 6 }]);
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);

  // Values a 1.2.0 client stores without validation render at the nearest level on a current one.
  const { state } = old.editor;
  const heading = state.schema.nodes.heading;
  old.editor.view.dispatch(state.tr.insert(0, [
    heading.create({ level: 7 }, state.schema.text('seven')),
    heading.create({ level: '5' }, state.schema.text('text five')),
    heading.create({ level: 0 }, state.schema.text('zero')),
  ]));
  await settle();
  assert.deepEqual(sharedAttributes(standard, 'heading').slice(0, 3), [{ level: 7 }, { level: '5' }, { level: 0 }]);
  assert.match(standard.editor.getHTML(), /^<h4>seven<\/h4><h4>text five<\/h4><h1>zero<\/h1>/);
  typeAfter(standard, 'seven', '!');
  await settle();
  assert.deepEqual(sharedAttributes(six, 'heading').slice(0, 3), [{ level: 7 }, { level: '5' }, { level: 0 }]);
  assertSameText(clients);
  destroy(clients);
});

test('Yjs: a script link stored by a 1.2.0 client stays stored, never opens on a current client', async () => {
  const clients = network([{ kind: 'current' }, { kind: 'old' }]);
  const [current, old] = clients;
  await settle();
  old.editor.commands.setContent('<p>click here now</p>');
  linkText(old.editor, 'click here', 'javascript:alert(1)');
  await settle();
  assert.equal(current.editor.getHTML(), '<p><span>click here</span> now</p>');
  assert.equal(old.editor.getHTML(), '<p><a>click here</a> now</p>');
  typeAfter(current, 'now', '!');
  await settle();
  assert.deepEqual(sharedText(old).map(run => [run.insert, run.attributes?.link?.href]), [
    ['click here', 'javascript:alert(1)'],
    [' now!', undefined],
  ]);
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);
  destroy(clients);
});

test('Yjs: current clients open a table a 1.2.0 app saved with unsupported spans and never write it', async () => {
  const saved = savedBy120();
  const clients = network([{ kind: 'current' }, { kind: 'current', levels: SIX }], oldSeedFromJSON(saved.json, { levels: SIX }));
  const [standard, six] = clients;
  await settle();
  // They render the replacements and leave the stored values alone. y-prosemirror stores no
  // attribute that is null, so the span 1.2.0 saved as null reads as the default.
  assert.deepEqual(await counts(clients), [0, 0]);
  assert.deepEqual(sharedAttributes(standard, 'tableCell').map(cell => cell.colspan), [0, undefined, -1, 5000]);
  for (const client of clients) {
    assert.deepEqual(nodeValues(client.editor, 'tableCell', 'colspan'), [0, 1, -1, 5000]);
    assert.match(client.editor.getHTML(), /<td colspan="1000"><p>many<\/p><\/td>/);
    assert.ok(!client.editor.getHTML().includes('evil.example'));
    assert.ok(!client.editor.getHTML().includes('javascript:'));
    assert.equal(words(client.editor), saved.words);
  }

  // Typing in the table changes the text and nothing else: no repair runs on such a table.
  typeAfter(standard, 'minus', '!');
  typeAfter(six, 'many', '?');
  await settle();
  assert.deepEqual(sharedAttributes(standard, 'tableCell').map(cell => cell.colspan), [0, undefined, -1, 5000]);
  assert.ok(words(six.editor).includes('minus!|many?'));
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);
  destroy(clients);
});

const SPAN_REPAIRS = ['unsupported-table-span'];
const REPAIRS_FOR_EVERY_VERSION = ['unsupported-table-span', 'unsafe-url'];

/** A 1.2.0 save holding a table whose first cell spans -1 columns. */
function negativeSpanSeed() {
  const cell = (text, colspan) => ({ type: 'tableCell', attrs: { colspan }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  return oldSeedFromJSON({ type: 'doc', content: [
    { type: 'table', content: [{ type: 'tableRow', content: [cell('first', -1), cell('second', 1)] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
  ] });
}

test('Yjs: a 1.2.0 client that edits beside an unsupported span repairs the table its own way (documented limit)', async () => {
  const clients = network([{ kind: 'current' }, { kind: 'old' }], negativeSpanSeed());
  const [current, old] = clients;
  await settle();
  assert.equal(words(current.editor), 'first|second|after');
  // 1.2.0 already shows the table without its text, and writes that with its first edit, anywhere.
  assert.equal(words(old.editor), '|after');
  typeAfter(old, 'after', '!');
  await settle();
  assert.equal(words(current.editor), '|after!');
  assert.equal(current.localUpdates, 0);
  destroy(clients);
});

test('Yjs: repairing spans first keeps a connected 1.2.0 client from losing table text', async () => {
  const clients = network([{ kind: 'current' }, { kind: 'old' }], negativeSpanSeed());
  const [current, old] = clients;
  await settle();
  assert.equal(current.editor.commands.normalizeContentAttributes({ codes: SPAN_REPAIRS }), true);
  await settle();
  assert.equal(words(old.editor), 'first|second|after');
  typeAfter(old, 'after', '!');
  typeAfter(old, 'second', '?');
  await settle();
  assert.equal(words(current.editor), 'first|second?|after!');
  assert.deepEqual(sharedAttributes(current, 'tableCell').map(cell => cell.colspan), [1, 1]);
  assertSameText(clients);
  destroy(clients);
});

/** The href of every linked run in the shared document. */
function sharedLinks(client) {
  return sharedText(client).filter(run => run.attributes?.link).map(run => run.attributes.link.href);
}

test('Yjs: migrating only spans and refused links while a 1.2.0 client is connected', async () => {
  const saved = savedBy120();
  const clients = network([{ kind: 'current' }, { kind: 'old', levels: SIX }], oldSeedFromJSON(saved.json, { levels: SIX }));
  const [current, old] = clients;
  await settle();
  assert.deepEqual(await counts(clients), [0, 0]);

  assert.equal(current.editor.commands.normalizeContentAttributes({ codes: REPAIRS_FOR_EVERY_VERSION }), true);
  await settle();
  // Three spans: the one 1.2.0 saved as null is not in the shared document at all.
  assert.deepEqual(codes(current.diagnostics.filter(report => report.source === 'normalizeContentAttributes')).sort(), [
    'unsafe-url', 'unsupported-table-span', 'unsupported-table-span', 'unsupported-table-span',
  ]);
  // Repaired for every client; what differs between versions and configurations stays.
  for (const client of clients) {
    assert.deepEqual(sharedAttributes(client, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
    assert.deepEqual(sharedLinks(client), ['https://example.com']);
    assert.deepEqual(sharedAttributes(client, 'heading').map(heading => heading.level), [2, 5, 6]);
    assert.deepEqual(sharedAttributes(client, 'image').map(image => image.src), ['javascript:alert(2)']);
    assert.deepEqual(sharedAttributes(client, 'tableCell').map(cell => cell.background ?? null), [null, 'url(https://evil.example/x)', 'red', null]);
  }
  assert.deepEqual(nodeValues(old.editor, 'tableCell', 'colspan'), [1, 1, 1, 1000]);
  assert.equal(current.editor.commands.normalizeContentAttributes({ codes: REPAIRS_FOR_EVERY_VERSION }), false);

  // The 1.2.0 client now edits the table without its own repair changing it, and stores a new
  // script link, which the next run removes for everyone.
  typeAfter(old, 'zero', '#');
  linkText(old.editor, 'and', 'javascript:alert(3)');
  await settle();
  assert.deepEqual(sharedAttributes(current, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
  assert.equal(current.editor.commands.normalizeContentAttributes({ codes: REPAIRS_FOR_EVERY_VERSION }), true);
  await settle();
  assert.deepEqual(sharedLinks(old), ['https://example.com']);
  assert.ok(!old.editor.getHTML().includes('<a>and</a>'));
  assertSameText(clients);

  // The migration stays out of the undo history: undo takes back the current client's typing only.
  typeAfter(current, 'Title', ' typed');
  await settle();
  current.undo();
  current.undo();
  await settle();
  assert.ok(!words(old.editor).includes('typed'));
  assert.deepEqual(sharedAttributes(old, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
  assert.deepEqual(sharedLinks(old), ['https://example.com']);
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);
  destroy(clients);
});

test('Yjs: the full migration once every client is current', async () => {
  const saved = savedBy120();
  const seed = editSeed(oldSeedFromJSON(saved.json, { levels: SIX }), (fragment, Y) => {
    // A marker only a later version knows.
    const list = fragment.toArray().find(node => node instanceof Y.XmlElement && node.nodeName === 'bulletList');
    list.setAttribute('listStyleType', 'future-marker');
  });
  const clients = network([{ kind: 'current' }, { kind: 'current' }], seed);
  const [writer, reader] = clients;
  await settle();
  assert.deepEqual(await counts(clients), [0, 0]);
  assert.ok(!reader.editor.getHTML().includes('future-marker'));
  typeAfter(writer, 'Title', ' typed');
  await settle();

  assert.equal(writer.editor.can().normalizeContentAttributes(), true);
  assert.equal(writer.editor.commands.normalizeContentAttributes(), true);
  await settle();
  for (const client of clients) {
    assert.deepEqual(nodeValues(client.editor, 'bulletList', 'listStyleType'), [null]);
    assert.deepEqual(sharedAttributes(client, 'heading').map(heading => heading.level), [2, 4, 4]);
    assert.deepEqual(sharedLinks(client), ['https://example.com']);
    assert.deepEqual(sharedAttributes(client, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
    // Values the migration does not cover stay as stored.
    assert.deepEqual(sharedAttributes(client, 'image').map(image => image.src), ['javascript:alert(2)']);
    assert.deepEqual(sharedAttributes(client, 'tableCell').map(cell => cell.background ?? null), [null, 'url(https://evil.example/x)', 'red', null]);
  }
  assert.ok(!sharedAttributes(reader, 'bulletList').some(list => list.listStyleType === 'future-marker'));
  assert.equal(reader.editor.can().normalizeContentAttributes(), false);
  assert.equal(writer.editor.commands.normalizeContentAttributes(), false);

  // Typed just before the migration, and still the only change undo takes back.
  writer.undo();
  await settle();
  assert.equal(words(reader.editor), saved.words);
  assert.deepEqual(sharedAttributes(reader, 'heading').map(heading => heading.level), [2, 4, 4]);
  assert.deepEqual(sharedAttributes(reader, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
  assert.deepEqual(sharedLinks(reader), ['https://example.com']);
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);
  destroy(clients);
});

test('Yjs: a read-only current client beside a 1.2.0 client and a default one never writes', async () => {
  const saved = savedBy120();
  const clients = network([
    { kind: 'old', levels: SIX },
    { kind: 'current' },
    { kind: 'current', levels: SIX, editable: false },
  ], oldSeedFromJSON(saved.json, { levels: SIX }));
  const [old, standard, readOnly] = clients;
  await settle();
  assert.match(readOnly.editor.getHTML(), /<h5>five<\/h5><h6>six<\/h6>/);
  assert.match(standard.editor.getHTML(), /<h4>five<\/h4><h4>six<\/h4>/);
  assert.equal(readOnly.editor.can().normalizeContentAttributes(), false);
  assert.equal(readOnly.editor.commands.normalizeContentAttributes(), false);
  assert.equal(standard.editor.commands.normalizeContentAttributes({ codes: REPAIRS_FOR_EVERY_VERSION }), true);
  await settle();

  typeAfter(old, 'five', 'B');
  typeAfter(standard, 'six', 'C');
  typeAfter(old, 'many', '?');
  await settle();
  assert.equal(readOnly.localUpdates, 0);
  assert.match(readOnly.editor.getHTML(), /<h5>fiveB<\/h5><h6>sixC<\/h6>/);
  assert.deepEqual(sharedAttributes(readOnly, 'heading').map(heading => heading.level), [2, 5, 6]);
  assert.deepEqual(sharedAttributes(readOnly, 'tableCell').map(cell => cell.colspan), [1, 1, 1, 1000]);
  assertSameText(clients);
  const quiet = await counts(clients);
  assert.deepEqual(await counts(clients), quiet);
  assert.equal(quiet[2], 0);
  destroy(clients);
});
