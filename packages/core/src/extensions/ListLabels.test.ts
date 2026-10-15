import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { History } from './History.js';
import { ListLabels } from './ListLabels.js';
import { generateHTML, generateJSON } from '../helpers/ssr.js';
import { getListLabelStyleSheet } from '../utils/listLabelStyles.js';
import { freshListAttrs, sameListMarker } from '../utils/listMarker.js';
import { sinkListItemWithMarker, liftListItemWithMarker } from '../utils/listMarkerCommands.js';
import { listLabelAttribute } from '../utils/listLabelAttribute.js';
import type { AnyExtension, ContentDiagnosticProps, JSONAttribute, JSONContent } from '../types/index.js';

const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' };
const text = { kind: 'text', text: '✓' };
const paragraph = (value: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const item = (value: string): JSONContent => ({ type: 'listItem', content: [paragraph(value)] });
const list = (label: JSONAttribute = counter, marker: string | null = null): JSONContent => ({
  type: 'orderedList', attrs: { start: 0, listStyleType: marker, listLabel: label }, content: [item('Alpha'), item('Bravo')],
});
const documentWith = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const editors: Editor[] = [];
const extensions = (labels = true): AnyExtension[] => [Document, Paragraph, Text, OrderedList, BulletList, History, ...(labels ? [ListLabels] : [])];
const create = (content: JSONContent = documentWith(list()), extra: Partial<ConstructorParameters<typeof Editor>[0]> = {}): Editor => {
  const editor = new Editor({ extensions: extensions(), content, ...extra }); editors.push(editor); return editor;
};
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
const styles = (root: ParentNode = document): HTMLStyleElement[] => Array.from(root.querySelectorAll<HTMLStyleElement>('style[data-domternal-list-labels]'));

describe('optional ListLabels schema and serialization', () => {
  it('does not change an old schema or ordinary JSON when omitted', () => {
    const editor = create(documentWith(list()), { extensions: extensions(false) });
    expect(editor.schema.nodes['orderedList']?.spec.attrs).not.toHaveProperty('listLabel');
    expect(editor.state.doc.firstChild?.attrs).toEqual({ listStyleType: null, start: 0 });
    expect(editor.getHTML()).toBe('<ol start="0"><li><p>Alpha</p></li><li><p>Bravo</p></li></ol>');
    expect(styles()).toHaveLength(0);
  });

  it.each([null, 'lower-roman', 'decimal'])('roundtrips an ordered label and its original fallback %s', marker => {
    const editor = create(documentWith(list(counter, marker)));
    const before = editor.getJSON(); const html = editor.getHTML();
    expect(html).toContain('data-dm-list-label='); expect(html).toContain('var(--dm-ll-');
    expect(html).not.toContain('<style'); expect(html).not.toContain('Section 0');
    editor.setContent(html, false); expect(editor.getJSON()).toEqual(before);
    expect(generateJSON(generateHTML(before, extensions()), extensions())).toEqual(before);
    const fallback = create(documentWith(paragraph('Before')), { extensions: extensions(false) });
    fallback.setContent(html, false);
    expect(fallback.state.doc.firstChild?.attrs).toEqual({ listStyleType: marker, start: 0 });
    expect(fallback.getText()).toBe('Alpha\n\nBravo');
  });

  it('preserves a literal bullet without injecting extra text or markup', () => {
    const editor = create(documentWith({ type: 'bulletList', attrs: { listLabel: text }, content: [item('Task')] }));
    expect(editor.getText()).toBe('Task');
    const html = editor.getHTML(); editor.setContent(html, false);
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toEqual(text);
    expect(editor.view.dom.querySelectorAll('li')).toHaveLength(1);
    expect(editor.view.dom.textContent).toBe('Task');
    expect(styles()[0]?.textContent).toContain('system: cyclic; symbols: "✓";');
  });

  it('uses existing normalization and diagnostics for invalid JSON and never renders it', () => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = create(documentWith(list({ ...counter, extra: 'not allowed' })), { onContentDiagnostic: report => reports.push(report) });
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(reports[0]).toMatchObject({ total: 1, diagnostics: [{ code: 'unsupported-list-label', attribute: 'listLabel' }] });
    expect(editor.getHTML()).not.toContain('data-dm-list-label'); expect(styles()).toHaveLength(0);
    expect(() => editor.schema.nodeFromJSON(documentWith(list(text)))).toThrow('Invalid list label');
    expect(listLabelAttribute('orderedList').renderHTML?.({ listLabel: { ...counter, format: 'url(x)' } })).toBeNull();
  });

  it('ignores untrusted CSS and rejects malformed or wrongly typed HTML labels', () => {
    const editor = create();
    for (const value of ['not json', JSON.stringify(text), JSON.stringify({ ...counter, prefix: '\n' })]) {
      const root = document.createElement('ol'); root.dataset['dmListLabel'] = value;
      root.style.setProperty('--dm-ll-private', 'url(https://example.invalid/)');
      root.append(document.createElement('li')); root.firstElementChild?.append(document.createElement('p'));
      editor.setContent(root.outerHTML, false);
      expect(editor.state.doc.firstChild?.attrs['listLabel']).toBeNull();
      expect(editor.getHTML()).not.toContain('example.invalid');
    }
  });

  it('retains canonical label metadata through a native clipboard slice', () => {
    const editor = create();
    editor.commands.selectAll();
    const copy = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(copy.text).toBe('Alpha\n\nBravo');
    expect(copy.dom.textContent).toBe('AlphaBravo');
    expect(copy.dom.querySelector('ol')?.getAttribute('data-dm-list-label')).toBe(JSON.stringify(counter));
    const target = create(documentWith(paragraph('Before')));
    target.commands.selectAll();
    expect(target.view.pasteHTML(copy.dom.innerHTML, new Event('paste') as ClipboardEvent)).toBe(true);
    expect(target.state.doc.firstChild?.attrs['listLabel']).toEqual(counter);
    expect(target.state.doc.textContent).toBe('AlphaBravo');
    expect(target.commands.undo()).toBe(true); expect(target.state.doc.textContent).toBe('Before');
    expect(target.commands.redo()).toBe(true); expect(target.state.doc.firstChild?.attrs['listLabel']).toEqual(counter);
  });

  it('guards an invalid label in a forged open clipboard slice', () => {
    const editor = create(documentWith(paragraph('Before')));
    const invalid = JSON.stringify(['orderedList', { listLabel: { kind: 'text', text: 'wrong kind' }, start: 1, listStyleType: null }, 'listItem', null]);
    const root = document.createElement('p'); root.setAttribute('data-pm-slice', `2 2 ${invalid}`); root.textContent = 'Copied';
    editor.commands.selectAll(); expect(editor.view.pasteHTML(root.outerHTML, new Event('paste') as ClipboardEvent)).toBe(true);
    expect(() => { editor.state.doc.check(); }).not.toThrow();
    editor.state.doc.descendants(node => { if (node.type.name === 'orderedList') expect(node.attrs['listLabel']).toBeNull(); });
  });
});

