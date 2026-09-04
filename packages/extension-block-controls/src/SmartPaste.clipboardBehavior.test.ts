import { afterEach, describe, expect, it } from 'vitest';
import {
  BulletList, Document, Editor, HardBreak, History, ListItem, OrderedList, Paragraph, Text,
} from '@domternal/core';
import { setClipboardPasteBehavior } from '@domternal/core/clipboard';
import type { ClipboardPasteBehavior } from '@domternal/core/clipboard';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function makeEditor(content: string, changes: Transaction[] = []): Editor {
  const editor = new Editor({
    extensions: [Document, Text, Paragraph, HardBreak, OrderedList, BulletList, ListItem, History, SmartPaste],
    content,
    onTransaction: ({ transaction }) => { if (transaction.docChanged) changes.push(transaction); },
  });
  editors.push(editor);
  return editor;
}

function list(body: string, start = 1): string {
  return `<ol${start === 1 ? '' : ` start="${String(start)}"`}>${body}</ol>`;
}

function item(body: string): string {
  return `<li><p>${body}</p></li>`;
}

function paragraphPosition(editor: Editor, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (found === undefined && node.type.name === 'paragraph' && node.textContent === text) found = position + 1;
    return found === undefined;
  });
  if (found === undefined) throw new Error(`Missing paragraph: ${text}`);
  return found;
}

function eventFor(html: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Imported' : '' },
  });
  return event as ClipboardEvent;
}

const cases = [
  { name: 'before', source: 'BeforeAfter', initial: list(item('BeforeAfter')), from: 0, before: '', after: list(item('BeforeAfter')) },
  { name: 'end', source: 'BeforeAfter', initial: list(item('BeforeAfter')), from: 11, before: list(item('BeforeAfter')), after: '' },
  { name: 'middle', source: 'BeforeAfter', initial: list(item('BeforeAfter')), from: 6, before: list(item('Before')), after: list(item('After')) },
  { name: 'range', source: 'BeforeXXXAfter', initial: list(item('BeforeXXXAfter')), from: 6, to: 9, before: list(item('Before')), after: list(item('After')) },
  { name: 'only empty item', source: '', initial: list(item('')), from: 0, before: '', after: '' },
  { name: 'empty item among siblings', source: '', initial: list(item('Before') + item('') + item('After')), from: 0, before: list(item('Before')), after: list(item('After')) },
  { name: 'trailing hard break', source: 'Before', initial: list(item('Before<br>')), from: 7, before: list(item('Before')), after: '' },
];

