import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold, createDocument, Document, Editor, FontFamily, FontSize, HardBreak, History, Italic, LineHeight,
  Paragraph, Strike, Subscript, Superscript, Text, TextAlign, TextColor, TextStyle, Underline,
} from '@domternal/core';
import type { EditorOptions, JSONAttribute, JSONContent, JSONMark } from '@domternal/core';
import { PasteCleanup, normalizePasteHTML } from './index.js';
import type { NormalizePasteHTMLResult, PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });
const formatting = [Bold, Italic, Underline, Strike, Subscript, Superscript,
  TextStyle, FontFamily, FontSize, TextColor, TextAlign, LineHeight];
const fullHTML = '<p style="text-align:center;line-height:1.5"><span style="font-family:Georgia;font-size:14pt;color:#123456">'
  + '<strong><em><u><s><sub>A<br><br>B</sub></s></u></em></strong></span></p>';
const style = (attributes: Record<string, JSONAttribute> = {}): JSONMark => ({
  type: 'textStyle', attrs: { fontFamily: null, fontSize: null, color: null, colorToken: null, ...attributes },
});
const semantic = ['bold', 'italic', 'underline', 'strike', 'subscript'].map(type => ({ type }));
const complete = [style({ fontFamily: 'Georgia', fontSize: '14pt', color: '#123456' }), ...semantic];
const paragraph = (content: JSONContent[], textAlign = 'left', lineHeight: string | null = null): JSONContent => ({
  type: 'paragraph', attrs: { textAlign, lineHeight }, content,
});
const documentJSON = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
function mount(options: PasteCleanupOptions = {}, extensions: NonNullable<EditorOptions['extensions']> = formatting): {
  editor: Editor; results: NormalizePasteHTMLResult[]; changes: number[];
} {
  const results: NormalizePasteHTMLResult[] = []; const changes: number[] = [];
  const editor = new Editor({ content: '<p>Replace</p>',
    extensions: [Document, Paragraph, Text, HardBreak, History, ...extensions,
      PasteCleanup.configure({ ...options, onResult: result => { results.push(result); } })],
    onTransaction: ({ transaction }) => { if (transaction.docChanged) changes.push(transaction.steps.length); },
  });
  editors.push(editor); editor.commands.selectAll(); changes.length = 0;
  return { editor, results, changes };
}
function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], files: [], getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.dom.dispatchEvent(event);
  expect(event.isTrusted).toBe(false); expect(event.defaultPrevented).toBe(true);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
}

