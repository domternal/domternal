import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { createAccumulatingDispatch } from '../commandPropsBuilder.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { BaseKeymap } from '../extensions/BaseKeymap.js';
import { UniqueID } from '../extensions/UniqueID.js';
import { ListItem } from '../nodes/ListItem.js';
import { Bold } from '../marks/Bold.js';
import { liftCurrentListItem } from './liftCurrentListItem.js';
import { splitListForInsert } from './splitListForInsert.js';
import { History } from '../extensions/History.js';
import { listMarkerAttribute, parseListMarker } from './listMarker.js';
import { liftListItemWithMarker, sinkListItemWithMarker } from './listMarkerCommands.js';
import { inlineStyles } from './inlineStyles.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });
const make = (html: string): Editor => {
  editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList, History, BaseKeymap, Bold], content: html });
  editor.view.setProps({ handleScrollToSelection: () => true });
  return editor;
};
function select(ed: Editor, from: string, offset = 0, to?: string, toOffset = 0): void {
  const found = new Map<string, number>();
  ed.state.doc.descendants((node, pos) => { if (node.isText && node.text) found.set(node.text, pos); });
  const anchor = found.get(from); const head = to === undefined ? anchor : found.get(to);
  if (anchor === undefined || head === undefined) throw new Error('Missing authored selection');
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, anchor + offset, head + (to === undefined ? offset : toOffset))));
}
const item = (text: string): string => `<li><p>${text}</p></li>`;
const ol = (marker: string | null, content: string, start = 1): string => `<ol${marker === null ? '' : ` style="list-style-type: ${marker}"`}${start === 1 ? '' : ` start="${String(start)}"`}>${content}</ol>`;
function key(ed: Editor, name: string): boolean {
  const event = new KeyboardEvent('keydown', { key: name === 'Shift-Tab' ? 'Tab' : name, shiftKey: name === 'Shift-Tab', bubbles: true, cancelable: true });
  return ed.view.someProp('handleKeyDown', handler => handler(ed.view, event)) ?? false;
}
function compact(ed: Editor): unknown {
  return ed.state.doc.toJSON();
}
function runUtility(ed: Editor, utility: (state: EditorState, tr: Transaction) => boolean): boolean {
  const transaction = ed.state.tr;
  const result = utility(ed.state, transaction);
  if (result) {
    const shared = ed.state.tr;
    createAccumulatingDispatch(shared)(transaction);
    ed.view.dispatch(shared);
  }
  return result;
}

