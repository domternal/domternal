import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { History } from '../extensions/History.js';
import type { ContentDiagnosticProps } from '../types/index.js';
import type { CommandProps } from '../types/Commands.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

const html = '<ol><li><p>A</p><ul><li><p>B</p></li></ul></li></ol><p>tail</p>';

/** Stores unknown markers the way a bound collaborative document does: without validation or history. */
function mount(editable = true): { editor: Editor; reports: ContentDiagnosticProps[]; transactions: number } {
  const reports: ContentDiagnosticProps[] = [];
  const result = { editor: undefined as unknown as Editor, reports, transactions: 0 };
  editor = new Editor({
    extensions: [Document, Paragraph, Text, OrderedList, BulletList, History],
    content: html,
    editable,
    onContentDiagnostic: props => reports.push(props),
    onTransaction: () => { result.transactions++; },
  });
  inject(editor, [['orderedList', 'bogus'], ['bulletList', 'decimal']]);
  result.editor = editor;
  result.transactions = 0;
  return result;
}

function inject(ed: Editor, values: [string, string][]): void {
  const tr = ed.state.tr.setMeta('addToHistory', false);
  ed.state.doc.descendants((node, pos) => {
    const value = values.find(([type]) => type === node.type.name)?.[1];
    if (value !== undefined) tr.setNodeAttribute(pos, 'listStyleType', value);
  });
  ed.view.dispatch(tr);
}

const markers = (ed: Editor): unknown[] => {
  const found: unknown[] = [];
  ed.state.doc.descendants(node => { if ('listStyleType' in node.attrs) found.push(node.attrs['listStyleType']); });
  return found;
};

function typeAtEnd(ed: Editor, text: string): void {
  const end = ed.state.doc.content.size - 1;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end)).insertText(text));
}

describe('normalizeListMarkers', () => {
  it('detects, migrates every unknown marker in one step, reports and is idempotent', () => {
    const { editor: ed, reports } = mount();
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeListMarkers()).toBe(true);
    expect(reports).toEqual([]);
    expect(ed.commands.normalizeListMarkers()).toBe(true);
    expect(markers(ed)).toEqual([null, null]);
    expect(ed.getText()).toBe('A\n\nB\n\ntail');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      source: 'normalizeListMarkers',
      total: 2,
      diagnostics: [
        { code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' },
        { code: 'unknown-list-marker', nodeType: 'bulletList', attribute: 'listStyleType', path: [0, 0, 1], value: 'decimal' },
      ],
    });
    expect(ed.can().normalizeListMarkers()).toBe(false);
    expect(ed.commands.normalizeListMarkers()).toBe(false);
    expect(ed.chain().normalizeListMarkers().run()).toBe(false);
    expect(reports).toHaveLength(1);
  });

  it('keeps valid markers and returns false when nothing is unknown', () => {
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList], content: '<ol style="list-style-type: upper-roman"><li><p>A</p></li></ol>' });
    expect(editor.can().normalizeListMarkers()).toBe(false);
    expect(editor.commands.normalizeListMarkers()).toBe(false);
    expect(markers(editor)).toEqual(['upper-roman']);
  });

  it('stays out of the undo history, so undo neither restores the marker nor loses the user edit', () => {
    const { editor: ed } = mount();
    typeAtEnd(ed, '!');
    expect(ed.commands.normalizeListMarkers()).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getText()).toBe('A\n\nB\n\ntail');
    expect(markers(ed)).toEqual([null, null]);
    expect(ed.commands.undo()).toBe(false);
    expect(ed.commands.redo()).toBe(true);
    expect(ed.getText()).toBe('A\n\nB\n\ntail!');
    expect(markers(ed)).toEqual([null, null]);
  });

  it('can run again when undo brings an unknown marker back', () => {
    const { editor: ed } = mount();
    const list = ed.state.doc.child(0);
    ed.view.dispatch(ed.state.tr.delete(0, list.nodeSize));
    expect(ed.can().normalizeListMarkers()).toBe(false);
    expect(ed.commands.undo()).toBe(true);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeListMarkers()).toBe(true);
    expect(ed.commands.normalizeListMarkers()).toBe(true);
    expect(markers(ed)).toEqual([null, null]);
  });

  it('refuses in a read-only editor without dispatching', () => {
    const { editor: ed, reports } = mount(false);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeListMarkers()).toBe(false);
    expect(ed.commands.normalizeListMarkers()).toBe(false);
    expect(ed.chain().normalizeListMarkers().run()).toBe(false);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(reports).toEqual([]);
    ed.setEditable(true);
    expect(ed.commands.normalizeListMarkers()).toBe(true);
  });

  it('never dispatches from a dry run', () => {
    const result = mount();
    expect(result.editor.can().chain().normalizeListMarkers().run()).toBe(true);
    expect(result.transactions).toBe(0);
    expect(markers(result.editor)).toEqual(['bogus', 'decimal']);
  });

  it('leaves the shared transaction alone when a chained command dry-runs it', () => {
    const { editor: ed, reports } = mount();
    // ChainedCommands does not declare the runtime command() helper.
    const chain = ed.chain() as unknown as { command: (fn: (props: CommandProps) => boolean) => { run: () => boolean } };
    expect(chain.command(({ can }) => can().normalizeListMarkers()).run()).toBe(true);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(reports).toEqual([]);
  });
});
