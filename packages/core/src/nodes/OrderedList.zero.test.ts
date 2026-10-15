import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import type { InputRule } from '@domternal/pm/inputrules';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from './Document.js';
import { Paragraph } from './Paragraph.js';
import { Text } from './Text.js';
import { OrderedList } from './OrderedList.js';
import { History } from '../extensions/History.js';
import { liftListItemWithMarker } from '../utils/listMarkerCommands.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });
function make(content: string): Editor {
  editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, History], content });
  editor.view.setProps({ handleScrollToSelection: () => true });
  return editor;
}
const zero = '<ol start="0" style="list-style-type: decimal"><li><p>Zero</p></li><li><p>One</p></li></ol>';
function select(ed: Editor, text: string): void {
  let position: number | undefined;
  ed.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) position = pos; });
  if (position === undefined) throw new Error('Missing authored list item');
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, position)));
}

describe('zero-based ordered lists', () => {
  it('preserves zero through HTML, JSON, rendering and HTML reload', () => {
    const ed = make(zero);
    const before = ed.getJSON();
    expect(ed.state.doc.firstChild?.attrs['start']).toBe(0);
    expect(ed.view.dom.querySelector('ol')?.getAttribute('start')).toBe('0');
    expect(ed.getHTML()).toContain('start="0"');
    ed.commands.setContent(before);
    expect(ed.getJSON()).toEqual(before);
    ed.commands.setContent(ed.getHTML());
    expect(ed.getJSON()).toEqual(before);
    ed.state.doc.check();
  });

  it.each(['-1', '-12', '', 'invalid', 'Infinity'])('keeps the existing fallback for %j', start => {
    const ed = make(`<ol start="${start}"><li><p>One</p></li></ol>`);
    expect(ed.state.doc.firstChild?.attrs['start']).toBe(1);
    expect(ed.getHTML()).toBe('<ol><li><p>One</p></li></ol>');
  });

  it('starts a new list when typing zero followed by a period', () => {
    const ed = make('<p>0. </p>');
    const extension = ed.extensionManager.extensions.find(value => value.name === 'orderedList');
    if (!extension || !('nodeType' in extension)) throw new Error('Missing ordered list extension');
    const rules = OrderedList.config.addInputRules?.call(extension as typeof OrderedList);
    const rule = rules?.[0] as (InputRule & { handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null }) | undefined;
    if (!rule) throw new Error('Missing ordered list input rule');
    const result = rule.handler(ed.state, ['0. ', '0'] as unknown as RegExpMatchArray, 1, 4);
    expect(result?.doc.firstChild?.attrs['start']).toBe(0);
    expect(result?.doc.firstChild?.type.name).toBe('orderedList');
  });

  it('lifts the first zero-based item and retains the remaining counter with exact Undo and Redo', () => {
    const ed = make(zero); select(ed, 'Zero');
    const before = ed.getJSON();
    const command = liftListItemWithMarker(ed.schema.nodes['listItem']!);
    expect(command(ed.state)).toBe(true);
    expect(ed.getJSON()).toEqual(before);
    expect(command(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.doc.child(0).textContent).toBe('Zero');
    expect(ed.state.doc.child(0).type.name).toBe('paragraph');
    expect(ed.state.doc.child(1).attrs).toMatchObject({ start: 1, listStyleType: 'decimal' });
    expect(ed.state.doc.child(1).textContent).toBe('One');
    const after = ed.getJSON(); ed.state.doc.check();
    expect(ed.commands.undo()).toBe(true); expect(ed.getJSON()).toEqual(before);
    expect(ed.commands.redo()).toBe(true); expect(ed.getJSON()).toEqual(after);
  });

  it('retains zero when lifting a nested item across a marker boundary', () => {
    const ed = make('<ol start="3" style="list-style-type:upper-roman"><li><p>Outer</p>'
      + zero + '</li><li><p>Next</p></li></ol>');
    select(ed, 'Zero');
    const command = liftListItemWithMarker(ed.schema.nodes['listItem']!);
    expect(command(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ start: 3, listStyleType: 'upper-roman' });
    expect(ed.state.doc.child(1).attrs).toMatchObject({ start: 0, listStyleType: 'decimal' });
    expect(ed.state.doc.child(1).firstChild?.firstChild?.textContent).toBe('Zero');
    expect(ed.state.doc.child(2).attrs).toMatchObject({ start: 4, listStyleType: 'upper-roman' });
    ed.state.doc.check();
  });
});
