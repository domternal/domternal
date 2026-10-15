import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Extension, Heading, History, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { redo, undo } from '@domternal/pm/history';
import { Fragment, Slice } from '@domternal/pm/model';
import { NodeSelection, Plugin, TextSelection } from '@domternal/pm/state';
import { Details, DetailsContent, DetailsSummary } from './index.js';

const source = '<details><summary>Title</summary><div data-details-content><p>body</p></div></details>';
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function mount(content = source, extra: AnyExtension[] = [], persist = false): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), content,
    extensions: [Document, Paragraph, Text, Heading, History, Details.configure({ persist }), DetailsSummary, DetailsContent, ...extra] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.view.posAtCoords = () => ({ pos: position(editor, 'Title') + 2, inside: -1 });
  return editor;
}
function position(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) found = pos; });
  if (found === -1) throw new Error('Missing fixture text');
  return found;
}
function blocks(editor: Editor): Slice {
  const type = editor.schema.nodes['paragraph'];
  if (!type) throw new Error('Missing fixture paragraph');
  return new Slice(Fragment.fromArray(['a', 'b'].map(text => type.create(null, editor.schema.text(text)))), 0, 0);
}
function drop(editor: Editor, slice: Slice, moved = false): boolean {
  const event = new MouseEvent('drop', { clientX: 10, clientY: 10 });
  return editor.view.someProp('handleDrop', handler => handler(editor.view, event as DragEvent, slice, moved)) === true;
}
function opened(editor: Editor): boolean {
  return editor.view.dom.querySelector('[data-type="details"]')?.classList.contains('is-open') === true;
}

describe('dropping blocks into a details summary', () => {
  it.each([false, true])('copies blocks into the body without deleting a different selection, persist=%s', persist => {
    const editor = mount(source + '<p>selected</p>', [], persist);
    const at = position(editor, 'selected');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + 8)));
    const before = editor.state.doc;
    const selection = editor.state.selection.toJSON();
    let changes = 0;
    editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes++; });
    expect(drop(editor, blocks(editor))).toBe(true);
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(paragraph("a"), paragraph("b"), paragraph("body"))), paragraph("selected"))');
    expect(changes).toBe(1);
    expect(opened(editor)).toBe(true);
    if (persist) expect(editor.state.doc.firstChild?.attrs['open']).toBe(true);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(redo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.textContent).toBe('Titleabbodyselected');
  });

  it('puts a whole external heading in the body without changing the summary', () => {
    const editor = mount();
    const heading = editor.schema.nodes['heading'];
    if (!heading) throw new Error('Missing fixture heading');
    expect(drop(editor, new Slice(Fragment.from(heading.create({ level: 2 }, editor.schema.text('Heading'))), 0, 0))).toBe(true);
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(heading("Heading"), paragraph("body"))))');
    expect(opened(editor)).toBe(true);
  });

  it.each(['before', 'after'])('moves the selected block from %s the disclosure in one transaction', where => {
    const editor = mount(where === 'before' ? '<p>moved</p>' + source : source + '<p>moved</p>');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position(editor, 'moved') - 1)));
    const before = editor.state.doc;
    const slice = editor.state.selection.content();
    editor.view.dragging = { slice, move: true };
    expect(drop(editor, slice, true)).toBe(true);
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(paragraph("moved"), paragraph("body"))))');
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('moves a proven dragged node even when a different text selection is active', () => {
    const editor = mount('<p>moved</p>' + source + '<p>selected</p>');
    const node = NodeSelection.create(editor.state.doc, 0);
    const at = position(editor, 'selected');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + 8)));
    editor.view.dragging = Object.assign({ slice: node.content(), move: true }, { node });
    expect(drop(editor, node.content(), true)).toBe(true);
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(paragraph("moved"), paragraph("body"))), paragraph("selected"))');
  });

  it.each(['missing', 'stale', 'invalid', 'different-slice'])('leaves an unproven %s moved source to the native handler', kind => {
    const editor = mount('<p>moved</p>' + source);
    const node = NodeSelection.create(editor.state.doc, 0);
    const slice = node.content();
    const unknown = kind === 'stale' ? NodeSelection.create(editor.schema.nodeFromJSON(editor.state.doc.toJSON()), 0)
      : kind === 'invalid' ? { from: 0, to: 7 } : node;
    editor.view.dragging = kind === 'missing' ? { slice, move: true }
      : Object.assign({ slice: kind === 'different-slice' ? blocks(editor) : slice, move: true }, { node: unknown });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position(editor, 'Title'))));
    const before = editor.state.doc;
    expect(drop(editor, slice, true)).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(opened(editor)).toBe(false);
  });

  it('does not delete or open anything when a transaction filter rejects the drop', () => {
    const veto = Extension.create({ name: 'dropVeto', addProseMirrorPlugins: () => [new Plugin({ filterTransaction: tr => tr.getMeta('uiEvent') !== 'drop' })] });
    const editor = mount('<p>moved</p>' + source, [veto]);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    const before = editor.state.doc;
    const slice = editor.state.selection.content();
    editor.view.dragging = { slice, move: true };
    expect(drop(editor, slice, true)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(opened(editor)).toBe(false);
  });

  it('leaves inline drops and moves containing the destination with the native handler', () => {
    const editor = mount();
    expect(drop(editor, new Slice(Fragment.from(editor.schema.text('inline')), 0, 0))).toBe(false);
    const node = NodeSelection.create(editor.state.doc, 0);
    editor.view.dragging = Object.assign({ slice: node.content(), move: true }, { node });
    const before = editor.state.doc;
    expect(drop(editor, node.content(), true)).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(opened(editor)).toBe(false);
  });
});
