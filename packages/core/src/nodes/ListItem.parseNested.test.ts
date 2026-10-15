import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser } from '@domternal/pm/model';
import { undo } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { copySelection, pasteClipboard } from '@domternal/tests-clipboard-slices';
import { BulletList, Document, Editor, generateJSON, History, ListItem, OrderedList, Paragraph, TaskItem, TaskList, Text } from '../index.js';
import type { AnyExtension } from '../index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function mount(content = '<p></p>'): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), content,
    extensions: [Document, Paragraph, Text, BulletList, OrderedList, ListItem, TaskList, TaskItem, History] });
  editor.view.setProps({ handleScrollToSelection: () => true });
  editors.push(editor);
  return editor;
}
const renamedExtensions = (): AnyExtension[] => [Document, Paragraph, Text, BulletList, OrderedList, ListItem,
  TaskList.extend({ name: 'todoList', content: 'todoItem+' }).configure({ itemTypeName: 'todoItem' }),
  TaskItem.extend({ name: 'todoItem' }), History];
function mountRenamed(content = '<p></p>'): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), content, extensions: renamedExtensions() });
  editor.view.setProps({ handleScrollToSelection: () => true });
  editors.push(editor);
  return editor;
}
const cases = [
  ['ordered', '<ol start="3" type="a"><li><ul><li>nested</li></ul></li><li>last</li></ol>',
    'doc(orderedList(listItem(paragraph, bulletList(listItem(paragraph("nested")))), listItem(paragraph("last"))))'],
  ['bullet', '<ul><li><ol start="0"><li>nested</li></ol></li><li>last</li></ul>',
    'doc(bulletList(listItem(paragraph, orderedList(listItem(paragraph("nested")))), listItem(paragraph("last"))))'],
  ['task', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><ul><li>nested</li></ul></li><li data-type="taskItem" data-checked="false"><p>last</p></li></ul>',
    'doc(taskList(taskItem(paragraph, bulletList(listItem(paragraph("nested")))), taskItem(paragraph("last"))))'],
  ['rendered task', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><ul><li>nested</li></ul></div></li><li data-type="taskItem"><p>last</p></li></ul>',
    'doc(taskList(taskItem(paragraph, bulletList(listItem(paragraph("nested")))), taskItem(paragraph("last"))))'],
] as const;

describe('nested-list-first items without PasteCleanup', () => {
  it.each(cases)('keeps the whole %s list on load and paste', (kind, html, expected) => {
    const loaded = mount(html);
    expect(loaded.state.doc.toString()).toBe(expected);
    loaded.state.doc.check();
    const extensions = [Document, Paragraph, Text, BulletList, OrderedList, ListItem, TaskList, TaskItem];
    for (const owner of [document, parseHTML('<html><body></body></html>').document]) {
      expect(generateJSON(html, extensions, { document: owner })).toEqual(loaded.getJSON());
    }
    if (kind === 'ordered') expect(loaded.state.doc.firstChild?.attrs).toMatchObject({ start: 3, listStyleType: 'lower-alpha' });
    if (kind.includes('task')) expect(loaded.state.doc.firstChild?.firstChild?.attrs['checked']).toBe(true);
    const editor = mount();
    const before = editor.state.doc;
    pasteClipboard(editor.view, { html, text: 'nested\nlast' });
    expect(editor.state.doc.toString()).toBe(expected);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('leaves the source DOM unchanged while preserving nested descendants', () => {
    const editor = mount();
    const source = document.createElement('div');
    source.innerHTML = '<ol><li> \n<!--before--><ul><li><ol><li>inner</li></ol></li></ul></li><li>last</li></ol>';
    const before = source.innerHTML;
    const doc = DOMParser.fromSchema(editor.schema).parse(source);
    expect(source.innerHTML).toBe(before);
    expect(doc.toString()).toBe('doc(orderedList(listItem(paragraph, bulletList(listItem(paragraph, orderedList(listItem(paragraph("inner")))))), listItem(paragraph("last"))))');
  });

  it('preserves a real native partial copy from a nested item without inventing a parent label', () => {
    const editor = mount('<ol start="3"><li><p>parent</p><ul><li><p>alpha beta</p></li><li><p>next</p></li></ul></li><li><p>last</p></li></ol>');
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'alpha beta') from = pos + 6;
      if (node.isText && node.text === 'next') to = pos + 4;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    const source = copySelection(editor.view);
    const pasted = mount();
    pasteClipboard(pasted.view, source);
    expect(pasted.state.doc.toString()).toBe('doc(bulletList(listItem(paragraph("beta")), listItem(paragraph("next"))))');
  });

  it('keeps inherited task wrappers after the item and list types are renamed', () => {
    const html = '<ul data-type="todoList"><li data-type="todoItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><ul><li>nested</li></ul></div></li><li data-type="todoItem"><p>last</p></li></ul>';
    const expected = 'doc(todoList(todoItem(paragraph, bulletList(listItem(paragraph("nested")))), todoItem(paragraph("last"))))';
    const loaded = mountRenamed(html);
    expect(loaded.state.doc.toString()).toBe(expected);
    expect(loaded.state.doc.firstChild?.firstChild?.attrs['checked']).toBe(true);
    loaded.state.doc.check();
    for (const owner of [document, parseHTML('<html><body></body></html>').document]) {
      expect(generateJSON(html, renamedExtensions(), { document: owner })).toEqual(loaded.getJSON());
    }
    const editor = mountRenamed();
    const before = editor.state.doc;
    pasteClipboard(editor.view, { html, text: 'nested\nlast' });
    expect(editor.state.doc.toString()).toBe(expected);
    expect(editor.state.doc.firstChild?.firstChild?.attrs['checked']).toBe(true);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('leaves a native partial copy of renamed nested tasks open at the original depth', () => {
    const editor = mountRenamed('<ul data-type="todoList"><li data-type="todoItem"><p>parent</p><ul data-type="todoList"><li data-type="todoItem" data-checked="true"><p>alpha beta</p></li><li data-type="todoItem"><p>next</p></li></ul></li><li data-type="todoItem"><p>last</p></li></ul>');
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'alpha beta') from = pos + 6;
      if (node.isText && node.text === 'next') to = pos + 4;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    const source = copySelection(editor.view);
    const pasted = mountRenamed();
    pasteClipboard(pasted.view, source);
    expect(pasted.state.doc.toString()).toBe('doc(todoList(todoItem(paragraph("beta")), todoItem(paragraph("next"))))');
    expect(pasted.state.doc.firstChild?.firstChild?.attrs['checked']).toBe(true);
    expect(pasted.state.doc.firstChild?.lastChild?.attrs['checked']).toBe(false);
    pasted.state.doc.check();
  });
});