describe('persisted list marker', () => {
  it.each(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'])('roundtrips ordered %s', marker => {
    const ed = make(ol(marker, item('A')));
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe(marker);
    expect(ed.getHTML()).toContain(`list-style-type: ${marker}`);
    ed.commands.setContent(ed.getJSON());
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe(marker);
  });
  it.each(['disc', 'circle', 'square'])('roundtrips bullet %s', marker => {
    const ed = make(`<ul style="list-style-type: ${marker}">${item('A')}</ul>`);
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe(marker);
    expect(ed.getHTML()).toContain(`list-style-type: ${marker}`);
  });
  it.each([['1', 'decimal'], ['a', 'lower-alpha'], ['A', 'upper-alpha'], ['i', 'lower-roman'], ['I', 'upper-roman']])('parses ordered type %s', (type, marker) => {
    const ed = make(`<ol type="${type}">${item('A')}</ol>`);
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe(marker);
  });
  it.each(['list-style: upper-roman', 'list-style-type:upper-roman !important', 'list-style-type:var(--x)', 'list-style-type:upper\\2d roman', 'list-style-type:/*x*/upper-roman'])('refuses CSS expansion %s', style => {
    const el = document.createElement('ol'); el.setAttribute('style', style);
    expect(parseListMarker('orderedList', el)).toBeNull();
    el.setAttribute('type', 'a'); expect(parseListMarker('orderedList', el)).toBe('lower-alpha');
  });
  it('retains the last valid explicit declaration without interpreting a later invalid one', () => {
    const el = document.createElement('ol');
    el.setAttribute('style', 'LIST-STYLE-TYPE: upper-roman; list-style-type: LOWER-ALPHA; list-style-type: custom');
    expect(parseListMarker('orderedList', el)).toBe('lower-alpha');
  });
  it('keeps null distinct from explicit defaults and does not inherit a parent override', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol(null, item('B'))}</li>`));
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe('decimal');
    expect(ed.state.doc.firstChild?.firstChild?.lastChild?.attrs['listStyleType']).toBeNull();
    expect(ed.getHTML()).toContain('<ol><li><p>B');
  });
  it('prefers valid CSS over type and uses valid type after unsupported CSS', () => {
    const el = document.createElement('ol'); el.setAttribute('type', 'A');
    el.style.listStyleType = 'lower-roman';
    expect(parseListMarker('orderedList', el)).toBe('lower-roman');
    el.style.listStyleType = 'custom-counter';
    expect(parseListMarker('orderedList', el)).toBe('upper-alpha');
  });
  it.each(['circle', 'var(--marker)', 'inherit', 'url(https://example.invalid/x)', 'DECIMAL', '', 7, {}])('rejects malformed ordered JSON %j and never renders it', value => {
    const ed = make(ol(null, item('A')));
    const json = ed.getJSON();
    if (!json.content?.[0]?.attrs) throw new Error('Missing list');
    json.content[0].attrs['listStyleType'] = value;
    expect(() => ed.schema.nodeFromJSON(json)).toThrow('Invalid list marker');
    expect(listMarkerAttribute('orderedList').renderHTML?.({ listStyleType: value })).toEqual({});
  });
  it('inline export retains explicit marker and keeps old depth cycle for null', () => {
    const html = inlineStyles(ol('upper-alpha', `<li><p>A</p>${ol('decimal', item('B'))}${ol(null, item('C'))}</li>`));
    const doc = document.createElement('div'); doc.innerHTML = html;
    const lists = doc.querySelectorAll('ol');
    expect(Array.from(lists, node => node.style.listStyleType)).toEqual(['upper-alpha', 'decimal', 'lower-alpha']);
    expect(lists[1]?.getAttribute('style')?.match(/list-style-type/g)).toHaveLength(1);
  });
});

describe('marker-aware list transforms', () => {
  it('sinks into a fresh list with marker but without the source ordered start', () => {
    const ed = make(ol('upper-roman', item('A') + item('Bravo'), 7)); select(ed, 'Bravo', 2);
    const before = compact(ed); const selection = ed.state.selection.toJSON();
    const command = sinkListItemWithMarker(ed.schema.nodes['listItem']!);
    expect(command(ed.state)).toBe(true); expect(compact(ed)).toEqual(before);
    expect(command(ed.state, ed.view.dispatch)).toBe(true);
    const child = ed.state.doc.firstChild?.firstChild?.lastChild;
    expect(child?.attrs).toMatchObject({ start: 1, listStyleType: 'upper-roman' });
    expect(ed.state.selection.$from.parent.textContent).toBe('Bravo'); expect(ed.state.selection.$from.parentOffset).toBe(2);
    const after = compact(ed); const afterSelection = ed.state.selection.toJSON(); ed.state.doc.check();
    expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
    expect(ed.commands.redo()).toBe(true); expect(compact(ed)).toEqual(after); expect(ed.state.selection.toJSON()).toEqual(afterSelection);
  });
  it.each([['upper-roman', 3], ['decimal', 2], [null, 3]] as const)('sinks separately from incompatible nested marker %s', (nested, count) => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol(nested, item('B'), 7)}</li>${item('C')}`)); select(ed, 'C');
    expect(sinkListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    const parent = ed.state.doc.firstChild?.firstChild;
    expect(parent?.childCount).toBe(count);
    expect(parent?.lastChild?.attrs['listStyleType']).toBe('decimal');
    if (count === 2) expect(parent?.lastChild?.attrs['start']).toBe(7);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABC'); ed.state.doc.check();
  });
  it('lifts a conflicting same-item wrapper into its own group and preserves outer continuation', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('Bravo'), 7)}</li>${item('C')}`, 3)); select(ed, 'Bravo', 2);
    const before = compact(ed); const selection = ed.state.selection.toJSON();
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.doc.childCount).toBe(3);
    expect(Array.from({ length: 3 }, (_, index) => ed.state.doc.child(index).attrs)).toEqual([
      { start: 3, listStyleType: 'decimal' }, { start: 7, listStyleType: 'upper-roman' }, { start: 4, listStyleType: 'decimal' },
    ]);
    expect(ed.state.selection.$from.parent.textContent).toBe('Bravo'); expect(ed.state.selection.$from.parentOffset).toBe(2);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABravoC'); ed.state.doc.check();
    expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
  });
  it('lifts a backward range, keeping trailing inner items under its last item', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('B') + item('CC') + item('DDD') + item('E'), 7)}</li>${item('F')}`));
    select(ed, 'DDD', 2, 'CC', 1);
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.doc.childCount).toBe(3);
    expect(ed.state.doc.child(1).attrs).toMatchObject({ start: 8, listStyleType: 'upper-roman' });
    expect(ed.state.doc.child(1).lastChild?.lastChild?.attrs).toMatchObject({ start: 10, listStyleType: 'upper-roman' });
    expect(ed.getText().replaceAll('\n', '')).toBe('ABCCDDDEF');
    expect(ed.state.selection.$anchor.parent.textContent).toBe('DDD'); expect(ed.state.selection.$anchor.parentOffset).toBe(2);
    expect(ed.state.selection.$head.parent.textContent).toBe('CC'); expect(ed.state.selection.$head.parentOffset).toBe(1); ed.state.doc.check();
  });
  it('wraps without merging a neighboring explicit marker into a null marker', () => {
    const ed = make(ol('decimal', item('A')) + '<p>B</p>' + ol('upper-roman', item('C'))); select(ed, 'B');
    expect(ed.commands.toggleList('orderedList', 'listItem')).toBe(true);
    expect(ed.state.doc.childCount).toBe(3);
    expect(ed.state.doc.child(1).attrs['listStyleType']).toBeNull(); ed.state.doc.check();
  });
});


