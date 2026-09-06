import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { History } from '../extensions/History.js';
import { Heading } from '../nodes/Heading.js';
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

describe('normalizeContentAttributes', () => {
  it('detects, migrates every unknown marker in one step, reports and is idempotent', () => {
    const { editor: ed, reports } = mount();
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeContentAttributes()).toBe(true);
    expect(reports).toEqual([]);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(markers(ed)).toEqual([null, null]);
    expect(ed.getText()).toBe('A\n\nB\n\ntail');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      source: 'normalizeContentAttributes',
      total: 2,
      diagnostics: [
        { code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' },
        { code: 'unknown-list-marker', nodeType: 'bulletList', attribute: 'listStyleType', path: [0, 0, 1], value: 'decimal' },
      ],
    });
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    expect(ed.commands.normalizeContentAttributes()).toBe(false);
    expect(ed.chain().normalizeContentAttributes().run()).toBe(false);
    expect(reports).toHaveLength(1);
  });

  it('keeps valid markers and returns false when nothing is unknown', () => {
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList], content: '<ol style="list-style-type: upper-roman"><li><p>A</p></li></ol>' });
    expect(editor.can().normalizeContentAttributes()).toBe(false);
    expect(editor.commands.normalizeContentAttributes()).toBe(false);
    expect(markers(editor)).toEqual(['upper-roman']);
  });

  it('stays out of the undo history, so undo neither restores the marker nor loses the user edit', () => {
    const { editor: ed } = mount();
    typeAtEnd(ed, '!');
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
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
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    expect(ed.commands.undo()).toBe(true);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeContentAttributes()).toBe(true);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(markers(ed)).toEqual([null, null]);
  });

  it('refuses in a read-only editor without dispatching', () => {
    const { editor: ed, reports } = mount(false);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    expect(ed.commands.normalizeContentAttributes()).toBe(false);
    expect(ed.chain().normalizeContentAttributes().run()).toBe(false);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(reports).toEqual([]);
    ed.setEditable(true);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
  });

  it('never dispatches from a dry run', () => {
    const result = mount();
    expect(result.editor.can().chain().normalizeContentAttributes().run()).toBe(true);
    expect(result.transactions).toBe(0);
    expect(markers(result.editor)).toEqual(['bogus', 'decimal']);
  });

  it('leaves the shared transaction alone when a chained command dry-runs it', () => {
    const { editor: ed, reports } = mount();
    // ChainedCommands does not declare the runtime command() helper.
    const chain = ed.chain() as unknown as { command: (fn: (props: CommandProps) => boolean) => { run: () => boolean } };
    expect(chain.command(({ can }) => can().normalizeContentAttributes()).run()).toBe(true);
    expect(markers(ed)).toEqual(['bogus', 'decimal']);
    expect(reports).toEqual([]);
  });
});

describe('normalizeContentAttributes with heading levels', () => {
  function mountHeadings(levels?: number[], editable = true, content = '<h1>A</h1><h2>B</h2><h3>C</h3><p>tail</p>'): {
    editor: Editor; reports: ContentDiagnosticProps[];
  } {
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({
      extensions: [Document, Paragraph, Text, OrderedList, BulletList, History, levels ? Heading.configure({ levels }) : Heading],
      content,
      editable,
      onContentDiagnostic: props => reports.push(props),
    });
    return { editor, reports };
  }

  /** Stores levels the way a collaborator configured with more levels, or a bound document, does: without validation or history. */
  function store(ed: Editor, values: unknown[]): void {
    const tr = ed.state.tr.setMeta('addToHistory', false);
    let index = 0;
    ed.state.doc.forEach((node, pos) => {
      if (node.type.name === 'heading' && index < values.length) tr.setNodeAttribute(pos, 'level', values[index++]);
    });
    ed.view.dispatch(tr);
  }

  const levels = (ed: Editor): unknown[] => {
    const found: unknown[] = [];
    ed.state.doc.forEach(node => { if (node.type.name === 'heading') found.push(node.attrs['level']); });
    return found;
  };

  it('moves stored levels the configuration lacks to the nearest configured level in one reported, idempotent step', () => {
    const { editor: ed, reports } = mountHeadings();
    store(ed, [5, 'x', 99]);
    expect(ed.getHTML()).toBe('<h4>A</h4><h1>B</h1><h4>C</h4><p>tail</p>');
    expect(ed.can().normalizeContentAttributes()).toBe(true);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(levels(ed)).toEqual([4, 1, 4]);
    expect(ed.getHTML()).toBe('<h4>A</h4><h1>B</h1><h4>C</h4><p>tail</p>');
    expect(reports).toEqual([expect.objectContaining({
      source: 'normalizeContentAttributes',
      total: 3,
      diagnostics: [
        { code: 'unsupported-heading-level', nodeType: 'heading', attribute: 'level', path: [0], value: 5 },
        { code: 'unsupported-heading-level', nodeType: 'heading', attribute: 'level', path: [1], value: 'x' },
        { code: 'unsupported-heading-level', nodeType: 'heading', attribute: 'level', path: [2], value: 99 },
      ],
    })]);
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    expect(ed.commands.normalizeContentAttributes()).toBe(false);
    expect(reports).toHaveLength(1);
  });

  it('follows the configured levels and leaves configured ones alone', () => {
    const { editor: ed } = mountHeadings([2, 3]);
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    store(ed, [1, 4]);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(levels(ed)).toEqual([2, 3]);
  });

  it('migrates markers and levels in one transaction outside the undo history', () => {
    const { editor: ed, reports } = mountHeadings(undefined, true, '<h1>A</h1><ol><li><p>item</p></li></ol><p>tail</p>');
    inject(ed, [['orderedList', 'bogus']]);
    store(ed, [6]);
    typeAtEnd(ed, '!');
    let transactions = 0;
    ed.on('transaction', () => { transactions++; });
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(transactions).toBe(1);
    expect(reports.at(-1)?.diagnostics.map(({ code }) => code).sort()).toEqual(['unknown-list-marker', 'unsupported-heading-level']);
    expect(ed.commands.undo()).toBe(true);
    expect(levels(ed)[0]).toBe(4);
    expect(markers(ed)).toEqual([null]);
  });

  it('refuses in a read-only editor and leaves a dry run alone', () => {
    const readOnly = mountHeadings(undefined, false);
    store(readOnly.editor, [5]);
    expect(readOnly.editor.can().normalizeContentAttributes()).toBe(false);
    expect(readOnly.editor.commands.normalizeContentAttributes()).toBe(false);
    expect(levels(readOnly.editor)[0]).toBe(5);
    readOnly.editor.destroy();
    const { editor: ed, reports } = mountHeadings();
    store(ed, [5]);
    expect(ed.can().chain().normalizeContentAttributes().run()).toBe(true);
    expect(levels(ed)[0]).toBe(5);
    expect(reports).toEqual([]);
  });
});
