import { afterEach, describe, expect, it } from 'vitest';
import {
  BulletList, Document, Editor, Extension, History, ListItem, OrderedList, Paragraph,
  TaskItem, TaskList, Text,
} from '@domternal/core';
import { Schema } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { canMergeListWrappers, freshListMarkerAttributes, readListMarker } from './listMarkers.js';
import { moveBlock } from './moveBlock.js';
import { moveBlockAsNestedChild } from './moveBlockAsNestedChild.js';
import { deleteBlock } from './blockOperations.js';
import { rejoinAtSeam } from './rejoinAtSeam.js';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { content: 'inline*', group: 'block' },
  listItem: { content: 'paragraph block*' },
  orderedList: { content: 'listItem+', group: 'block', attrs: { listStyleType: { default: null }, start: { default: 1 }, id: { default: null } } },
  bulletList: { content: 'listItem+', group: 'block', attrs: { listStyleType: { default: null } } },
  taskList: { content: 'listItem+', group: 'block', attrs: { listStyleType: { default: null } } },
  customList: { content: 'listItem+', group: 'block', attrs: { listStyleType: { default: null } } },
} });
function wrapper(kind: string, marker: unknown): PMNode {
  return schema.node(kind, { listStyleType: marker, start: 7, id: 'source' }, [schema.node('listItem', null, [schema.node('paragraph')])]);
}

describe('private list marker policy', () => {
  it.each(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'])('retains ordered %s only on fresh wrappers', marker => {
    const node = wrapper('orderedList', marker);
    expect(readListMarker(node)).toBe(marker);
    expect(freshListMarkerAttributes(node)).toEqual({ listStyleType: marker });
    const fresh = node.type.create(freshListMarkerAttributes(node), node.content);
    expect(fresh.attrs).toEqual({ listStyleType: marker, start: 1, id: null });
  });
  it.each(['disc', 'circle', 'square'])('retains bullet %s', marker => {
    expect(readListMarker(wrapper('bulletList', marker))).toBe(marker);
  });
  it.each([
    ['orderedList', 'square'], ['bulletList', 'upper-roman'], ['orderedList', 'DECIMAL'],
    ['orderedList', 'decimal; color:red'], ['orderedList', 'inherit'], ['orderedList', 1],
    ['orderedList', undefined], ['orderedList', null], ['taskList', 'disc'], ['customList', 'decimal'],
  ])('does not propagate unsupported marker %s / %s', (kind, marker) => {
    const node = wrapper(kind, marker);
    expect(readListMarker(node)).toBeNull();
    expect(freshListMarkerAttributes(node)).toBeNull();
  });
  it('does not conflate implicit and explicit default markers or list kinds', () => {
    expect(canMergeListWrappers(wrapper('orderedList', null), wrapper('orderedList', 'decimal'))).toBe(false);
    expect(canMergeListWrappers(wrapper('bulletList', null), wrapper('bulletList', 'disc'))).toBe(false);
    expect(canMergeListWrappers(wrapper('orderedList', null), wrapper('bulletList', null))).toBe(false);
    expect(canMergeListWrappers(wrapper('orderedList', 'decimal'), wrapper('orderedList', 'decimal'))).toBe(true);
    expect(canMergeListWrappers(wrapper('customList', 'decimal'), wrapper('customList', null))).toBe(true);
  });
  it('retains legacy custom schemas without a marker attribute', () => {
    const legacy = new Schema({ nodes: {
      doc: { content: 'orderedList+' }, text: {}, paragraph: { content: 'text*' }, listItem: { content: 'paragraph' }, orderedList: { content: 'listItem+' },
    } });
    const left = legacy.node('orderedList', null, [legacy.node('listItem', null, [legacy.node('paragraph')])]);
    expect(readListMarker(left)).toBeNull();
    expect(freshListMarkerAttributes(left)).toBeNull();
    expect(canMergeListWrappers(left, left.copy(left.content))).toBe(true);
  });
});