describe('PasteCleanup marked hard breaks in the actual editor schema', () => {
  it.each(['preserve', 'adapt'] as const)('preserves exact hard-break marks and sibling text in %s mode', mode => {
    const { editor, results, changes } = mount({ formatting: mode });
    const before = editor.getJSON(); const selection = editor.state.selection.toJSON();
    paste(editor, fullHTML);
    const marks = mode === 'preserve' ? complete : semantic;
    const expected = documentJSON(paragraph([
      { type: 'text', text: 'A', marks }, { type: 'hardBreak', marks }, { type: 'hardBreak', marks }, { type: 'text', text: 'B', marks },
    ], mode === 'preserve' ? 'center' : 'left', mode === 'preserve' ? '1.5' : null));
    expect(editor.getJSON()).toEqual(expected);
    expect(results).toHaveLength(1); expect(results[0]?.status).toBe('cleaned'); expect(changes).toHaveLength(1);
    expect(results[0]?.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'destination-formatting-unconfirmed' }));
    if (mode === 'preserve') expect(results[0]?.diagnostics).toEqual([]);
    else expect(results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted', severity: 'info' }));
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(editor.commands.redo()).toBe(true); expect(editor.getJSON()).toEqual(expected);
  });

  it('preserves inherited marks and typography in a break-only paragraph', () => {
    const { editor, results } = mount();
    paste(editor, fullHTML.replace('A<br><br>B', '<br>'));
    expect(editor.getJSON()).toEqual(documentJSON(paragraph([{ type: 'hardBreak', marks: complete }], 'center', '1.5')));
    expect(results[0]?.diagnostics).toEqual([]);
  });

  it('materializes direct break styles without formatting an unstyled sibling', () => {
    const { editor } = mount();
    paste(editor, '<p><br style="font-weight:bold;font-style:italic;text-decoration:underline line-through;vertical-align:super;font-family:Georgia;font-size:14pt;color:#123456"><br>X</p>');
    const marks = [style({ fontFamily: 'Georgia', fontSize: '14pt', color: '#123456' }),
      ...['bold', 'italic', 'underline', 'strike', 'superscript'].map(type => ({ type }))];
    expect(editor.getJSON()).toEqual(documentJSON(paragraph([{ type: 'hardBreak', marks }, { type: 'hardBreak' }, { type: 'text', text: 'X' }])));
  });

  it('characterizes the existing clipboard placeholder rule separately from normalization and document parsing', () => {
    const { editor } = mount();
    const html = '<p><br style="font-weight:bold;font-style:italic;text-decoration:underline line-through;vertical-align:super;font-family:Georgia;font-size:14pt;color:#123456"><br></p>';
    const result = normalizePasteHTML(html);
    expect(result.status).toBe('cleaned'); expect(result.html.match(/<br>/g)).toHaveLength(2);
    const marks = [style({ fontFamily: 'Georgia', fontSize: '14pt', color: '#123456' }),
      ...['bold', 'italic', 'underline', 'strike', 'superscript'].map(type => ({ type }))];
    const expected = documentJSON(paragraph([{ type: 'hardBreak', marks }, { type: 'hardBreak' }]));
    expect(createDocument(result.html, editor.schema).toJSON()).toEqual(expected);
    paste(editor, html);
    // ProseMirror's clipboard parser treats a final bare BR in a block as a placeholder.
    expect(editor.getJSON()).toEqual(documentJSON(paragraph([{ type: 'hardBreak', marks }])));
  });

  it('applies real descendant resets and restores the next break sibling', () => {
    const { editor } = mount();
    paste(editor, '<div style="font-family:Georgia;font-size:14pt;color:#123456"><p><strong><em>'
      + '<br><span style="font-weight:normal;font-style:normal;color:#654321"><br></span><br></em></strong></p></div>');
    const active = [style({ fontFamily: 'Georgia', fontSize: '14pt', color: '#123456' }), { type: 'bold' }, { type: 'italic' }];
    const reset = [style({ fontFamily: 'Georgia', fontSize: '14pt', color: '#654321' })];
    expect(editor.getJSON()).toEqual(documentJSON(paragraph([
      { type: 'hardBreak', marks: active }, { type: 'hardBreak', marks: reset }, { type: 'hardBreak', marks: active },
    ])));
  });

  it('warns once for an unsupported mark on meaningful break-only content', () => {
    const { editor, results } = mount({}, []);
    paste(editor, '<p><strong><br></strong></p>');
    expect(results).toHaveLength(1);
    expect(results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
    expect(editor.getJSON()).toEqual(documentJSON({ type: 'paragraph', content: [{ type: 'hardBreak' }] }));
  });

  it.each(['preserve', 'adapt'] as const)('reports only retained break-only typography demand in %s mode', mode => {
    const { editor, results } = mount({ formatting: mode }, []);
    paste(editor, '<p><span style="font-family:Georgia;font-size:14pt;color:#123456"><br></span></p>');
    expect(editor.getJSON()).toEqual(documentJSON({ type: 'paragraph', content: [{ type: 'hardBreak' }] }));
    const warnings = results[0]?.diagnostics.filter(diagnostic => diagnostic.code === 'destination-formatting-unconfirmed');
    expect(warnings).toEqual(mode === 'preserve' ? [{ code: 'destination-formatting-unconfirmed', severity: 'warning' }] : []);
    if (mode === 'adapt') expect(results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted', severity: 'info' }));
  });

  it('does not warn for an empty decorated sibling beside a real break', () => {
    const { editor, results } = mount({}, []);
    paste(editor, '<p><strong></strong><span style="font-family:Georgia;color:red"></span><br>X</p>');
    expect(results[0]?.diagnostics).toEqual([]);
    expect(editor.getJSON()).toEqual(documentJSON({ type: 'paragraph', content: [{ type: 'hardBreak' }, { type: 'text', text: 'X' }] }));
  });

  it('preserves actual internal clipboard hard-break marks even when external formatting adapts', () => {
    const source = mount().editor; source.commands.setContent(fullHTML); source.commands.selectAll();
    const copied = source.view.serializeForClipboard(source.state.selection.content());
    expect(copied.dom.innerHTML).toContain('data-pm-slice');
    const { editor, results } = mount({ formatting: 'adapt' }); paste(editor, copied.dom.innerHTML);
    expect(editor.getJSON()).toEqual(source.getJSON());
    expect(results[0]?.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'formatting-adapted' }));
  });

  it('rejects generated break wrappers beyond the shared limit without changing document, selection or history', () => {
    const html = '<p style="font-weight:bold;font-style:italic;color:red"><br></p>';
    expect(normalizePasteHTML(html, { limits: { maxNodes: 6 } }).status).toBe('cleaned');
    expect(normalizePasteHTML(html, { limits: { maxNodes: 5 } })).toMatchObject({ status: 'rejected', html: '' });
    const { editor, results, changes } = mount({ limits: { maxNodes: 5 } });
    const before = editor.getJSON(); const selection = editor.state.selection.toJSON(); paste(editor, html);
    expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(changes).toEqual([]); expect(editor.commands.undo()).toBe(false);
    expect(results[0]).toMatchObject({ status: 'rejected', html: '', diagnostics: [{ code: 'structure-limit', severity: 'error' }] });
  });

  it('bounds generated typography on many breaks before allocating an expanded HTML result', () => {
    const html = `<p style="font-family:${'A'.repeat(80)}">${'<br>'.repeat(20)}</p>`;
    expect(html.length).toBeLessThan(600);
    expect(normalizePasteHTML(html, { limits: { maxInputLength: 600 } })).toMatchObject({ status: 'rejected', html: '',
      diagnostics: [{ code: 'structure-limit', severity: 'error' }] });
    expect(normalizePasteHTML(html, { limits: { maxInputLength: 1_860 } }).status).toBe('cleaned');
  });

  it('normalizes break-only HTML without requiring an editor schema', () => {
    const result = normalizePasteHTML('<p><strong><br></strong></p>');
    expect(result).toMatchObject({ status: 'cleaned', html: '<p><span><strong><br></strong></span></p>', diagnostics: [] });
  });
});
