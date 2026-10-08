import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { Editor } from '../../Editor.js';
import { Document } from '../../nodes/Document.js';
import { Paragraph } from '../../nodes/Paragraph.js';
import { Text } from '../../nodes/Text.js';
import { Link } from '../Link.js';
import { History } from '../../extensions/History.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('Link paste transaction identity', () => {
  it.each([
    { name: 'insert linked URL', content: '<p>Before</p>', from: 7, to: 7, text: 'Beforehttps://example.test/path' },
    { name: 'link selected text', content: '<p>Label</p>', from: 1, to: 6, text: 'Label' },
  ])('tags $name as a single undoable paste transaction', ({ content, from, to, text }) => {
    const changes: Transaction[] = [];
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, Link.configure({ autolink: false }), History],
      content,
      onTransaction: ({ transaction }) => { if (transaction.docChanged) changes.push(transaction); },
    });
    editor = instance;
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, from, to)));
    const original = instance.state.doc;
    const originalSelection = instance.state.selection.toJSON();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/plain' ? 'https://example.test/path' : '' },
    });

    instance.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(instance.state.doc.textContent).toBe(text);
    expect(instance.state.doc.firstChild?.lastChild?.marks.find(mark => mark.type.name === 'link')?.attrs['href'])
      .toBe('https://example.test/path');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.getMeta('paste')).toBe(true);
    expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
    expect(undoDepth(instance.state)).toBe(1);
    const pasted = instance.state.doc;
    const pastedSelection = instance.state.selection.toJSON();

    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(original)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(originalSelection);
    expect(undoDepth(instance.state)).toBe(0);
    expect(redoDepth(instance.state)).toBe(1);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.eq(pasted)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(pastedSelection);
  });
});
