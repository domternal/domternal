import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { Editor } from '../Editor.js';
import { Node } from '../Node.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { History } from './History.js';
import { ListLabels } from './ListLabels.js';
import { generateHTML, generateJSON } from '../helpers/ssr.js';
import { registerClipboardCopyAnnotation } from '../helpers/clipboardCopyAnnotation.js';
import { annotateCompoundListLabels, COMPOUND_MARKER_ATTRIBUTE } from '../utils/compoundListLabels.js';
import { getListLabelStyleSheet } from '../utils/listLabelStyles.js';
import type { AnyExtension, JSONContent } from '../types/index.js';

const compound = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ') '], fallback: 'decimal' };
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const childList = (start = 0): JSONContent => ({ type: 'orderedList', attrs: { start, listLabel: compound }, content: [item(p('Nested one')), item(p('Nested two'))] });
const source = (): JSONContent => ({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 27, listStyleType: 'lower-alpha' }, content: [item(p('Parent'), childList()), item(p('Next'), childList(4))] }] });
const Table = Node.create({ name: 'table', group: 'block', content: 'tableRow+', parseHTML: () => [{ tag: 'table' }], renderHTML: () => ['table', ['tbody', 0]] });
const TableRow = Node.create({ name: 'tableRow', content: 'tableCell+', parseHTML: () => [{ tag: 'tr' }], renderHTML: () => ['tr', 0] });
const TableCell = Node.create({ name: 'tableCell', content: 'block+', parseHTML: () => [{ tag: 'td' }], renderHTML: () => ['td', 0] });
const extensions = (injectCSS = true): AnyExtension[] => [Document, Paragraph, Text, OrderedList, BulletList, Blockquote, History, Table, TableRow, TableCell, ListLabels.configure({ injectCSS })];
const editors: Editor[] = [];
function create(content = source(), injectCSS = true): Editor {
  const editor = new Editor({ content, extensions: extensions(injectCSS) }); editors.push(editor); return editor;
}
function markers(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(`[${COMPOUND_MARKER_ATTRIBUTE}]`)).map(node => node.getAttribute(COMPOUND_MARKER_ATTRIBUTE) ?? '');
}
function htmlRoot(html: string): HTMLElement { const root = document.createElement('div'); root.innerHTML = html; return root; }
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

