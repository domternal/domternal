/**
 * The shared clipboard test helper (`@domternal/tests-clipboard-slices`) against a real editor:
 * the slice a paste hands its handlers is often open, unlike a slice a test builds with
 * DOMParser.parse(...).slice(), so paste handler tests take theirs from the helper.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DOMParser } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { clipboardEvent, copySelection, describeSlice, pasteClipboard, pastedSlice } from '@domternal/tests-clipboard-slices';
import { Editor } from './Editor.js';
import { Document, Paragraph, Text, BulletList, ListItem, Bold } from './index.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(content: string): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, BulletList, ListItem, Bold], content });
  editors.push(editor);
  return editor;
}

function textPos(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? node.text?.indexOf(text) ?? -1 : -1;
    if (found < 0 && index >= 0) found = pos + index;
  });
  if (found < 0) throw new Error(`No text ${text}`);
  return found;
}

describe('clipboard test helper: the slices a paste hands its handlers', () => {
  it('leaves two pasted paragraphs open on both sides, where a slice built by hand is closed', () => {
    const editor = mount('<p></p>');
    const html = '<p>one</p><p>two</p>';
    const byHand = DOMParser.fromSchema(editor.schema).parse(Object.assign(document.createElement('div'), { innerHTML: html }));

    expect(describeSlice(byHand.slice(0, byHand.content.size))).toBe('0 0 <paragraph("one"), paragraph("two")>');
    expect(describeSlice(pastedSlice(editor.view, { html }))).toBe('1 1 <paragraph("one"), paragraph("two")>');
  });

  it('rebuilds the list a copy from inside a list item records in its slice marker', () => {
    const source = mount('<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>');
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, textPos(source, 'pha'), textPos(source, 'be') + 2)));
    const copied = copySelection(source.view);
    expect(copied.html).toContain('data-pm-slice="3 3 []"');
    expect(copied.text).toBe('pha\n\nbe');

    const target = mount('<p></p>');
    expect(describeSlice(pastedSlice(target.view, copied)))
      .toBe('3 3 <bulletList(listItem(paragraph("pha")), listItem(paragraph("be")))>');
  });

  it('reads bare list items, as Firefox copies them, as an open list', () => {
    const editor = mount('<p></p>');
    expect(describeSlice(pastedSlice(editor.view, { html: '<li>one</li><li>two</li>' })))
      .toBe('3 3 <bulletList(listItem(paragraph("one")), listItem(paragraph("two")))>');
  });

  it('takes a plain text paste through the same parse', () => {
    const editor = mount('<p></p>');
    expect(describeSlice(pastedSlice(editor.view, { text: 'one\n\ntwo' }))).toBe('1 1 <paragraph("one"), paragraph("two")>');
  });

  it('inserts nothing while it takes the slice, and pastes through every handler on request', () => {
    const editor = mount('<p>start</p>');
    pastedSlice(editor.view, { html: '<p>ignored</p>' });
    expect(editor.getHTML()).toBe('<p>start</p>');

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    const event = pasteClipboard(editor.view, { html: '<p><strong>bold</strong></p>', text: 'bold' });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe('<p>start<strong>bold</strong></p>');
  });

  it('carries files beside the text flavors, as a browser lists them', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const data = clipboardEvent({ html: '<img src="a.png">', files: [file] }).clipboardData;

    expect(data?.types).toEqual(['text/html', 'Files']);
    expect(data?.files).toEqual([file]);
    expect(Array.from(data?.items ?? [], item => `${item.kind} ${item.type}`)).toEqual(['string text/html', 'file image/png']);
    expect(data?.items[1]?.getAsFile()).toBe(file);
  });

  it('reports a copy of an empty selection instead of returning nothing', () => {
    const editor = mount('<p>text</p>');
    expect(() => copySelection(editor.view)).toThrow('The editor copied nothing');
  });
});
