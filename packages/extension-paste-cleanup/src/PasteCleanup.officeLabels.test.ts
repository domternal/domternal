import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulletList, Document, Editor, History, ListItem, ListLabels, OrderedList, Paragraph, Text } from '@domternal/core';
import type { JSONAttribute, JSONContent } from '@domternal/core';
import { Image } from '../../extension-image/dist/index.js';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { NormalizePasteHTMLResult } from './html/types.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' } as const;
const bullet = { kind: 'text', text: '✓' } as const;
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const entry = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: 'listItem', content: [paragraph(text), ...nested] });
const ordered = (start: number, content: JSONContent[], label: JSONAttribute = counter, style = 'upper-alpha'): JSONContent => ({ type: 'orderedList', attrs: { start, listStyleType: style, listLabel: label }, content });
const wordItem = (marker: string, text: string, level = 1, list = 0): string =>
  `<p style="mso-list:l${String(list)} level${String(level)} lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp;</span></span>${text}</p>`;
const rules = '<style>@list l0:level1 {mso-level-number-format:alpha-upper;mso-level-text:"Section %1)";}'
  + '@list l0:level2 {mso-level-number-format:bullet;mso-level-text:"✓";}'
  + '@list l1:level1 {mso-level-text:"(%1)";}</style>';
function receiving(labels: boolean, formatting: 'preserve' | 'adapt', results: NormalizePasteHTMLResult[], imageAssets = false): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList, History, SmartPaste,
    ...(labels ? [ListLabels] : []), ...(imageAssets ? [Image.configure({ allowBase64: true })] : []), PasteCleanup.configure({ formatting,
      ...(imageAssets ? { imageAssets: { mode: 'embedded' as const } } : {}), onResult: result => { results.push(result); } })], content: '<p>Before</p>' });
  editors.push(editor); return editor;
}
function paste(editor: Editor, html: string): void {
  editor.commands.selectAll();
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Word list content' : '' } });
  editor.view.dom.dispatchEvent(event);
}

describe('Word labels in the receiving editor', () => {
  it.each(['preserve', 'adapt'] as const)('preserves exact labels, nesting, numbering gaps, history and clipboard metadata with %s', formatting => {
    const results: NormalizePasteHTMLResult[] = []; const editor = receiving(true, formatting, results);
    const before = editor.getJSON();
    paste(editor, rules + wordItem('Section AA)', 'Outer') + wordItem('✓', 'Inner', 2) + wordItem('Section AB)', 'Next')
      + wordItem('(0)', 'Zero', 1, 1) + wordItem('(1)', 'One', 1, 1) + wordItem('(4)', 'Restart', 1, 1));
    const decimal = { kind: 'counter', format: 'decimal', prefix: '(', suffix: ') ' };
    const expected: JSONContent = { type: 'doc', content: [
      ordered(27, [entry('Outer', { type: 'bulletList', attrs: { listStyleType: 'disc', listLabel: bullet }, content: [entry('Inner')] }), entry('Next')]),
      ordered(0, [entry('Zero'), entry('One')], decimal, 'decimal'), ordered(4, [entry('Restart')], decimal, 'decimal'),
    ] };
    expect(editor.getJSON()).toEqual(expected);
    expect(editor.state.doc.textContent).toBe('OuterInnerNextZeroOneRestart');
    expect(results).toHaveLength(1); expect(results[0]?.diagnostics).toEqual([]);
    const html = editor.getHTML();
    expect(html).toContain('data-dm-list-label'); expect(html).not.toContain('mso-list');
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true); expect(editor.getJSON()).toEqual(expected);
    paste(editor, html); expect(editor.getJSON()).toEqual(expected);
    expect(results[1]?.diagnostics).toEqual([]);
  });

  it.each([false, true])('retains labels through image preparation, with a picture=%s', async picture => {
    const results: NormalizePasteHTMLResult[] = []; const editor = receiving(true, 'preserve', results, true);
    const before = editor.getJSON();
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
    paste(editor, rules + wordItem('Section A)', 'Outer') + wordItem('✓', 'Inner', 2)
      + (picture ? `<p><img src="${image}" alt="Chart"></p>` : ''));
    await vi.waitFor(() => { expect(results).toHaveLength(1); }, { interval: 1 });
    await vi.waitFor(() => { expect(editor.getJSON().content?.[0]?.type).toBe('orderedList'); }, { interval: 1 });
    expect(editor.getJSON().content?.[0]).toEqual(ordered(1, [entry('Outer', {
      type: 'bulletList', attrs: { listStyleType: 'disc', listLabel: bullet }, content: [entry('Inner')],
    })]));
    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(picture ? image : undefined);
    expect(results[0]?.diagnostics).toEqual([]);
    const after = editor.getJSON();
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true); expect(editor.getJSON()).toEqual(after);
  });

  it('keeps unsupported source labels literal with a warning in a legacy editor', () => {
    const results: NormalizePasteHTMLResult[] = []; const editor = receiving(false, 'preserve', results);
    paste(editor, rules + wordItem('Section AA)', 'Outer') + wordItem('✓', 'Inner', 2));
    expect(editor.state.doc.content.content.map(node => node.type.name)).toEqual(['paragraph', 'paragraph']);
    expect(editor.state.doc.textContent).toContain('Section AA)'); expect(editor.state.doc.textContent).toContain('✓');
    expect(JSON.stringify(editor.getJSON())).not.toContain('listLabel');
    expect(results[0]?.diagnostics.map(value => value.code)).toContain('office-list-unsupported');
  });
});