describe('compound list presentation', () => {
  it('matches live DOM, browser HTML, server HTML and native clipboard without stored derived attributes', () => {
    const editor = create(); const before = editor.getJSON(); const expected = ['aa.0) ', 'aa.1) ', 'ab.4) ', 'ab.5) '];
    expect(markers(editor.view.dom)).toEqual(expected);
    expect(markers(htmlRoot(editor.getHTML()))).toEqual(expected);
    expect(markers(htmlRoot(generateHTML(before, extensions())))).toEqual(expected);
    const server = parseHTML('<!doctype html><html><body></body></html>').document;
    expect(markers(htmlRoot(generateHTML(before, extensions(), { document: server })))).toEqual(expected);
    editor.commands.selectAll(); const copy = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(markers(copy.dom)).toEqual(expected);
    expect(JSON.stringify(editor.getJSON())).not.toContain(COMPOUND_MARKER_ATTRIBUTE);
    expect(editor.getJSON()).toEqual(before);
    expect(generateJSON(editor.getHTML(), extensions())).toEqual(before);
  });

  it('updates parents, starts and styles immediately, including undo and redo', () => {
    const editor = create(); const list = editor.state.doc.firstChild;
    if (list === null) throw new Error('Missing list');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...list.attrs, start: 0, listStyleType: 'upper-roman' }));
    expect(markers(editor.view.dom)).toEqual(['0.0) ', '0.1) ', 'I.4) ', 'I.5) ']);
    expect(markers(htmlRoot(editor.getHTML()))).toEqual(markers(editor.view.dom));
    expect(editor.commands.undo()).toBe(true);
    expect(markers(editor.view.dom)).toEqual(['aa.0) ', 'aa.1) ', 'ab.4) ', 'ab.5) ']);
    expect(editor.commands.redo()).toBe(true); expect(markers(editor.view.dom)[0]).toBe('0.0) ');
  });

  it('follows inserted parent items and resets each nested list independently', () => {
    const editor = create(); const node = editor.schema.nodeFromJSON(item(p('Inserted')));
    editor.view.dispatch(editor.state.tr.insert(1, node));
    expect(markers(editor.view.dom)).toEqual(['ab.0) ', 'ab.1) ', 'ac.4) ', 'ac.5) ']);
    expect(editor.commands.undo()).toBe(true); expect(markers(editor.view.dom)[0]).toBe('aa.0) ');
  });

  it('uses actual list ancestry through intermediate blocks and falls back for unordered or missing parents', () => {
    const editor = create({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 9 }, content: [item(p('Outer'), { type: 'blockquote', content: [childList()] })] },
      childList(), { type: 'bulletList', content: [item(p('Bullet'), childList())] }] });
    expect(markers(editor.view.dom)).toEqual(['9.0) ', '9.1) ']);
    expect(markers(htmlRoot(editor.getHTML()))).toEqual(markers(editor.view.dom));
    expect(editor.getText()).toContain('Nested two');
  });

  it('derives markers even when companion CSS is supplied by the host', () => {
    const editor = create(source(), false);
    expect(markers(editor.view.dom)[0]).toBe('aa.0) ');
    expect(document.querySelector('style[data-domternal-list-labels]')).toBeNull();
    expect(getListLabelStyleSheet(editor.getJSON())).toContain('content: attr(data-dm-compound-marker)');
  });

  it('retains structural ancestors across a cell while restarting the native marker format cycle', () => {
    const deep = { ...compound, parts: [{ ancestor: 2, format: 'inherit' }, '.', ...compound.parts] };
    const inner: JSONContent = { type: 'orderedList', attrs: { start: 7 }, content: [item(p('Cell parent'), { ...childList(), attrs: { start: 0, listLabel: deep } })] };
    const editor = create({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 4 }, content: [item(p('Outer'),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [inner] }] }] })] }] });
    expect(markers(editor.view.dom)).toEqual(['4.7.0) ', '4.7.1) ']);
    expect(markers(htmlRoot(editor.getHTML()))).toEqual(markers(editor.view.dom));
  });

  it('inherits the explicit format of an ancestor compound counter instead of its missing-context fallback', () => {
    const parentLabel = { ...compound, parts: [{ ancestor: 0, format: 'upper-roman' }, ') '] };
    const editor = create({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 4, listLabel: parentLabel }, content: [item(p('Outer'), childList())] }] });
    expect(markers(editor.view.dom)).toEqual(['IV) ', 'IV.0) ', 'IV.1) ']);
    expect(markers(htmlRoot(editor.getHTML()))).toEqual(markers(editor.view.dom));
  });

  it('coexists with the existing clipboard annotator and recomputes spoofed marker text', () => {
    const editor = create();
    const unregister = registerClipboardCopyAnnotation(editor.view, fragment => {
      for (const node of Array.from(fragment.querySelectorAll('li'))) node.setAttribute(COMPOUND_MARKER_ATTRIBUTE, 'spoofed');
    });
    editor.commands.selectAll(); const copy = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(markers(copy.dom)).toEqual(['aa.0) ', 'aa.1) ', 'ab.4) ', 'ab.5) ']);
    unregister();
    const root = htmlRoot('<ul><li data-dm-compound-marker="fake">Plain</li></ul>');
    annotateCompoundListLabels(root); expect(markers(root)).toEqual([]);
  });

  it('escapes derived text as an attribute without introducing source content', () => {
    const label = { ...compound, parts: ['<" &amp; ', { ancestor: 0, format: 'decimal' }] };
    const editor = create({ type: 'doc', content: [{ type: 'orderedList', attrs: { listLabel: label }, content: [item(p('Body'))] }] });
    const html = editor.getHTML(); expect(markers(htmlRoot(html))).toEqual(['<" &amp; 1']);
    expect(editor.getText()).toBe('Body'); expect(generateJSON(html, extensions())).toEqual(editor.getJSON());
  });
});
