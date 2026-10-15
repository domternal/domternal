import { afterEach, describe, expect, it } from 'vitest';
import { BulletList, Document, Editor, Extension, History, ListLabels, OrderedList, Paragraph, Text, generateHTML, getNodeListLabel } from '@domternal/core';
import type { AnyExtension, JSONContent, ListLabel } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';
import { canMergeListWrappers, freshListMarkerAttributes } from './helpers/listMarkers.js';
import { moveBlock } from './helpers/moveBlock.js';
import { moveBlockAsNestedChild } from './helpers/moveBlockAsNestedChild.js';
import { deleteBlock } from './helpers/blockOperations.js';

const counter = (prefix: string): ListLabel => ({ kind: 'counter', format: 'decimal', prefix, suffix: ') ' });
const bullet = (text: string): ListLabel => ({ kind: 'text', text });
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const item = (text: string, nested?: JSONContent): JSONContent => ({ type: 'listItem', content: [paragraph(text), ...(nested ? [nested] : [])] });
const list = (label: ListLabel, values: string[], start = 1): JSONContent => ({
  type: label.kind === 'counter' ? 'orderedList' : 'bulletList', attrs: { listLabel: label, start }, content: values.map(value => item(value)),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const IDs = Extension.create({ name: 'labelTestIDs', addGlobalAttributes: () => [{ types: ['orderedList', 'bulletList'], attributes: { id: { default: null } } }] });
const extensions = (labels = true): AnyExtension[] => [Document, Text, Paragraph, OrderedList, BulletList, History, IDs, ...(labels ? [ListLabels] : []), SmartPaste];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
function create(content: JSONContent, labels = true): Editor {
  const editor = new Editor({ extensions: extensions(labels), content }); editors.push(editor); return editor;
}
function find(editor: Editor, type: string, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (found === -1 && node.type.name === type && node.textContent === text) found = pos; });
  if (found === -1) throw new Error('Missing authored node'); return found;
}
function select(editor: Editor, text: string, offset: number, end = offset): void {
  const base = find(editor, 'paragraph', text) + 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, base + offset, base + end)));
}
function paste(editor: Editor, content: JSONContent): void {
  const html = generateHTML(content, extensions());
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : 'Imported' } });
  editor.view.dom.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
}
function roots(editor: Editor): unknown[] {
  const result: unknown[] = []; editor.state.doc.forEach(node => result.push({ type: node.type.name, label: getNodeListLabel(node), text: node.textContent })); return result;
}
function history(editor: Editor, change: () => void): void {
  const before = editor.state.doc; const selection = editor.state.selection.toJSON(); change();
  const after = editor.state.doc; expect(after.eq(before)).toBe(false);
  expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.eq(before)).toBe(true); expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(editor.commands.redo()).toBe(true); expect(editor.state.doc.eq(after)).toBe(true);
}
const kinds = [{ label: counter('Section '), other: counter('Article '), type: 'orderedList' }, { label: bullet('✓'), other: bullet('→'), type: 'bulletList' }];

describe('SmartPaste optional list labels', () => {
  it.each(kinds.flatMap(kind => [0, 6, 11].map(offset => ({ ...kind, offset }))))('preserves distinct $type labels at offset $offset with exact history', ({ label, other, type, offset }) => {
    const editor = create(doc(list(label, ['BeforeAfter']))); select(editor, 'BeforeAfter', offset);
    history(editor, () => { paste(editor, doc(list(other, ['Imported']))); });
    expect(roots(editor)).toEqual([
      ...(offset === 0 ? [] : [{ type, label, text: 'BeforeAfter'.slice(0, offset) }]),
      { type, label: other, text: 'Imported' },
      ...(offset === 11 ? [] : [{ type, label, text: 'BeforeAfter'.slice(offset) }]),
    ]);
  });
  it.each(kinds)('merges matching $type labels while retaining the destination start', ({ label, type }) => {
    const editor = create(doc(list(label, ['Existing'], 4))); select(editor, 'Existing', 8);
    history(editor, () => { paste(editor, doc(list(label, ['Imported'], 7))); });
    expect(roots(editor)).toEqual([{ type, label, text: 'ExistingImported' }]);
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    if (type === 'orderedList') expect(editor.state.doc.firstChild?.attrs['start']).toBe(4);
  });
  it('preserves an omitted extension and never manufactures a label for a legacy schema', () => {
    const editor = create(doc(list(counter('Section '), ['Existing'])), false); select(editor, 'Existing', 8);
    paste(editor, doc(list(counter('Article '), ['Imported'])));
    expect(editor.state.doc.childCount).toBe(1); expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.attrs).not.toHaveProperty('listLabel');
    expect(editor.getHTML()).not.toContain('data-dm-list-label');
  });
});