describe('marker editing through installed keymaps', () => {
  it('Tab and Shift-Tab preserve conflicting nested marker owners', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('B'))}</li>${item('C')}`)); select(ed, 'C');
    expect(key(ed, 'Tab')).toBe(true);
    expect(ed.state.doc.firstChild?.firstChild?.childCount).toBe(3);
    select(ed, 'B'); expect(key(ed, 'Shift-Tab')).toBe(true);
    expect(ed.state.doc.child(1).attrs['listStyleType']).toBe('upper-roman'); ed.state.doc.check();
  });
  it('empty Enter uses marker-preserving lift before PM nested split', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item(''))}</li>${item('C')}`));
    let pos = -1; ed.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && !node.content.size) pos = at + 1; });
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    expect(key(ed, 'Enter')).toBe(true);
    expect(ed.state.doc.childCount).toBe(3); expect(ed.state.doc.child(1).attrs['listStyleType']).toBe('upper-roman');
    expect(ed.state.doc.child(1).textContent).toBe(''); ed.state.doc.check();
  });
  it('Backspace deletes an empty separator without merging conflicting wrappers', () => {
    const ed = make(ol('decimal', item('A')) + '<p></p>' + ol('upper-roman', item('B')));
    const pos = ed.state.doc.child(0).nodeSize + 1;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    const original = compact(ed); const selection = ed.state.selection.toJSON();
    expect(key(ed, 'Backspace')).toBe(true); expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.selection.$from.parent.textContent).toBe('A');
    expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(original); expect(ed.state.selection.toJSON()).toEqual(selection);
  });
  it('Delete removes only an empty separator and consumes the next conflicting join', () => {
    const ed = make(ol('decimal', item('A')) + '<p></p>' + ol('upper-roman', item('B'))); select(ed, 'A', 1);
    expect(key(ed, 'Delete')).toBe(true); expect(ed.state.doc.childCount).toBe(2);
    const before = compact(ed); const selection = ed.state.selection.toJSON();
    expect(key(ed, 'Delete')).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
    expect(ed.commands.undo()).toBe(true); expect(ed.state.doc.childCount).toBe(3);
  });
  it('keeps legacy null lists joinable at a direct Delete boundary', () => {
    const ed = make(ol(null, item('A')) + ol(null, item('B'))); select(ed, 'A', 1);
    expect(key(ed, 'Delete')).toBe(true); expect(ed.state.doc.childCount).toBe(1);
    expect(ed.getText().replaceAll('\n', '')).toBe('AB');
  });
});

