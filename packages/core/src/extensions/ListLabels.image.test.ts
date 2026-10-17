import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListLabels } from './ListLabels.js';
import { History } from './History.js';
import { generateHTML, generateJSON } from '../helpers/ssr.js';
import { getListLabelStyleSheet } from '../utils/listLabelStyles.js';
import { formatListLabel, readListLabel, parseListLabel, serializeListLabel } from '../utils/listLabel.js';
import type { JSONContent } from '../types/Content.js';
import type { AnyExtension } from '../types/index.js';

const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAFklEQVR4nGO4o2zznxTMMKphVAN2DAArDECw1uKo8wAAAABJRU5ErkJggg==';
const label = { kind: 'image', src, text: '◆' };
const extensions = (): AnyExtension[] => [Document, Paragraph, Text, OrderedList, BulletList, ListLabels, History];
const content: JSONContent = { type: 'doc', content: [{ type: 'bulletList', attrs: { listLabel: label }, content: [
  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Picture bullet' }] }] },
] }] };
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
function create(value: JSONContent = content): Editor { const editor = new Editor({ extensions: extensions(), content: value }); editors.push(editor); return editor; }

describe('optional local picture list markers', () => {
  it('preserves canonical data, explicit fallback, browser HTML, server HTML and native copy', () => {
    expect(readListLabel(label)).toEqual(label); expect(Object.isFrozen(readListLabel(label))).toBe(true);
    expect(parseListLabel(serializeListLabel(label))).toEqual(label); expect(formatListLabel(label)).toBe('◆');
    const editor = create(); const before = editor.getJSON();
    expect(editor.view.dom.querySelector('ul')?.style.listStyleImage).toContain('var(--dm-ll-png-');
    const html = editor.getHTML(); expect(html).toContain('list-style-image:'); expect(generateJSON(html, extensions())).toEqual(before);
    expect(generateJSON(generateHTML(before, extensions()), extensions())).toEqual(before);
    const server = parseHTML('<!doctype html><html><body></body></html>').document;
    expect(generateJSON(generateHTML(before, extensions(), { document: server }), extensions())).toEqual(before);
    editor.commands.selectAll(); const copy = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(copy.text).toBe('Picture bullet'); expect(generateJSON(copy.dom.innerHTML, extensions())).toEqual(before);
    expect(editor.getJSON()).toEqual(before); expect(editor.getText()).toBe('Picture bullet');
  });
  it('keeps picture labels off ordered lists and refuses remote or active image sources', () => {
    for (const value of [{ ...label, src: 'https://example.test/marker.png' }, { ...label, src: 'data:image/svg+xml,<svg/>' },
      { ...label, text: '' }, { ...label, text: '\n' }, { ...label, extra: true }]) expect(readListLabel(value)).toBeNull();
    const editor = create({ type: 'doc', content: [{ ...content.content![0]!, type: 'orderedList' }] });
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(editor.view.dom.querySelector('ol')?.style.listStyleImage ?? '').toBe('');
  });
  it('updates presentation with undo and supplies a native CSS text fallback without model text', () => {
    const editor = create(); const list = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, { ...list.attrs, listLabel: { kind: 'text', text: 'Other' } }));
    expect(editor.view.dom.querySelector('ul')?.style.listStyleImage ?? '').toBe('');
    expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.firstChild?.attrs['listLabel']).toEqual(label);
    const css = getListLabelStyleSheet(editor.getJSON());
    expect(css).toContain('symbols: "◆"'); expect(css).toContain(`url("${src}")`);
    expect(css).toContain(':is(ol, ul) { list-style-image: none; }');
    expect(editor.getText()).toBe('Picture bullet');
  });
});
