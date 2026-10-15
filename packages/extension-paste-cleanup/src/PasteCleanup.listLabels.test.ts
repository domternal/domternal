import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, History, ListLabels, ListItem, OrderedList, BulletList, Paragraph, Text, getNodeListLabel } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { NormalizePasteHTMLResult } from './html/types.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' } as const;
const bullet = { kind: 'text', text: '✓' } as const;
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const source: JSONContent = { type: 'doc', content: [
  { type: 'orderedList', attrs: { start: 27, listLabel: counter }, content: [{ type: 'listItem', content: [paragraph('Outer'),
    { type: 'bulletList', attrs: { listLabel: bullet }, content: [{ type: 'listItem', content: [paragraph('Inner')] }] },
  ] }] },
] };

function editor(labels: boolean, content: JSONContent, results: NormalizePasteHTMLResult[] = []): Editor {
  const value = new Editor({ extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList, History, SmartPaste,
    ...(labels ? [ListLabels] : []), PasteCleanup.configure({ onResult: result => { results.push(result); } })], content });
  editors.push(value); return value;
}
function paste(target: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Outer\nInner' : '' } });
  target.view.dom.dispatchEvent(event);
}

describe('PasteCleanup with optional list labels', () => {
  it('round trips nested labels, nullable marker defaults and starts without adding marker text', () => {
    const producer = editor(true, source);
    const results: NormalizePasteHTMLResult[] = [];
    const target = editor(true, { type: 'doc', content: [paragraph('Seed')] }, results);
    target.commands.selectAll(); paste(target, producer.getHTML());
    expect(target.getJSON()).toEqual(producer.getJSON());
    expect(target.state.doc.textContent).toBe('OuterInner');
    expect(results).toHaveLength(1);
    expect(results[0]?.diagnostics).toEqual([]);
    expect(getNodeListLabel(target.state.doc.firstChild!)).toEqual(counter);
    expect(target.commands.undo()).toBe(true);
    expect(target.state.doc.textContent).toBe('Seed');
    expect(target.commands.redo()).toBe(true);
    expect(target.getJSON()).toEqual(producer.getJSON());
  });

  it('keeps legacy destination JSON free of the optional attribute and extra marker text', () => {
    const producer = editor(true, source);
    const target = editor(false, { type: 'doc', content: [paragraph('Seed')] });
    target.commands.selectAll(); paste(target, producer.getHTML());
    expect(JSON.stringify(target.getJSON())).not.toContain('listLabel');
    expect(target.state.doc.textContent).toBe('OuterInner');
    expect(target.state.doc.firstChild?.attrs['start']).toBe(27);
    expect(getNodeListLabel(target.state.doc.firstChild!)).toBeNull();
  });
});
