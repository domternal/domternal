import { afterEach, describe, expect, it } from 'vitest';
import {
  BulletList, Document, Editor, HardBreak, History, ListItem, OrderedList, Paragraph,
  TaskItem, TaskList, Text,
} from '@domternal/core';
import { setClipboardPasteBehavior } from '@domternal/core/clipboard';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(content: string, changes: Transaction[] = []): Editor {
  const editor = new Editor({
    extensions: [Document, Text, Paragraph, HardBreak, OrderedList, BulletList, ListItem, TaskList, TaskItem, History, SmartPaste],
    content,
    onTransaction: ({ transaction }) => { if (transaction.docChanged) changes.push(transaction); },
  });
  editors.push(editor);
  return editor;
}

function list(tag: string, marker: string | null, content: string, start = 1): string {
  return `<${tag}${marker === null ? '' : ` style="list-style-type:${marker}"`}${tag === 'ol' && start !== 1 ? ` start="${String(start)}"` : ''}>${content}</${tag}>`;
}
function item(text: string): string { return `<li><p>${text}</p></li>`; }
function position(editor: Editor, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.name === 'paragraph' && node.textContent === text) found = pos + 1;
  });
  if (found === undefined) throw new Error('Missing authored paragraph');
  return found;
}
function select(editor: Editor, text: string, from: number, to = from): void {
  const base = position(editor, text);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, base + from, base + to)));
}
function clipboard(html: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : 'Imported' } });
  return event as ClipboardEvent;
}
function listSummary(editor: Editor): unknown[] {
  const result: unknown[] = [];
  editor.state.doc.forEach(node => result.push({ type: node.type.name, marker: node.attrs['listStyleType'], start: node.attrs['start'], text: node.textContent }));
  return result;
}
function expectedList(type: string, marker: string | null, start: number | undefined, text: string): unknown {
  return {
    type,
    attrs: { ...(start === undefined ? {} : { start }), listStyleType: marker },
    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }],
  };
}

const kinds = [
  { tag: 'ol', type: 'orderedList', host: 'decimal', source: 'upper-roman', start: 1 },
  { tag: 'ul', type: 'bulletList', host: 'disc', source: 'square', start: undefined },
];
const locations = [
  { name: 'start', text: 'BeforeAfter', from: 0, to: 0, before: null, after: 'BeforeAfter' },
  { name: 'end', text: 'BeforeAfter', from: 11, to: 11, before: 'BeforeAfter', after: null },
  { name: 'middle', text: 'BeforeAfter', from: 6, to: 6, before: 'Before', after: 'After' },
  { name: 'range', text: 'BeforeXXXAfter', from: 6, to: 9, before: 'Before', after: 'After' },
  { name: 'empty', text: '', from: 0, to: 0, before: null, after: null },
  { name: 'hard break', text: 'Before', html: 'Before<br>', from: 7, to: 7, before: 'Before', after: null },
];

