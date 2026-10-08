import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold, Document, Editor, FontFamily, FontSize, HardBreak, Highlight, History, Italic, Paragraph,
  Strike, Subscript, Superscript, Text, TextColor, TextStyle, Underline,
} from '@domternal/core';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult, PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

const semanticMarks = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript']);
const source = '<div style="font-family:Calibri;font-size:16px;color:#123456">'
  + '<p><strong>Bold<span style="font-weight:400;color:#654321">Plain</span>Again</strong><em>Italic<span style="font-style:normal">Roman</span></em></p>'
  + '<p><u>Under<span style="text-decoration:none;font-style:italic">Kept</span></u><s>Strike</s><sub>2</sub><sup>3</sup></p>'
  + '<p><span style="background-color:yellow"><b>A<br>B</b></span><mark>M</mark><span style="font-size:2em">Relative</span></p></div>';

function mount(options: PasteCleanupOptions): { editor: Editor; results: NormalizePasteHTMLResult[] } {
  const results: NormalizePasteHTMLResult[] = [];
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, Italic, Underline, Strike, Subscript, Superscript, HardBreak,
      TextStyle, FontFamily, FontSize, TextColor, Highlight, History,
      PasteCleanup.configure({ ...options, onResult: result => { results.push(result); } })],
    content: '<p>Replace me</p>',
  });
  editors.push(editor);
  editor.commands.selectAll();
  return { editor, results };
}

function paste(editor: Editor, html: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Fallback' : '' },
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

/** Character-level semantic view, independent of how text nodes or wrappers were split. */
function semantics(editor: Editor): string[] {
  const units: string[] = [];
  editor.state.doc.descendants(node => {
    if (node.isTextblock) units.push(`<${node.type.name}>`);
    const marks = node.marks.map(mark => mark.type.name).filter(name => semanticMarks.has(name)).sort().join('+');
    if (node.isText) for (const character of node.text ?? '') units.push(`${character}:${marks}`);
    if (node.type.name === 'hardBreak') units.push(`br:${marks}`);
  });
  return units;
}

function visualMarks(editor: Editor): string[] {
  const names = new Set<string>();
  editor.state.doc.descendants(node => { for (const mark of node.marks) if (!semanticMarks.has(mark.type.name)) names.add(mark.type.name); });
  return [...names].sort();
}

describe('PasteCleanup adapt formatting', () => {
  it('pastes the same semantic formatting as preserve without visual typography', () => {
    const preserve = mount({});
    const adapt = mount({ formatting: 'adapt' });
    expect(paste(preserve.editor, source).defaultPrevented).toBe(true);
    const before = adapt.editor.getJSON();
    expect(paste(adapt.editor, source).defaultPrevented).toBe(true);

    expect(semantics(adapt.editor)).toEqual(semantics(preserve.editor));
    expect(semantics(adapt.editor)).toContain('br:bold');
    expect(semantics(adapt.editor)).toContain('K:italic+underline');
    expect(visualMarks(preserve.editor)).toContain('textStyle');
    expect(visualMarks(adapt.editor)).toEqual([]);

    const adaptResult = adapt.results.at(-1);
    expect(adaptResult?.status).toBe('cleaned');
    expect(adaptResult?.diagnostics.length).toBeGreaterThan(0);
    expect(adaptResult?.diagnostics.every(item => item.code === 'formatting-adapted' && item.severity === 'info')).toBe(true);
    expect(preserve.results.at(-1)?.diagnostics).toEqual([]);

    const after = adapt.editor.getJSON();
    expect(adapt.editor.commands.undo()).toBe(true);
    expect(adapt.editor.getJSON()).toEqual(before);
    expect(adapt.editor.commands.redo()).toBe(true);
    expect(adapt.editor.getJSON()).toEqual(after);
  });

  it('applies an adapted paste within a node budget that preserved typography exceeds', () => {
    const html = `<div style="color:red">${'<p>x</p>'.repeat(20)}</div>`;
    const preserve = mount({ limits: { maxNodes: 44 } });
    const adapt = mount({ formatting: 'adapt', limits: { maxNodes: 44 } });
    const before = preserve.editor.getJSON();

    paste(preserve.editor, html);
    expect(preserve.results.at(-1)).toMatchObject({ status: 'rejected', html: '' });
    expect(preserve.results.at(-1)?.diagnostics).toEqual([{ code: 'structure-limit', severity: 'error' }]);
    expect(preserve.editor.getJSON()).toEqual(before);

    paste(adapt.editor, html);
    expect(adapt.results.at(-1)).toMatchObject({ status: 'cleaned', diagnostics: [{ code: 'formatting-adapted', severity: 'info', offset: 0 }] });
    expect(adapt.editor.state.doc.childCount).toBe(20);
    expect(adapt.editor.state.doc.textContent).toBe('x'.repeat(20));
  });
});