describe('list label style ownership', () => {
  it('shares scoped styles and removes them only after their final owner leaves', () => {
    const first = create(); const second = create();
    expect(styles()).toHaveLength(1);
    expect(styles()[0]?.textContent.match(/@counter-style/g)).toHaveLength(1);
    first.destroy(); expect(styles()).toHaveLength(1);
    second.destroy(); expect(styles()).toHaveLength(0);
  });

  it('updates current styles without creating document changes or retaining removed labels', () => {
    const editor = create(); const before = editor.getJSON();
    let transactions = 0; editor.on('transaction', () => { transactions++; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    expect(transactions).toBe(1); expect(editor.getJSON()).toEqual(before);
    editor.setContent(documentWith(list({ ...counter, prefix: 'Article ' })), false);
    expect(styles()[0]?.textContent).toContain('prefix: "Article ";');
    expect(styles()[0]?.textContent).not.toContain('prefix: "Section ";');
    editor.setContent('<p>Plain</p>', false); expect(styles()).toHaveLength(0);
  });

  it('moves ownership into a shadow root on adoption and cleans up both roots', () => {
    const editor = create();
    const host = document.createElement('div'); document.body.append(host);
    const root = host.attachShadow({ mode: 'open' }); const mount = document.createElement('div'); root.append(mount);
    editor.adoptDom(mount);
    expect(styles()).toHaveLength(1); expect(styles(root)).toHaveLength(1);
    expect(styles()[0]?.textContent).toContain('@counter-style');
    expect(styles(root)[0]?.textContent).toContain(':host {');
    editor.destroy(); expect(styles(root)).toHaveLength(0); expect(styles()).toHaveLength(0); host.remove();
  });

  it('retains document definitions only while a light or shadow owner needs them', () => {
    const main = create();
    const nested = create(documentWith(list({ ...counter, prefix: 'Shadow ' })));
    const host = document.createElement('div'); document.body.append(host);
    const root = host.attachShadow({ mode: 'open' }); const mount = document.createElement('div'); root.append(mount);
    nested.adoptDom(mount);
    expect(styles()).toHaveLength(1); expect(styles(root)).toHaveLength(1);
    expect(styles()[0]?.textContent).toContain('prefix: "Section ";');
    expect(styles()[0]?.textContent).toContain('prefix: "Shadow ";');
    nested.destroy();
    expect(styles(root)).toHaveLength(0); expect(styles()).toHaveLength(1);
    expect(styles()[0]?.textContent).not.toContain('prefix: "Shadow ";');
    main.destroy(); expect(styles()).toHaveLength(0); host.remove();
  });

  it('moves the owner-document definitions when the same shadow host is adopted', () => {
    const editor = create();
    const host = document.createElement('div'); document.body.append(host);
    const root = host.attachShadow({ mode: 'open' }); const mount = document.createElement('div'); root.append(mount);
    editor.adoptDom(mount);
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const other = iframe.contentDocument;
    if (!other) throw new Error('Missing frame document');
    other.body.append(other.adoptNode(host));
    editor.adoptDom(mount);
    expect(root.ownerDocument).toBe(other);
    expect(styles()).toHaveLength(0); expect(styles(other)).toHaveLength(1); expect(styles(root)).toHaveLength(1);
    editor.destroy(); expect(styles(other)).toHaveLength(0); expect(styles(root)).toHaveLength(0); iframe.remove();
  });

  it('supports nonce ownership and an explicitly host-managed stylesheet', () => {
    const editor = create(undefined, { extensions: [...extensions(false), ListLabels.configure({ nonce: 'example-nonce' })] });
    expect(styles()[0]?.nonce).toBe('example-nonce'); editor.destroy();
    const hosted = create(undefined, { extensions: [...extensions(false), ListLabels.configure({ injectCSS: false })] });
    expect(styles()).toHaveLength(0);
    expect(getListLabelStyleSheet(hosted.getJSON())).toContain('@counter-style');
    expect(hosted.getHTML()).toContain('var(--dm-ll-');
  });
});

describe('label-aware list editing', () => {
  it('keeps different labels separate while ignoring ordered starts and source IDs', () => {
    const editor = create(documentWith(list(), list({ ...counter, suffix: '] ' })));
    const first = editor.state.doc.child(0); const second = editor.state.doc.child(1);
    expect(sameListMarker(first, second)).toBe(false);
    expect(sameListMarker(first, first.type.create({ ...first.attrs, start: 8 }, first.content))).toBe(true);
    expect(freshListAttrs(first.type, { ...first.attrs, id: 'source' })).toEqual({ start: 1, listStyleType: null, listLabel: counter });
  });

  it('retains a label through sink, lift and history', () => {
    const editor = create();
    let position = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Bravo') position = pos; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position + 2)));
    const before = editor.getJSON(); const itemType = editor.schema.nodes['listItem'];
    if (itemType === undefined) throw new Error('Missing list item');
    expect(sinkListItemWithMarker(itemType)(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.lastChild?.attrs['listLabel']).toEqual(counter);
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true);
    expect(liftListItemWithMarker(itemType)(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toEqual(counter);
    expect(editor.state.doc.textContent).toBe('AlphaBravo');
  });

  it('does not adopt an unrelated custom attribute with the same name', () => {
    const Foreign = Extension.create({ name: 'foreignLabel', addGlobalAttributes() { return [{ types: ['orderedList'], attributes: { listLabel: { default: counter } } }]; } });
    const editor = create(documentWith(list()), { extensions: [...extensions(false), Foreign] });
    const first = editor.state.doc.firstChild;
    if (first === null) throw new Error('Missing list');
    expect(freshListAttrs(first.type, first.attrs)).toEqual({ start: 1, listStyleType: null });
    expect(styles()).toHaveLength(0);
  });
});