describe('marker transform boundaries', () => {
  it.each([[0, 0], [1, 1], [2, 2], [0, 1], [1, 2]] as const)('top-level unlisting [%i,%i] preserves untouched marker and ordinals', (first, last) => {
    const ed = make(ol('upper-alpha', item('A') + item('B') + item('C'), 7));
    const labels = ['A', 'B', 'C'] as const;
    select(ed, labels[first], 0, labels[last], 1);
    const before = compact(ed); const selection = ed.state.selection.toJSON();
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABC');
    if (first > 0) expect(ed.state.doc.firstChild?.attrs).toMatchObject({ start: 7, listStyleType: 'upper-alpha' });
    if (last < 2) expect(ed.state.doc.lastChild?.attrs).toMatchObject({ start: 8 + last, listStyleType: 'upper-alpha' });
    ed.state.doc.check(); expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
  });
  it('does not sink the first item or mutate a restrictive schema on refusal', () => {
    const ed = make(ol('decimal', item('A') + item('B'))); select(ed, 'A');
    const before = compact(ed); expect(sinkListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(false);
    expect(compact(ed)).toEqual(before); ed.destroy();
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, ListItem.extend({ content: 'paragraph' })], content: ol('decimal', item('A') + item('B')) });
    select(editor, 'B'); const restricted = compact(editor);
    expect(sinkListItemWithMarker(editor.schema.nodes['listItem']!)(editor.state, editor.view.dispatch)).toBe(false);
    expect(compact(editor)).toEqual(restricted); editor.state.doc.check();
  });
  it('keeps a backwards multi-item sink selection and all descendants', () => {
    const ed = make(ol('upper-roman', item('A') + item('BB') + `<li><p>CCC</p>${ol('decimal', item('D'))}</li>`));
    select(ed, 'CCC', 2, 'BB', 1);
    expect(sinkListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.selection.$anchor.parent.textContent).toBe('CCC'); expect(ed.state.selection.$anchor.parentOffset).toBe(2);
    expect(ed.state.selection.$head.parent.textContent).toBe('BB'); expect(ed.state.selection.$head.parentOffset).toBe(1);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABBCCCD'); ed.state.doc.check();
  });
  it('lifts an explicit ordered child out of a null bullet wrapper without changing kind', () => {
    const ed = make(`<ul><li><p>A</p>${ol('decimal', item('B'))}</li>${item('C')}</ul>`); select(ed, 'B');
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(Array.from({ length: ed.state.doc.childCount }, (_, i) => ed.state.doc.child(i).type.name)).toEqual(['bulletList', 'orderedList', 'bulletList']);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABC'); ed.state.doc.check();
  });
  it('refuses the optional tail join when a moved item already owns another marker', () => {
    const ed = make(ol(null, `<li><p>A</p>${ol(null, `<li><p>B</p>${ol('upper-roman', item('C'))}</li>${item('D')}`)}</li>`)); select(ed, 'B');
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    const moved = ed.state.doc.firstChild?.child(1); expect(moved?.childCount).toBe(3);
    expect(moved?.child(1).attrs['listStyleType']).toBe('upper-roman'); expect(moved?.child(2).attrs['listStyleType']).toBeNull();
    expect(ed.getText().replaceAll('\n', '')).toBe('ABCD'); ed.state.doc.check();
  });
  it('creates a fresh wrapper identity while keeping moved item identity', () => {
    let serial = 0;
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, UniqueID.configure({ generateID: () => `owned-${String(++serial)}` })], content: '<ol id="source-list" style="list-style-type: decimal"><li id="source-a"><p>A</p></li><li id="source-b"><p>B</p></li></ol>' });
    const ed = editor; select(ed, 'B'); const outerId: unknown = ed.state.doc.firstChild?.attrs['id']; const itemId: unknown = ed.state.doc.firstChild?.child(1).attrs['id'];
    expect(sinkListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    const child = ed.state.doc.firstChild?.firstChild?.lastChild;
    expect(child?.attrs['id']).not.toBe(outerId); expect(child?.attrs['id']).toBeTruthy(); expect(child?.firstChild?.attrs['id']).toBe(itemId);
    const ids: unknown[] = []; ed.state.doc.descendants(node => { if (node.attrs['id']) ids.push(node.attrs['id']); });
    expect(new Set(ids).size).toBe(ids.length);
  });
});


