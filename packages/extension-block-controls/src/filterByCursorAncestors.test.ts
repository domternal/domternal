import { afterEach, describe, expect, it } from 'vitest';
import {
  Blockquote,
  BulletList,
  Document,
  Editor,
  Node,
  OrderedList,
  Paragraph,
  TaskList,
  Text,
} from '@domternal/core';
import type { FloatingMenuItem, JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { filterByCursorAncestors } from './SlashCommand.js';

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  renderHTML: () => ['aside', 0],
});

const CustomList = Node.create({
  name: 'customList',
  group: 'block',
  content: 'listItem+',
  renderHTML: () => ['section', 0],
});

const extensions = [Document, Text, Paragraph, Blockquote, BulletList, OrderedList, TaskList, Callout, CustomList];
let editor: Editor | undefined;

afterEach(() => { editor?.destroy(); });

function block(type: string, ...content: JSONContent[]): JSONContent {
  return { type, content };
}

function paragraph(text = 'cursor'): JSONContent {
  return block('paragraph', { type: 'text', text });
}

function moveToText(ed: Editor, text: string): void {
  let position: number | undefined;
  ed.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos;
  });
  if (position === undefined) throw new Error(`Missing cursor text: ${text}`);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, position)));
}

function mount(...content: JSONContent[]): Editor {
  editor = new Editor({ extensions, content: block('doc', ...content) });
  moveToText(editor, 'cursor');
  return editor;
}

function item(name: string, hideWhenInside?: string[]): FloatingMenuItem {
  return { name, label: name, command: 'insertText', ...(hideWhenInside && { hideWhenInside }) };
}

const listCases = [
  ['bulletList', 'listItem'],
  ['orderedList', 'listItem'],
  ['taskList', 'taskItem'],
  ['customList', 'listItem'],
] as const;

describe('filterByCursorAncestors', () => {
  it('hides items for any matching non-list ancestor', () => {
    const ed = mount(block('callout', block('blockquote', paragraph())));
    const items = [item('callout', ['callout']), item('quote', ['blockquote']), item('text', ['paragraph'])];
    expect(filterByCursorAncestors(items, ed)).toEqual([]);
  });

  it('keeps items with absent, empty, or unmatched exclusions', () => {
    const ed = mount(block('callout', paragraph()));
    const items = [item('none'), item('empty', []), item('unmatched', ['missing'])];
    expect(filterByCursorAncestors(items, ed)).toEqual(items);
  });

  it('matches the document ancestor and any entry in the exclusion list', () => {
    const ed = mount(paragraph());
    const items = [item('document', ['doc']), item('text', ['missing', 'paragraph'])];
    expect(filterByCursorAncestors(items, ed)).toEqual([]);
  });

  it('uses the current selection after moving outside an excluded container', () => {
    const ed = mount(block('callout', paragraph()), paragraph('outside'));
    const items = [item('callout', ['callout'])];
    expect(filterByCursorAncestors(items, ed)).toEqual([]);
    moveToText(ed, 'outside');
    expect(filterByCursorAncestors(items, ed)).toEqual(items);
  });

  it.each(listCases)('keeps %s label filtering', (listType, itemType) => {
    const ed = mount(block(listType, block(itemType, paragraph())));
    const matching = item('matching', [listType]);
    const other = item('other', ['missingList']);
    expect(filterByCursorAncestors([matching, other], ed)).toEqual([other]);
  });

  it.each(listCases)('keeps %s available in child paragraphs for nesting', (listType, itemType) => {
    const ed = mount(block(listType, block(itemType, paragraph('label'), paragraph())));
    const items = [item('matching', [listType])];
    expect(filterByCursorAncestors(items, ed)).toEqual(items);
  });

  it('does not apply an outer list exclusion inside a different nearest list', () => {
    const ed = mount(block('bulletList', block('listItem',
      paragraph('outer'),
      block('orderedList', block('listItem', paragraph())),
    )));
    const outer = item('outer', ['bulletList']);
    const nearest = item('nearest', ['orderedList']);
    expect(filterByCursorAncestors([outer, nearest], ed)).toEqual([outer]);
  });

  it('keeps an outer custom list available inside a nested list', () => {
    const ed = mount(block('customList', block('listItem',
      paragraph('outer'),
      block('bulletList', block('listItem', paragraph())),
    )));
    const items = [item('custom', ['customList'])];
    expect(filterByCursorAncestors(items, ed)).toEqual(items);
  });

  it('keeps same-type nested lists available in their child paragraphs', () => {
    const ed = mount(block('bulletList', block('listItem',
      paragraph('outer'),
      block('bulletList', block('listItem', paragraph('nested'), paragraph())),
    )));
    const items = [item('bullet', ['bulletList'])];
    expect(filterByCursorAncestors(items, ed)).toEqual(items);
  });

  it('applies a custom ancestor exclusion without disabling list nesting', () => {
    const ed = mount(block('callout', block('bulletList', block('listItem',
      paragraph('label'), paragraph(),
    ))));
    const custom = item('custom', ['callout', 'bulletList']);
    const list = item('list', ['bulletList']);
    expect(filterByCursorAncestors([custom, list], ed)).toEqual([list]);
  });
});