describe('SmartPaste explicit list markers', () => {
  it.each(kinds.flatMap(kind => locations.map(location => ({ ...kind, ...location }))))(
    'keeps $source in its own $tag wrapper at $name with exact history', ({ tag, type, host, source, start, text, html, from, to, before, after }) => {
      const changes: Transaction[] = [];
      const editor = mount(list(tag, host, item(html ?? text)), changes);
      select(editor, text, from, to);
      const original = editor.state.doc;
      const originalSelection = editor.state.selection.toJSON();
      const event = clipboard(list(tag, source, item('Imported')));

      editor.view.dom.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(listSummary(editor)).toEqual([
        ...(before === null ? [] : [{ type, marker: host, start, text: before }]),
        { type, marker: source, start, text: 'Imported' },
        ...(after === null ? [] : [{ type, marker: host, start, text: after }]),
      ]);
      expect(editor.getJSON()).toEqual({ type: 'doc', content: [
        ...(before === null ? [] : [expectedList(type, host, start, before)]),
        expectedList(type, source, start, 'Imported'),
        ...(after === null ? [] : [expectedList(type, host, start, after)]),
      ] });
      expect(() => { editor.state.doc.check(); }).not.toThrow();
      expect(changes).toHaveLength(1);
      expect(changes[0]?.getMeta('paste')).toBe(true);
      expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
      expect(editor.state.selection.$from.parent.textContent).toBe('Imported');
      expect(editor.state.selection.$from.parentOffset).toBe(8);
      const pasted = editor.state.doc;
      const pastedSelection = editor.state.selection.toJSON();
      expect(undoDepth(editor.state)).toBe(1);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.eq(original)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(originalSelection);
      expect(redoDepth(editor.state)).toBe(1);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.state.doc.eq(pasted)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(pastedSelection);
    },
  );

  it.each(kinds.flatMap(kind => [null, kind.host].map(marker => ({ ...kind, marker }))))(
    'still merges equal $tag marker $marker without adopting a new start', ({ tag, type, marker }) => {
      const editor = mount(list(tag, marker, item('Existing'), 3));
      select(editor, 'Existing', 8);
      editor.view.dom.dispatchEvent(clipboard(list(tag, marker, item('Imported'), 7)));
      expect(listSummary(editor)).toEqual([{ type, marker, start: tag === 'ol' ? 3 : undefined, text: 'ExistingImported' }]);
      expect(editor.state.doc.firstChild?.childCount).toBe(2);
    },
  );

  it.each(kinds.flatMap(kind => [false, true].map(reverse => ({ ...kind, reverse }))))(
    'distinguishes null from explicit $host, reverse=$reverse', ({ tag, type, host, start, reverse }) => {
      const first = reverse ? host : null;
      const second = reverse ? null : host;
      const editor = mount(list(tag, first, item('Existing')));
      select(editor, 'Existing', 8);
      editor.view.dom.dispatchEvent(clipboard(list(tag, second, item('Imported'))));
      expect(listSummary(editor)).toEqual([
        { type, marker: first, start, text: 'Existing' }, { type, marker: second, start, text: 'Imported' },
      ]);
    },
  );

  it.each(kinds)('retains $tag marker boundaries with an ordered-start intent on programmatic range paste', ({ tag, type, host, source, start }) => {
    const editor = mount(list(tag, host, item('BeforeXXX') + item('YYYAfter')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(
      editor.state.doc, position(editor, 'BeforeXXX') + 6, position(editor, 'YYYAfter') + 3,
    )));
    const html = list(tag, source, item('Imported'));
    const event = clipboard(html);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });
    expect(editor.view.pasteHTML(html, event)).toBe(true);
    expect(listSummary(editor)).toEqual([
      { type, marker: host, start, text: 'Before' }, { type, marker: source, start, text: 'Imported' },
      { type, marker: host, start, text: 'After' },
    ]);
  });

  it('keeps a source marker at the nearest nested list depth', () => {
    const editor = mount(list('ul', 'square', `<li><p>Outer</p>${list('ol', 'decimal', item('BeforeAfter'))}</li>`));
    select(editor, 'BeforeAfter', 6);
    editor.view.dom.dispatchEvent(clipboard(list('ol', 'upper-roman', item('Imported'), 7)));
    const outer = editor.state.doc.firstChild;
    expect(outer?.attrs['listStyleType']).toBe('square');
    const parent = outer?.firstChild;
    expect(parent?.childCount).toBe(4);
    expect([1, 2, 3].map(index => ({ marker: parent?.child(index).attrs['listStyleType'], text: parent?.child(index).textContent }))).toEqual([
      { marker: 'decimal', text: 'Before' }, { marker: 'upper-roman', text: 'Imported' }, { marker: 'decimal', text: 'After' },
    ]);
    expect(parent?.child(2).attrs['start']).toBe(7);
  });

  it('keeps explicit matching markers and distinct starts when start preservation is requested', () => {
    const editor = mount(list('ol', 'upper-roman', item('Existing'), 3));
    select(editor, 'Existing', 8);
    const html = list('ol', 'upper-roman', item('Imported'), 7);
    const event = clipboard(html);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });
    editor.view.dom.dispatchEvent(event);
    expect(editor.getJSON()).toEqual({ type: 'doc', content: [
      expectedList('orderedList', 'upper-roman', 3, 'Existing'),
      expectedList('orderedList', 'upper-roman', 7, 'Imported'),
    ] });
  });

  it('keeps a cross-kind source marker without transferring it onto the destination kind', () => {
    const editor = mount(list('ol', 'upper-roman', item('BeforeAfter')));
    select(editor, 'BeforeAfter', 6);
    editor.view.dom.dispatchEvent(clipboard(list('ul', 'square', item('Imported'))));
    expect(editor.getJSON()).toEqual({ type: 'doc', content: [
      expectedList('orderedList', 'upper-roman', 1, 'Before'),
      expectedList('bulletList', 'square', undefined, 'Imported'),
      expectedList('orderedList', 'upper-roman', 1, 'After'),
    ] });
  });

  it('keeps task checked state without importing a bullet marker', () => {
    const editor = mount(list('ul', 'square', item('Existing')));
    select(editor, 'Existing', 8);
    editor.view.dom.dispatchEvent(clipboard('<ul data-type="taskList" style="list-style-type:circle"><li data-type="taskItem" data-checked="true"><p>Imported</p></li></ul>'));
    expect(editor.state.doc.child(0).attrs['listStyleType']).toBe('square');
    expect(editor.state.doc.child(1).type.name).toBe('taskList');
    expect(editor.state.doc.child(1).attrs['listStyleType']).toBeUndefined();
    expect(editor.state.doc.child(1).firstChild?.attrs['checked']).toBe(true);
  });

  it('keeps legacy same-kind merging when a custom schema has no marker attribute', () => {
    const LegacyOrderedList = OrderedList.extend({ addAttributes: () => ({}) });
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, LegacyOrderedList, ListItem, History, SmartPaste],
      content: list('ol', 'decimal', item('Existing')),
    });
    editors.push(editor);
    expect(editor.schema.nodes['orderedList']?.spec.attrs?.['listStyleType']).toBeUndefined();
    select(editor, 'Existing', 8);
    const html = list('ol', 'upper-roman', item('Imported'));
    expect(editor.view.pasteHTML(html, clipboard(html))).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBeUndefined();
    expect(editor.state.doc.textContent).toBe('ExistingImported');
  });
});