describe('marker command and selection contracts', () => {
  it('unlisting an explicit marker through toggleList retains the actual backwards selection', () => {
    const ed = make(ol('decimal', item('Alpha') + item('Bravo') + item('Charlie'))); select(ed, 'Bravo', 3, 'Alpha', 2);
    const before = compact(ed); const selection = ed.state.selection.toJSON();
    expect(ed.commands.toggleList('orderedList', 'listItem')).toBe(true);
    expect(ed.state.selection.$anchor.parent.textContent).toBe('Bravo'); expect(ed.state.selection.$anchor.parentOffset).toBe(3);
    expect(ed.state.selection.$head.parent.textContent).toBe('Alpha'); expect(ed.state.selection.$head.parentOffset).toBe(2);
    expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
  });
  it('rejects an invalid target marker without mutating a command transaction', () => {
    const ed = make('<p>A</p>'); const before = compact(ed);
    expect(ed.commands.toggleList('orderedList', 'listItem', { listStyleType: 'circle' })).toBe(false);
    expect(compact(ed)).toEqual(before);
  });
  it('converts kinds to null without leaking an incompatible source marker', () => {
    const ed = make(ol('upper-roman', item('A') + item('B'))); select(ed, 'B');
    expect(ed.commands.toggleList('bulletList', 'listItem')).toBe(true);
    expect(ed.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBeNull(); ed.state.doc.check();
  });
  it('wraps multiple ordinary blocks in separate items without absorbing explicit neighbors', () => {
    const ed = make(ol('upper-roman', item('A')) + '<p>BB</p><p>CCC</p>' + ol('decimal', item('D'))); select(ed, 'BB', 1, 'CCC', 2);
    expect(ed.commands.toggleList('orderedList', 'listItem', { listStyleType: 'lower-alpha' })).toBe(true);
    expect(ed.state.doc.childCount).toBe(3); expect(ed.state.doc.child(1).childCount).toBe(2);
    expect(ed.state.doc.child(1).attrs['listStyleType']).toBe('lower-alpha');
    expect(ed.state.selection.$anchor.parent.textContent).toBe('BB'); expect(ed.state.selection.$anchor.parentOffset).toBe(1);
    expect(ed.state.selection.$head.parent.textContent).toBe('CCC'); expect(ed.state.selection.$head.parentOffset).toBe(2); ed.state.doc.check();
  });
  it('wraps a children-zone paragraph separately from a different explicit child', () => {
    const ed = make(ol('upper-roman', `<li><p>A</p>${ol('decimal', item('B'))}<p>C</p></li>`)); select(ed, 'C');
    expect(ed.commands.toggleList('orderedList', 'listItem')).toBe(true);
    const parent = ed.state.doc.firstChild?.firstChild; expect(parent?.childCount).toBe(3);
    expect(parent?.child(1).attrs['listStyleType']).toBe('decimal'); expect(parent?.child(2).attrs['listStyleType']).toBeNull();
    expect(ed.state.doc.firstChild?.attrs['listStyleType']).toBe('upper-roman'); ed.state.doc.check();
  });
  it('lifts while preserving trailing parent blocks in document order', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('B') + item('C'), 7)}<p>D</p>${ol('lower-alpha', item('E'))}</li>${item('F')}`)); select(ed, 'B');
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.getText().replaceAll('\n', '')).toBe('ABCDEF');
    const moved = ed.state.doc.child(1).firstChild;
    expect(moved?.childCount).toBe(4);
    expect(moved?.child(1).textContent).toBe('C'); expect(moved?.child(1).attrs['start']).toBe(8);
    expect(moved?.child(2).textContent).toBe('D'); expect(moved?.child(3).attrs['listStyleType']).toBe('lower-alpha'); ed.state.doc.check();
  });
});


describe('input rule and safe failure regressions', () => {
  it.each(['orderedList', 'bulletList'] as const)('input rule does not absorb explicit neighboring %s markers', kind => {
    const marker = kind === 'orderedList' ? '1.' : '-';
    const html = kind === 'orderedList'
      ? ol('decimal', item('A')) + `<p>${marker}</p>` + ol('upper-roman', item('B'))
      : `<ul style="list-style-type:disc">${item('A')}</ul><p>${marker}</p><ul style="list-style-type:square">${item('B')}</ul>`;
    const ed = make(html); select(ed, marker, marker.length);
    const pos = ed.state.selection.from;
    expect(ed.view.someProp('handleTextInput', handler => handler(ed.view, pos, pos, ' ', () => ed.state.tr.insertText(' ')))).toBe(true);
    expect(ed.state.doc.childCount).toBe(3); expect(ed.state.doc.child(1).attrs['listStyleType']).toBeNull();
    expect(ed.state.doc.child(0).attrs['listStyleType']).not.toBeNull(); expect(ed.state.doc.child(2).attrs['listStyleType']).not.toBeNull(); ed.state.doc.check();
  });
  it('keeps stored marks through a marker-aware sink', () => {
    const ed = make(ol('decimal', item('A') + item('B'))); select(ed, 'B');
    ed.view.dispatch(ed.state.tr.setStoredMarks([]));
    expect(sinkListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.storedMarks).toEqual([]);
  });
  it('refuses malformed start arithmetic before a conflict lift', () => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('B'))}</li>`)); select(ed, 'B');
    const $pos = ed.state.selection.$from; const listPos = $pos.before($pos.depth - 2); const list = ed.state.doc.nodeAt(listPos);
    if (!list) throw new Error('Missing source wrapper');
    ed.view.dispatch(ed.state.tr.setNodeMarkup(listPos, undefined, { ...list.attrs, start: Number.MAX_SAFE_INTEGER + 1 }));
    const before = compact(ed);
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(false); expect(compact(ed)).toEqual(before);
    expect(key(ed, 'Shift-Tab')).toBe(true); expect(compact(ed)).toEqual(before);
  });
});