describe('block operations with optional labels', () => {
  it.each(kinds)('keeps $type label in a fresh wrapper without source start or ID', ({ label }) => {
    const source = list(label, ['Source', 'Stay'], 7); source.attrs = { ...source.attrs, id: 'source' };
    const editor = create(doc(source, paragraph('End'))); select(editor, 'Source', 0);
    const wrapper = editor.state.doc.firstChild;
    if (!wrapper) throw new Error('Missing source');
    expect(freshListMarkerAttributes(wrapper)).toEqual({ listLabel: label });
    history(editor, () => { const tr = editor.state.tr; moveBlock(tr, find(editor, 'listItem', 'Source'), editor.state.doc.content.size); editor.view.dispatch(tr); });
    const moved = editor.state.doc.lastChild;
    if (!moved) throw new Error('Missing moved wrapper');
    expect(getNodeListLabel(moved)).toEqual(label); expect(moved.attrs['id']).toBeNull();
    if (moved.type.name === 'orderedList') expect(moved.attrs['start']).toBe(1);
  });
  it.each(kinds)('does not merge distinct $type labels at a deleted seam', ({ label, other, type }) => {
    const editor = create(doc(list(label, ['Before']), paragraph('Gap'), list(other, ['After']))); select(editor, 'Gap', 0);
    history(editor, () => { const tr = editor.state.tr; deleteBlock(tr, find(editor, 'paragraph', 'Gap')); editor.view.dispatch(tr); });
    expect(roots(editor)).toEqual([{ type, label, text: 'Before' }, { type, label: other, text: 'After' }]);
    const first = editor.state.doc.firstChild; const last = editor.state.doc.lastChild;
    if (!first || !last) throw new Error('Missing lists'); expect(canMergeListWrappers(first, last)).toBe(false);
  });
  it.each(kinds)('retains a nested $type label beside a differently labelled child', ({ label, other }) => {
    const parent = { type: 'bulletList', content: [item('Parent', list(other, ['Child']))] };
    const editor = create(doc(list(label, ['Source']), parent)); select(editor, 'Source', 0);
    history(editor, () => {
      const tr: Transaction = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, find(editor, 'listItem', 'Source'), find(editor, 'bulletList', 'ParentChild'), find(editor, 'listItem', 'ParentChild'))).toBe(true);
      editor.view.dispatch(tr);
    });
    const target = editor.state.doc.firstChild?.firstChild;
    expect(target?.childCount).toBe(3);
    expect(target?.child(1).attrs['listLabel']).toEqual(other); expect(target?.child(2).attrs['listLabel']).toEqual(label);
  });
  it('does not interpret an unrelated custom attribute with the same name', () => {
    const custom = OrderedList.extend({ addAttributes: () => ({ listLabel: { default: null } }) });
    const editor = new Editor({ extensions: [Document, Text, Paragraph, custom], content: doc(list(counter('Custom '), ['Kept'])) }); editors.push(editor);
    const wrapper = editor.state.doc.firstChild;
    if (!wrapper) throw new Error('Missing custom wrapper');
    expect(wrapper.attrs['listLabel']).toEqual(counter('Custom ')); expect(getNodeListLabel(wrapper)).toBeNull();
    expect(freshListMarkerAttributes(wrapper)).toBeNull();
  });
});
