import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import type { Mark } from '@domternal/pm/model';
import { closeHistory, undoDepth } from '@domternal/pm/history';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { Bold } from '../marks/Bold.js';
import { BaseKeymap } from './BaseKeymap.js';
import { History } from './History.js';
import { UniqueID } from './UniqueID.js';

type TypingPolicy = 'bold' | 'empty' | 'inferred';
let editor: Editor | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { editor?.destroy(); editor = undefined; vi.useRealTimers(); });

function make(content: string): Editor {
  let generated = 0;
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, OrderedList, BaseKeymap, History,
      UniqueID.configure({ generateID: () => `assigned-${String(++generated)}` })],
    content,
  });
  editor.view.setProps({ handleScrollToSelection: () => true });
  return editor;
}
function content(policy: TypingPolicy, text: string): string {
  return policy === 'bold' ? text : `<strong>${text}</strong>`;
}
function choose(ed: Editor, text: string, policy: TypingPolicy): readonly Mark[] | null {
  let position = -1;
  ed.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) position = pos + 1; });
  if (position < 0) throw new Error('Missing authored text');
  const marks = policy === 'bold' ? [ed.schema.marks['bold']!.create()] : policy === 'empty' ? [] : null;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, position)).setStoredMarks(marks));
  return marks;
}
function typeAndCheck(ed: Editor, policy: TypingPolicy): void {
  ed.view.dispatch(ed.state.tr.insertText('X'));
  const marks: string[][] = [];
  ed.state.doc.descendants(node => { if (node.isText && node.text?.includes('X')) marks.push(node.marks.map(mark => mark.type.name)); });
  expect(marks).toEqual([policy === 'empty' ? [] : ['bold']]);
  ed.state.doc.check();
}
function ids(ed: Editor): unknown[] {
  const result: unknown[] = [];
  ed.state.doc.descendants(node => { if (Object.hasOwn(node.attrs, 'id')) result.push(node.attrs['id']); });
  return result;
}

describe('UniqueID preserves the existing typing policy', () => {
  it.each((['bold', 'empty', 'inferred'] as const).flatMap(policy =>
    (['missing', 'collision'] as const).map(sweep => ({ policy, sweep }))))(
    'preserves $policy through the startup $sweep sweep', ({ policy, sweep }) => {
      const attribute = sweep === 'collision' ? ' id="original"' : '';
      const ed = make(`<p${attribute}>${content(policy, 'Base')}</p><p${attribute}>Tail</p>`);
      const expected = choose(ed, 'Base', policy); const selection = ed.state.selection.toJSON();
      expect(ids(ed)).toEqual(sweep === 'collision' ? ['original', 'original'] : [null, null]);
      vi.advanceTimersByTime(0);
      expect(new Set(ids(ed)).size).toBe(2); expect(ids(ed).every(id => typeof id === 'string')).toBe(true);
      if (sweep === 'collision') expect(ids(ed)[0]).toBe('original');
      expect(ed.state.selection.toJSON()).toEqual(selection);
      expect(ed.state.storedMarks).toEqual(expected);
      expect(undoDepth(ed.state)).toBe(0);
      typeAndCheck(ed, policy);
    },
  );

  it.each((['bold', 'empty', 'inferred'] as const).flatMap(policy =>
    (['missing', 'collision'] as const).map(sweep => ({ policy, sweep }))))(
    'preserves $policy through an appended $sweep sweep', ({ policy, sweep }) => {
      const ed = make(`<p id="original">${content(policy, 'Base')}</p><p id="tail">Tail</p>`);
      vi.advanceTimersByTime(0);
      const expected = choose(ed, 'Base', policy); const selection = ed.state.selection.toJSON();
      const inserted = ed.schema.nodes['paragraph']!.create({ id: sweep === 'collision' ? 'original' : null }, ed.schema.text('Copy'));
      ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, inserted).setStoredMarks(expected));
      expect(ids(ed).slice(0, 2)).toEqual(['original', 'tail']);
      expect(ids(ed)[2]).toMatch(/^assigned-/); expect(new Set(ids(ed)).size).toBe(3);
      expect(ed.state.selection.toJSON()).toEqual(selection);
      expect(ed.state.storedMarks).toEqual(expected);
      expect(undoDepth(ed.state)).toBe(1);
      typeAndCheck(ed, policy);
    },
  );

  it.each(['bold', 'empty'] as const)('preserves %s after Shift-Tab splits an explicit list and UniqueID repairs its copied wrapper ID', policy => {
    const ed = make('<ol id="list" start="7" style="list-style-type:decimal">'
      + ['Alpha', 'Bravo', 'Charlie'].map((text, index) => `<li id="item${String(index)}"><p id="p${String(index)}">${content(policy, text)}</p></li>`).join('')
      + '</ol>');
    vi.advanceTimersByTime(0);
    const expected = choose(ed, 'Bravo', policy); const original = ed.state.doc.toJSON();
    ed.view.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(ed.state.doc.childCount).toBe(3);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ id: 'list', start: 7, listStyleType: 'decimal' });
    expect(ed.state.doc.child(1).attrs['id']).toBe('p1');
    expect(ed.state.doc.child(2).attrs).toMatchObject({ start: 9, listStyleType: 'decimal' });
    expect(ed.state.doc.child(2).attrs['id']).toMatch(/^assigned-/);
    expect(new Set(ids(ed)).size).toBe(ids(ed).length);
    expect(ed.state.storedMarks).toEqual(expected);
    expect(ed.state.selection.$from.parent.textContent).toBe('Bravo');
    expect(ed.state.selection.$from.parentOffset).toBe(1);
    const lifted = ed.state.doc.toJSON();
    ed.view.dispatch(closeHistory(ed.state.tr));
    typeAndCheck(ed, policy); const typed = ed.state.doc.toJSON();
    expect(ed.commands.undo()).toBe(true); expect(ed.state.doc.toJSON()).toEqual(lifted);
    expect(ed.commands.undo()).toBe(true); expect(ed.state.doc.toJSON()).toEqual(original);
    expect(ed.commands.redo()).toBe(true); expect(ed.state.doc.toJSON()).toEqual(lifted);
    expect(ed.commands.redo()).toBe(true); expect(ed.state.doc.toJSON()).toEqual(typed);
  });
});