describe('explicit list lift typing marks', () => {
  const cases = ['bold', 'empty'] as const;
  const positions = ['A', 'B', 'C'] as const;
  it.each(cases.flatMap(marks => positions.map(text => ({ marks, text }))))('retains $marks at top-level $text including after a tail adjustment', ({ marks, text }) => {
    const ed = make(ol('decimal', item('A') + item('B') + item('C'), 7)); select(ed, text);
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setStoredMarks(expected));
    expect(liftListItemWithMarker(ed.schema.nodes['listItem']!)(ed.state, ed.view.dispatch)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected);
    ed.view.dispatch(ed.state.tr.insertText('X'));
    let actual: readonly string[] | undefined;
    ed.state.doc.descendants(node => { if (node.isText && node.text?.startsWith('X')) actual = node.marks.map(mark => mark.type.name); });
    expect(actual).toEqual(marks === 'bold' ? ['bold'] : []); ed.state.doc.check();
  });
  it.each(cases.flatMap(marks => positions.map(text => ({ marks, text }))))('propagates $marks through liftCurrentListItem at $text', ({ marks, text }) => {
    const ed = make(ol('decimal', item('A') + item('B') + item('C'))); select(ed, text);
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setStoredMarks(expected));
    expect(runUtility(ed, liftCurrentListItem)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); ed.state.doc.check();
  });
  it.each(cases.flatMap(marks => [0, 1, 2].map(index => ({ marks, index }))))('propagates $marks through splitListForInsert at item $index', ({ marks, index }) => {
    const ed = make(ol('decimal', positions.map((text, at) => item(at === index ? '' : text)).join('')));
    let caret = -1; ed.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && !node.content.size) caret = pos + 1; });
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, caret)).setStoredMarks(expected));
    expect(runUtility(ed, (state, tr) => splitListForInsert(state, tr) !== null)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); expect(ed.state.selection.$from.depth).toBe(1); ed.state.doc.check();
  });
  it.each(cases)('propagates %s through accumulated public toggleList dispatch', marks => {
    const ed = make(ol('decimal', item('A') + item('B') + item('C'))); select(ed, 'B');
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setStoredMarks(expected));
    expect(ed.chain().toggleList('orderedList', 'listItem').run()).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); ed.state.doc.check();
  });
});