const ids = Extension.create({
  name: 'testListIDs',
  addGlobalAttributes() {
    return [{ types: ['orderedList', 'bulletList'], attributes: { id: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('id'),
      renderHTML: (attributes: Record<string, unknown>) => typeof attributes['id'] === 'string' ? { id: attributes['id'] } : {},
    } } }];
  },
});
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });
function mount(html: string): Editor {
  const editor = new Editor({ extensions: [Document, Text, Paragraph, OrderedList, BulletList, ListItem, TaskList, TaskItem, History, ids], content: html });
  editors.push(editor);
  return editor;
}
function list(tag: string, marker: string | null, content: string, extra = ''): string {
  return `<${tag}${marker === null ? '' : ` style="list-style-type:${marker}"`}${extra}>${content}</${tag}>`;
}
function item(text: string): string { return `<li><p>${text}</p></li>`; }
function find(editor: Editor, type: string, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.name === type && node.textContent === text) found = pos;
  });
  if (found === undefined) throw new Error('Missing authored node');
  return found;
}
function roots(editor: Editor): unknown[] {
  const result: unknown[] = [];
  editor.state.doc.forEach(node => result.push({ type: node.type.name, marker: node.attrs['listStyleType'], text: node.textContent }));
  return result;
}
function applyWithHistory(editor: Editor, text: string, change: (tr: Transaction) => void): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, find(editor, 'paragraph', text) + 1)));
  const before = editor.state.doc;
  const beforeSelection = editor.state.selection.toJSON();
  const tr = editor.state.tr;
  change(tr);
  expect(tr.docChanged).toBe(true);
  editor.view.dispatch(tr);
  const after = editor.state.doc;
  const afterSelection = editor.state.selection.toJSON();
  expect(() => { after.check(); }).not.toThrow();
  expect(undoDepth(editor.state)).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.eq(before)).toBe(true);
  expect(editor.state.selection.toJSON()).toEqual(beforeSelection);
  expect(redoDepth(editor.state)).toBe(1);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.doc.eq(after)).toBe(true);
  expect(editor.state.selection.toJSON()).toEqual(afterSelection);
}

