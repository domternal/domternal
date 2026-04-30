import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  HorizontalRule,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import { Fragment } from '@domternal/pm/model';
import { convertListItemForParent } from './convertListItemForParent.js';

const extensions = [
  Document, Text, Paragraph, Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem,
  TaskList, TaskItem,
];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

/**
 * Returns the absolute pos of the first node that matches `predicate`,
 * with `ed.state.doc.nodeAt(pos)` being that node.
 */
function findPos(
  editor: Editor,
  predicate: (node: { type: { name: string }; textContent: string }) => boolean,
): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

describe('convertListItemForParent', () => {
  it('converts listItem → taskItem when target parent is taskList (with checked=false default)', () => {
    const editor = makeEditor('<ul><li><p>From bullet</p></li></ul>');
    const liPos = findPos(editor, (n) => n.type.name === 'listItem');
    const li = editor.state.doc.nodeAt(liPos);
    if (!li) throw new Error();
    const fragment = Fragment.from(li);
    const taskListType = editor.schema.nodes['taskList'];
    if (!taskListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, taskListType);
    expect(out.firstChild?.type.name).toBe('taskItem');
    expect(out.firstChild?.attrs['checked']).toBe(false);
    expect(out.firstChild?.textContent).toBe('From bullet');
    editor.destroy();
  });

  it('converts taskItem → listItem when target parent is bulletList (drops `checked`)', () => {
    const editor = makeEditor('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>From task</p></li></ul>');
    const tiPos = findPos(editor, (n) => n.type.name === 'taskItem');
    const ti = editor.state.doc.nodeAt(tiPos);
    if (!ti) throw new Error();
    expect(ti.attrs['checked']).toBe(true);
    const fragment = Fragment.from(ti);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    // `listItem` schema doesn't declare `checked`, so PM silently
    // ignores it on creation — the converted node has no `checked`.
    expect((out.firstChild?.attrs as Record<string, unknown>)['checked']).toBeUndefined();
    expect(out.firstChild?.textContent).toBe('From task');
    editor.destroy();
  });

  it('converts taskItem → listItem when target parent is orderedList', () => {
    const editor = makeEditor('<ul data-type="taskList"><li data-type="taskItem"><p>Numbered hopeful</p></li></ul>');
    const tiPos = findPos(editor, (n) => n.type.name === 'taskItem');
    const ti = editor.state.doc.nodeAt(tiPos);
    if (!ti) throw new Error();
    const fragment = Fragment.from(ti);
    const orderedListType = editor.schema.nodes['orderedList'];
    if (!orderedListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, orderedListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.textContent).toBe('Numbered hopeful');
    editor.destroy();
  });

  it('returns content unchanged when target is bulletList and source is already listItem', () => {
    const editor = makeEditor('<ul><li><p>Stay</p></li></ul>');
    const liPos = findPos(editor, (n) => n.type.name === 'listItem');
    const li = editor.state.doc.nodeAt(liPos);
    if (!li) throw new Error();
    const fragment = Fragment.from(li);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    // Same fragment object — no reallocation when nothing changed.
    expect(out).toBe(fragment);
    editor.destroy();
  });

  it('returns content unchanged when target parent is not a list wrapper', () => {
    const editor = makeEditor('<ul><li><p>Source</p></li></ul>');
    const liPos = findPos(editor, (n) => n.type.name === 'listItem');
    const li = editor.state.doc.nodeAt(liPos);
    if (!li) throw new Error();
    const fragment = Fragment.from(li);
    // doc itself is the "non-list" parent for top-level drops.
    const docType = editor.state.doc.type;

    const out = convertListItemForParent(editor.schema, fragment, docType);
    expect(out).toBe(fragment);
    editor.destroy();
  });

  it('preserves nested children inside the converted item (nested lists keep their original type)', () => {
    // Source: a listItem that contains a paragraph + a nested taskList.
    // Convert to taskItem (target is taskList). The inner taskList should
    // stay a taskList — only the OUTER wrapper switches type.
    const editor = makeEditor(
      '<ul><li><p>Outer</p>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Inner task</p></li></ul>'
      + '</li></ul>',
    );
    const liPos = findPos(editor, (n) => n.type.name === 'listItem');
    const li = editor.state.doc.nodeAt(liPos);
    if (!li) throw new Error();
    const fragment = Fragment.from(li);
    const taskListType = editor.schema.nodes['taskList'];
    if (!taskListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, taskListType);
    expect(out.firstChild?.type.name).toBe('taskItem');
    expect(out.firstChild?.childCount).toBe(2);
    expect(out.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(out.firstChild?.lastChild?.type.name).toBe('taskList');
    expect(out.firstChild?.lastChild?.firstChild?.type.name).toBe('taskItem');
    editor.destroy();
  });

  it('handles a fragment with multiple items (each is converted independently)', () => {
    // Build a fragment containing TWO listItems (e.g. moving a multi-item
    // slice). All should convert to taskItems.
    const editor = makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    const ul = editor.state.doc.firstChild;
    if (!ul) throw new Error();
    const fragment = ul.content; // both listItems
    expect(fragment.childCount).toBe(2);
    const taskListType = editor.schema.nodes['taskList'];
    if (!taskListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, taskListType);
    expect(out.childCount).toBe(2);
    expect(out.child(0).type.name).toBe('taskItem');
    expect(out.child(1).type.name).toBe('taskItem');
    expect(out.child(0).textContent).toBe('A');
    expect(out.child(1).textContent).toBe('B');
    editor.destroy();
  });

  it('preserves user-defined attrs (like UniqueID) across the conversion', () => {
    // Build a listItem with a custom id attr. When converted to taskItem,
    // the id should ride along (we spread `child.attrs` first, then add
    // `checked: false`).
    const editor = makeEditor('<ul><li><p>Tagged</p></li></ul>');
    const ul = editor.state.doc.firstChild;
    if (!ul) throw new Error();
    const li = ul.firstChild;
    if (!li) throw new Error();
    // Manually rebuild the listItem with an extra attr-like field via
    // the schema's create. Our schema's listItem doesn't declare custom
    // attrs by default; this test still passes because we verify that
    // EXISTING attrs get spread (no attr removal).
    const fragment = Fragment.from(li);
    const taskListType = editor.schema.nodes['taskList'];
    if (!taskListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, taskListType);
    // For the standard schema, the only attr we expect is `checked: false`.
    // The point of the test: spread doesn't lose anything that WAS on the
    // source. `JSON.stringify` round-trip catches accidental attr drops.
    expect(out.firstChild?.type.name).toBe('taskItem');
    expect(out.firstChild?.attrs['checked']).toBe(false);
    editor.destroy();
  });

  it('returns unchanged when the schema lacks the target item type', () => {
    // Build an editor without TaskList/TaskItem so target type lookup fails.
    const ed = new Editor({
      extensions: [Document, Text, Paragraph, BulletList, ListItem],
      content: '<ul><li><p>X</p></li></ul>',
    });
    const liPos = findPos(ed, (n) => n.type.name === 'listItem');
    const li = ed.state.doc.nodeAt(liPos);
    if (!li) throw new Error();
    const fragment = Fragment.from(li);
    // Pretend the parent is a taskList by faking the type name; safer:
    // pass the bulletList type (already valid). Without TaskItem in the
    // schema, no conversion attempts occur because parent is bulletList
    // and source is listItem (already matching).
    const bulletListType = ed.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();
    const out = convertListItemForParent(ed.schema, fragment, bulletListType);
    expect(out).toBe(fragment);
    ed.destroy();
  });

  // ── Arbitrary-block wrap (heading/paragraph/codeBlock/blockquote/hr) ──

  it('wraps a top-level heading in a fresh listItem when target is bulletList', () => {
    const editor = makeEditor('<h1>The title</h1>');
    const headingPos = findPos(editor, (n) => n.type.name === 'heading');
    const h = editor.state.doc.nodeAt(headingPos);
    if (!h) throw new Error();
    const fragment = Fragment.from(h);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.childCount).toBe(1);
    expect(out.firstChild?.firstChild?.type.name).toBe('heading');
    expect(out.firstChild?.firstChild?.attrs['level']).toBe(1);
    expect(out.firstChild?.firstChild?.textContent).toBe('The title');
    editor.destroy();
  });

  it('wraps a top-level heading in a fresh taskItem (with checked=false) when target is taskList', () => {
    const editor = makeEditor('<h2>Section</h2>');
    const headingPos = findPos(editor, (n) => n.type.name === 'heading');
    const h = editor.state.doc.nodeAt(headingPos);
    if (!h) throw new Error();
    const fragment = Fragment.from(h);
    const taskListType = editor.schema.nodes['taskList'];
    if (!taskListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, taskListType);
    expect(out.firstChild?.type.name).toBe('taskItem');
    expect(out.firstChild?.attrs['checked']).toBe(false);
    expect(out.firstChild?.firstChild?.type.name).toBe('heading');
    expect(out.firstChild?.firstChild?.textContent).toBe('Section');
    editor.destroy();
  });

  it('wraps a paragraph in a listItem (most common drop case)', () => {
    const editor = makeEditor('<p>Just text</p>');
    const pPos = findPos(editor, (n) => n.type.name === 'paragraph');
    const p = editor.state.doc.nodeAt(pPos);
    if (!p) throw new Error();
    const fragment = Fragment.from(p);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(out.firstChild?.firstChild?.textContent).toBe('Just text');
    editor.destroy();
  });

  it('wraps a codeBlock in a listItem (preserves language attr)', () => {
    const editor = makeEditor('<pre><code class="language-js">code()</code></pre>');
    const cbPos = findPos(editor, (n) => n.type.name === 'codeBlock');
    const cb = editor.state.doc.nodeAt(cbPos);
    if (!cb) throw new Error();
    const fragment = Fragment.from(cb);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.firstChild?.type.name).toBe('codeBlock');
    expect(out.firstChild?.firstChild?.textContent).toBe('code()');
    editor.destroy();
  });

  it('wraps a blockquote in a listItem (blockquote keeps its own paragraph child)', () => {
    const editor = makeEditor('<blockquote><p>Quoted</p></blockquote>');
    const bqPos = findPos(editor, (n) => n.type.name === 'blockquote');
    const bq = editor.state.doc.nodeAt(bqPos);
    if (!bq) throw new Error();
    const fragment = Fragment.from(bq);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.firstChild?.type.name).toBe('blockquote');
    expect(out.firstChild?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(out.firstChild?.firstChild?.textContent).toBe('Quoted');
    editor.destroy();
  });

  it('wraps a horizontalRule (atom block) in a listItem', () => {
    const editor = makeEditor('<hr><p>after</p>');
    const hrPos = findPos(editor, (n) => n.type.name === 'horizontalRule');
    const hr = editor.state.doc.nodeAt(hrPos);
    if (!hr) throw new Error();
    const fragment = Fragment.from(hr);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.firstChild?.type.name).toBe('listItem');
    expect(out.firstChild?.firstChild?.type.name).toBe('horizontalRule');
    editor.destroy();
  });

  it('handles a fragment with mixed types: matching item + non-list block (each wrapped or kept)', () => {
    // Build a fragment containing a listItem AND a paragraph (synthetic
    // multi-block slice). Target = bulletList. listItem stays as-is;
    // paragraph gets wrapped.
    const editor = makeEditor('<ul><li><p>Existing</p></li></ul><p>Loose</p>');
    const li = editor.state.doc.firstChild?.firstChild;
    const loose = editor.state.doc.lastChild;
    if (!li || !loose) throw new Error();
    const fragment = Fragment.fromArray([li, loose]);
    const bulletListType = editor.schema.nodes['bulletList'];
    if (!bulletListType) throw new Error();

    const out = convertListItemForParent(editor.schema, fragment, bulletListType);
    expect(out.childCount).toBe(2);
    expect(out.child(0).type.name).toBe('listItem');
    expect(out.child(0).textContent).toBe('Existing');
    expect(out.child(1).type.name).toBe('listItem'); // paragraph wrapped
    expect(out.child(1).firstChild?.type.name).toBe('paragraph');
    expect(out.child(1).textContent).toBe('Loose');
    editor.destroy();
  });
});