describe('typing marks through nested utility paths', () => {
  it.each(['bold', 'empty'] as const)('preserves %s in the direct nested lift branch', marks => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol('upper-roman', item('B'))}</li>`)); select(ed, 'B');
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setStoredMarks(expected));
    expect(runUtility(ed, liftCurrentListItem)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); ed.state.doc.check();
  });
  it.each(['bold', 'empty'] as const)('preserves %s through repeated empty utility lifts with a final null wrapper', marks => {
    const ed = make(ol('decimal', `<li><p>A</p>${ol(null, item(''))}</li>`));
    let caret = -1; ed.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && !node.content.size) caret = pos + 1; });
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, caret)).setStoredMarks(expected));
    expect(runUtility(ed, (state, tr) => splitListForInsert(state, tr) !== null)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); expect(ed.state.selection.$from.depth).toBe(1); ed.state.doc.check();
  });
  it.each(['bold', 'empty'] as const)('preserves %s while the insertion utility splits a nonempty explicit list', marks => {
    const ed = make(ol('decimal', item('A') + item('B') + item('C'))); select(ed, 'B');
    const expected = marks === 'bold' ? [ed.schema.marks['bold']!.create()] : [];
    ed.view.dispatch(ed.state.tr.setStoredMarks(expected));
    expect(runUtility(ed, (state, tr) => splitListForInsert(state, tr) !== null)).toBe(true);
    expect(ed.state.storedMarks).toEqual(expected); ed.state.doc.check();
  });
});


it('keeps backward anchor/head through the public marker-aware toggle chain', () => {
  const ed = make(ol('decimal', item('Alpha') + item('Bravo') + item('Charlie'))); select(ed, 'Bravo', 3, 'Alpha', 2);
  const before = compact(ed); const selection = ed.state.selection.toJSON();
  expect(ed.chain().toggleList('orderedList', 'listItem').run()).toBe(true);
  expect(ed.state.selection.$anchor.parent.textContent).toBe('Bravo'); expect(ed.state.selection.$anchor.parentOffset).toBe(3);
  expect(ed.state.selection.$head.parent.textContent).toBe('Alpha'); expect(ed.state.selection.$head.parentOffset).toBe(2);
  expect(ed.commands.undo()).toBe(true); expect(compact(ed)).toEqual(before); expect(ed.state.selection.toJSON()).toEqual(selection);
});