describe('SmartPaste explicit ordered-list start preservation', () => {
  it.each(cases.flatMap(test => [1, 7].map(start => ({ ...test, start }))))(
    'preserves start=$start at $name with one undoable paste transaction', ({ initial, source, from, to, before, after, start }) => {
      const changes: Transaction[] = [];
      const editor = makeEditor(initial, changes);
      const position = paragraphPosition(editor, source);
      editor.view.dispatch(editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, position + from, position + (to ?? from)),
      ));
      const original = editor.state.doc;
      const originalSelection = editor.state.selection.toJSON();
      const imported = list(item('Imported'), start);
      const event = eventFor(imported);
      setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

      editor.view.dom.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getHTML()).toBe(before + imported + after);
      expect(() => { editor.state.doc.check(); }).not.toThrow();
      expect(changes).toHaveLength(1);
      expect(changes[0]?.getMeta('paste')).toBe(true);
      expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
      expect(editor.state.selection.$from.parent.textContent).toBe('Imported');
      expect(editor.state.selection.$from.parentOffset).toBe('Imported'.length);
      expect(undoDepth(editor.state)).toBe(1);
      const pasted = editor.state.doc;
      const pastedSelection = editor.state.selection.toJSON();

      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.eq(original)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(originalSelection);
      expect(undoDepth(editor.state)).toBe(0);
      expect(redoDepth(editor.state)).toBe(1);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.state.doc.eq(pasted)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(pastedSelection);
    },
  );

  it.each([undefined, {}, { preserveOrderedListStart: false }] as (ClipboardPasteBehavior | undefined)[])(
    'retains existing same-kind merging without enabled intent: %j', behavior => {
      const editor = makeEditor(list(item('Existing'), 3));
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
      const event = eventFor(list(item('Imported'), 7));
      if (behavior !== undefined) setClipboardPasteBehavior(editor.view, event, behavior);
      editor.view.dom.dispatchEvent(event);
      expect(editor.getHTML()).toBe(list(item('Existing') + item('Imported'), 3));
    },
  );

  it('does not take formatting intent from clipboard attributes', () => {
    const editor = makeEditor(list(item('Existing'), 3));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
    const event = eventFor('<ol start="7" data-preserve-ordered-list-start="true"><li><p>Imported</p></li></ol>');
    editor.view.dom.dispatchEvent(event);
    expect(editor.getHTML()).toBe(list(item('Existing') + item('Imported'), 3));
  });

  it('ignores intent attached to another event or another destination view', () => {
    const first = makeEditor(list(item('Existing')));
    const second = makeEditor(list(item('Existing')));
    const event = eventFor(list(item('Imported'), 7));
    setClipboardPasteBehavior(first.view, event, { preserveOrderedListStart: true });
    first.view.dispatch(first.state.tr.setSelection(TextSelection.create(first.state.doc, paragraphPosition(first, 'Existing') + 8)));
    first.view.dom.dispatchEvent(eventFor(list(item('Imported'), 7)));
    expect(first.getHTML()).toBe(list(item('Existing') + item('Imported')));
    second.view.dispatch(second.state.tr.setSelection(TextSelection.create(second.state.doc, paragraphPosition(second, 'Existing') + 8)));
    second.view.dom.dispatchEvent(event);
    expect(second.getHTML()).toBe(list(item('Existing') + item('Imported')));
  });

  it('clears prior intent for an explicitly reset reused event', () => {
    const editor = makeEditor(list(item('Existing')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
    const event = eventFor(list(item('Imported'), 7));
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });
    setClipboardPasteBehavior(editor.view, event, {});
    editor.view.dom.dispatchEvent(event);
    expect(editor.getHTML()).toBe(list(item('Existing') + item('Imported')));
  });

  it('does not alter same-kind bullet merging when the ordered-list flag is enabled', () => {
    const editor = makeEditor('<ul>' + item('Existing') + '</ul>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
    const event = eventFor('<ul>' + item('Imported') + '</ul>');
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });
    editor.view.dom.dispatchEvent(event);
    expect(editor.getHTML()).toBe('<ul>' + item('Existing') + item('Imported') + '</ul>');
  });

  it('preserves intent for programmatic paste and a range crossing two host items', () => {
    const editor = makeEditor(list(item('BeforeXXX') + item('YYYAfter')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(
      editor.state.doc, paragraphPosition(editor, 'BeforeXXX') + 6, paragraphPosition(editor, 'YYYAfter') + 3,
    )));
    const imported = list(item('Imported'), 7);
    const event = eventFor(imported);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

    expect(editor.view.pasteHTML(imported, event)).toBe(true);

    expect(editor.getHTML()).toBe(list(item('Before')) + imported + list(item('After')));
    expect(editor.state.selection.$from.parent.textContent).toBe('Imported');
  });

  it.each(cases)(
    'preserves sibling placement and starts of restarted lists at $name', ({ initial, source, from, to, before, after }) => {
      const changes: Transaction[] = [];
      const editor = makeEditor(initial, changes);
      const position = paragraphPosition(editor, source);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(
        editor.state.doc, position + from, position + (to ?? from),
      )));
      const original = editor.state.doc;
      const originalSelection = editor.state.selection.toJSON();
      const imported = list(item('Seven') + item('Eight'), 7) + list(item('Restarted'), 2);
      const event = eventFor(imported);
      setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

      editor.view.dom.dispatchEvent(event);

      expect(editor.getHTML()).toBe(before + imported + after);
      expect(event.defaultPrevented).toBe(true);
      expect(() => { editor.state.doc.check(); }).not.toThrow();
      expect(changes).toHaveLength(1);
      expect(changes[0]?.getMeta('paste')).toBe(true);
      expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
      expect(editor.state.selection.$from.parent.textContent).toBe('Restarted');
      expect(editor.state.selection.$from.parentOffset).toBe('Restarted'.length);
      expect(undoDepth(editor.state)).toBe(1);
      const pasted = editor.state.doc;
      const pastedSelection = editor.state.selection.toJSON();

      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.eq(original)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(originalSelection);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.state.doc.eq(pasted)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(pastedSelection);
    },
  );

  it('keeps mixed nested list structures and paragraph interruptions at the source sibling level', () => {
    const editor = makeEditor(list(item('BeforeAfter')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'BeforeAfter') + 6)));
    const imported = list('<li><p>Seven</p><ul>' + item('Nested bullet') + '</ul></li>', 7)
      + '<p>Source interruption</p>'
      + '<ul><li><p>Root bullet</p>' + list(item('Nested ordered'), 4) + '</li></ul>'
      + list(item('Restarted'), 2);
    const event = eventFor(imported);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

    editor.view.dom.dispatchEvent(event);

    expect(editor.getHTML()).toBe(list(item('Before')) + imported + list(item('After')));
    expect(editor.state.doc.childCount).toBe(6);
    expect(() => { editor.state.doc.check(); }).not.toThrow();
  });

  it('preserves a leading source paragraph together with multiple ordered lists', () => {
    const editor = makeEditor(list(item('Existing')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
    const imported = '<p>Source introduction</p>' + list(item('Seven'), 7) + list(item('Restarted'), 2);
    const event = eventFor(imported);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

    editor.view.dom.dispatchEvent(event);

    expect(editor.getHTML()).toBe(list(item('Existing')) + imported);
  });

  it('preserves multiple source siblings at the nearest nested host list level', () => {
    const editor = makeEditor('<ul><li><p>Outer</p>' + list(item('BeforeAfter')) + '</li></ul>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'BeforeAfter') + 6)));
    const imported = list(item('Seven'), 7) + list(item('Restarted'), 2);
    const event = eventFor(imported);
    setClipboardPasteBehavior(editor.view, event, { preserveOrderedListStart: true });

    editor.view.dom.dispatchEvent(event);

    expect(editor.getHTML()).toBe('<ul><li><p>Outer</p>' + list(item('Before')) + imported + list(item('After')) + '</li></ul>');
  });

  it('keeps existing unflagged multi-block placement unchanged', () => {
    const editor = makeEditor(list(item('Existing')));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphPosition(editor, 'Existing') + 8)));
    const imported = list(item('Seven'), 7) + list(item('Restarted'), 2);

    editor.view.dom.dispatchEvent(eventFor(imported));

    expect(editor.getHTML()).toBe('<ol><li><p>Existing</p>' + imported + '</li></ol>');
  });
});