const kinds = [
  { tag: 'ol', type: 'orderedList', marker: 'upper-roman', other: 'decimal' },
  { tag: 'ul', type: 'bulletList', marker: 'square', other: 'disc' },
];
describe('list marker preservation through block operations', () => {
  it.each(kinds)('moves a $tag item into a fresh top-level wrapper without source identity or start', ({ tag, type, marker }) => {
    const editor = mount(list(tag, marker, item('Source') + item('Stay'), ' id="source" start="7"') + '<p>End</p>');
    const source = find(editor, 'listItem', 'Source');
    const target = editor.state.doc.content.size;
    applyWithHistory(editor, 'Source', tr => { moveBlock(tr, source, target); });
    expect(roots(editor)).toEqual([
      { type, marker, text: 'Stay' }, { type: 'paragraph', marker: undefined, text: 'End' }, { type, marker, text: 'Source' },
    ]);
    expect(editor.state.doc.child(0).attrs['id']).toBe('source');
    expect(editor.state.doc.child(2).attrs['id']).toBeNull();
    expect(editor.state.doc.child(2).attrs['start']).toBe(tag === 'ol' ? 1 : undefined);
  });

  it.each(kinds)('splits a conflicting same-kind $tag target around the moved item', ({ tag, type, marker, other }) => {
    const editor = mount(list(tag, marker, item('Source')) + '<p>Gap</p>' + list(tag, other, item('Before') + item('After')));
    const source = find(editor, 'listItem', 'Source');
    const target = find(editor, 'listItem', 'After');
    applyWithHistory(editor, 'Source', tr => { moveBlock(tr, source, target); });
    expect(roots(editor)).toEqual([
      { type: 'paragraph', marker: undefined, text: 'Gap' }, { type, marker: other, text: 'Before' },
      { type, marker, text: 'Source' }, { type, marker: other, text: 'After' },
    ]);
  });

  it.each(kinds)('still inserts a compatible $tag item directly into its target', ({ tag, type, marker }) => {
    const editor = mount(list(tag, marker, item('Source')) + '<p>Gap</p>' + list(tag, marker, item('Before') + item('After')));
    const source = find(editor, 'listItem', 'Source');
    const target = find(editor, 'listItem', 'After');
    applyWithHistory(editor, 'Source', tr => { moveBlock(tr, source, target); });
    expect(roots(editor)).toEqual([
      { type: 'paragraph', marker: undefined, text: 'Gap' }, { type, marker, text: 'BeforeSourceAfter' },
    ]);
    expect(editor.state.doc.child(1).childCount).toBe(3);
  });

  it.each(kinds.flatMap(kind => [null, kind.other].map(neighbor => ({ ...kind, neighbor }))))(
    'does not coalesce $tag source/destination seams with marker $neighbor', ({ tag, type, marker, neighbor }) => {
      const editor = mount(list(tag, marker, item('First')) + '<p>Gap</p>' + list(tag, neighbor, item('Last')));
      const source = find(editor, 'paragraph', 'Gap');
      const target = editor.state.doc.content.size;
      applyWithHistory(editor, 'Gap', tr => { moveBlock(tr, source, target); });
      expect(roots(editor)).toEqual([
        { type, marker, text: 'First' }, { type, marker: neighbor, text: 'Last' }, { type: 'paragraph', marker: undefined, text: 'Gap' },
      ]);
    },
  );

  it.each(kinds.flatMap(kind => [false, true].map(compatible => ({ ...kind, compatible }))))(
    'deletes a separator between $tag lists with compatible=$compatible', ({ tag, type, marker, other, compatible }) => {
      const second = compatible ? marker : other;
      const editor = mount(list(tag, marker, item('First')) + '<p>Gap</p>' + list(tag, second, item('Last')));
      const source = find(editor, 'paragraph', 'Gap');
      applyWithHistory(editor, 'Gap', tr => { deleteBlock(tr, source); });
      expect(roots(editor)).toEqual(compatible
        ? [{ type, marker, text: 'FirstLast' }]
        : [{ type, marker, text: 'First' }, { type, marker: second, text: 'Last' }]);
    },
  );

  it.each(kinds.flatMap(kind => [false, true].map(compatible => ({ ...kind, compatible }))))(
    'retains whole $tag wrapper attributes and destination boundaries with compatible=$compatible', ({ tag, type, marker, other, compatible }) => {
      const targetMarker = compatible ? marker : other;
      const editor = mount(list(tag, marker, item('Source'), ' id="source" start="7"') + '<p>Gap</p>' + list(tag, targetMarker, item('Target'), ' id="target" start="3"'));
      const target = editor.state.doc.content.size;
      applyWithHistory(editor, 'Source', tr => { moveBlock(tr, 0, target); });
      expect(roots(editor)).toEqual(compatible
        ? [{ type: 'paragraph', marker: undefined, text: 'Gap' }, { type, marker, text: 'TargetSource' }]
        : [{ type: 'paragraph', marker: undefined, text: 'Gap' }, { type, marker: targetMarker, text: 'Target' }, { type, marker, text: 'Source' }]);
      if (compatible) {
        expect(editor.state.doc.child(1).attrs['id']).toBe('target');
        expect(editor.state.doc.child(1).attrs['start']).toBe(tag === 'ol' ? 3 : undefined);
      } else {
        expect(editor.state.doc.child(2).attrs['id']).toBe('source');
        expect(editor.state.doc.child(2).attrs['start']).toBe(tag === 'ol' ? 7 : undefined);
      }
    },
  );

  it.each(kinds.flatMap(kind => [false, true].map(compatible => ({ ...kind, compatible }))))(
    'nests a $tag item beside a child list with compatible=$compatible', ({ tag, marker, other, compatible }) => {
      const childMarker = compatible ? marker : other;
      const editor = mount(list(tag, marker, item('Source'), ' id="source" start="7"') + list('ul', 'circle', `<li><p>Parent</p>${list(tag, childMarker, item('Child'))}</li>`));
      const source = find(editor, 'listItem', 'Source');
      const target = find(editor, 'listItem', 'ParentChild');
      const parentWrapper = find(editor, 'bulletList', 'ParentChild');
      applyWithHistory(editor, 'Source', tr => { expect(moveBlockAsNestedChild(tr, source, parentWrapper, target)).toBe(true); });
      const parent = editor.state.doc.firstChild?.firstChild;
      expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBe('circle');
      expect(parent?.childCount).toBe(compatible ? 2 : 3);
      expect(parent?.child(1).attrs['listStyleType']).toBe(childMarker);
      expect(parent?.child(1).textContent).toBe(compatible ? 'ChildSource' : 'Child');
      if (!compatible) {
        expect(parent?.child(2).attrs['listStyleType']).toBe(marker);
        expect(parent?.child(2).attrs['id']).toBeNull();
        expect(parent?.child(2).attrs['start']).toBe(tag === 'ol' ? 1 : undefined);
      }
    },
  );

  it('keeps a moved checked task in its own marker-free wrapper', () => {
    const editor = mount('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Source</p></li></ul>' + list('ul', 'square', item('Parent')));
    const source = find(editor, 'taskItem', 'Source');
    const target = find(editor, 'listItem', 'Parent');
    const parentWrapper = find(editor, 'bulletList', 'Parent');
    applyWithHistory(editor, 'Source', tr => { expect(moveBlockAsNestedChild(tr, source, parentWrapper, target)).toBe(true); });
    const nested = editor.state.doc.firstChild?.firstChild?.child(1);
    expect(nested?.type.name).toBe('taskList');
    expect(nested?.attrs['listStyleType']).toBeUndefined();
    expect(nested?.firstChild?.attrs['checked']).toBe(true);
    expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBe('square');
  });

  it('does not join different node types even when both normalize to null', () => {
    const editor = mount(list('ol', null, item('First')) + list('ul', null, item('Last')));
    const tr = editor.state.tr;
    rejoinAtSeam(tr, editor.state.doc.child(0).nodeSize);
    expect(tr.steps).toHaveLength(0);
  });
});
