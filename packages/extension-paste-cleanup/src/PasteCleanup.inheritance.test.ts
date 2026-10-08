import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold, CodeBlock, Document, Editor, FontFamily, FontSize, HardBreak, Highlight, History,
  Italic, Paragraph, Strike, Text, TextColor, TextStyle, Underline, UniqueID,
} from '@domternal/core';
import type { Node as ProseMirrorNode } from '@domternal/pm/model';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult, PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

const inheritedHTML = '<div style="font-family:Calibri;font-size:16px;color:#123456"><p>'
  + '<strong>Bold<span style="font-weight:400;color:#654321">Plain</span>Again</strong>'
  + '<em>Italic<span style="font-style:normal">Roman</span></em></p></div>';

function mount(options: PasteCleanupOptions = {}, content = '<p id="target"></p>'): {
  editor: Editor; results: NormalizePasteHTMLResult[]; transactions: { paste: unknown; uiEvent: unknown }[];
} {
  const results: NormalizePasteHTMLResult[] = [];
  const transactions: { paste: unknown; uiEvent: unknown }[] = [];
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, Italic, Underline, Strike, HardBreak, CodeBlock,
      TextStyle, FontFamily, FontSize, TextColor, Highlight, History, UniqueID,
      PasteCleanup.configure({ ...options, onResult: result => { results.push(result); } })],
    content,
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) transactions.push({ paste: transaction.getMeta('paste'), uiEvent: transaction.getMeta('uiEvent') });
    },
  });
  editors.push(editor);
  editor.commands.selectAll();
  transactions.length = 0;
  return { editor, results, transactions };
}

/** Synthetic clipboard transport exercises the real ProseMirror paste handler. */
function paste(editor: Editor, html: string, text = 'Fallback text'): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.isTrusted).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
}

function textNode(editor: Editor, text: string): ProseMirrorNode {
  let found: ProseMirrorNode | undefined;
  editor.state.doc.descendants(node => { if (node.isText && node.text === text) found = node; });
  if (found === undefined) throw new Error(`Missing text node: ${text}`);
  return found;
}

function markNames(editor: Editor, text: string): string[] {
  return textNode(editor, text).marks.map(mark => mark.type.name);
}

function textStyle(editor: Editor, text: string): Record<string, unknown> | undefined {
  return textNode(editor, text).marks.find(mark => mark.type.name === 'textStyle')?.attrs;
}

function snapshot(editor: Editor): { doc: unknown; selection: unknown } {
  return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
}

function history(editor: Editor, before: ReturnType<typeof snapshot>): void {
  const after = snapshot(editor);
  expect(after.doc).not.toEqual(before.doc);
  expect(editor.commands.undo()).toBe(true);
  expect(snapshot(editor)).toEqual(before);
  expect(editor.commands.redo()).toBe(true);
  expect(snapshot(editor)).toEqual(after);
}

describe('PasteCleanup inherited formatting integration', () => {
  it.each(['preserve', 'adapt'] as const)('applies %s typography with true descendant mark resets and reversible selection', formatting => {
    const { editor, results, transactions } = mount({ formatting }, '<p id="target">Replace me</p>');
    const before = snapshot(editor);
    paste(editor, inheritedHTML);

    expect(editor.state.doc.textContent).toBe('BoldPlainAgainItalicRoman');
    expect(markNames(editor, 'Bold')).toContain('bold');
    expect(markNames(editor, 'Again')).toContain('bold');
    expect(markNames(editor, 'Plain')).not.toContain('bold');
    expect(markNames(editor, 'Italic')).toContain('italic');
    expect(markNames(editor, 'Roman')).not.toContain('italic');
    for (const text of ['Bold', 'Plain', 'Again', 'Italic', 'Roman']) {
      if (formatting === 'preserve') {
        expect(textStyle(editor, text)).toMatchObject({
          fontFamily: 'Calibri', fontSize: '16px', color: text === 'Plain' ? '#654321' : '#123456',
        });
      } else expect(textStyle(editor, text)).toBeUndefined();
    }
    expect(results.at(-1)?.status).toBe('cleaned');
    expect(results.at(-1)?.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    if (formatting === 'adapt') expect(results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted', severity: 'info' }));
    expect(transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
    history(editor, before);
  });

  it('resolves known relative font sizes and reports an unknown base without applying it', () => {
    const { editor, results } = mount();
    paste(editor, '<div style="font-size:12pt"><p>Base<span style="font-size:2em">Larger<span style="font-size:50%">Restored</span></span></p></div><p style="font-size:2em">Unknown</p>');
    expect(textStyle(editor, 'Base')).toMatchObject({ fontSize: '12pt' });
    expect(textStyle(editor, 'Larger')).toMatchObject({ fontSize: '24pt' });
    expect(textStyle(editor, 'Restored')).toMatchObject({ fontSize: '12pt' });
    expect(textStyle(editor, 'Unknown')).toBeUndefined();
    expect(results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting', offset: expect.any(Number) }));
  });

  it('retains parent decorations while preserving inline highlight separately from block fill', () => {
    const { editor } = mount();
    paste(editor, '<div style="background-color:blue;font-family:Calibri"><p><u>Parent<span style="text-decoration:none;font-style:italic">Child</span></u><span style="background-color:yellow">Highlight<span style="color:#123456">Color</span></span><mark>Default</mark></p></div>');
    expect(markNames(editor, 'Parent')).toContain('underline');
    expect(markNames(editor, 'Child')).toEqual(expect.arrayContaining(['underline', 'italic']));
    expect(textStyle(editor, 'Parent')).toMatchObject({ fontFamily: 'Calibri', backgroundColor: null });
    expect(textStyle(editor, 'Highlight')).toMatchObject({ fontFamily: 'Calibri', backgroundColor: 'yellow' });
    expect(textStyle(editor, 'Color')).toMatchObject({ fontFamily: 'Calibri', color: '#123456', backgroundColor: 'yellow' });
    expect(textStyle(editor, 'Default')).toMatchObject({ backgroundColor: '#fef08a' });
  });

  it('adapts both explicit and default highlights without losing text', () => {
    const { editor, results } = mount({ formatting: 'adapt' });
    paste(editor, '<p><mark>Default</mark><span style="background-color:yellow">Explicit</span></p>');
    expect(editor.state.doc.textContent).toBe('DefaultExplicit');
    editor.state.doc.descendants(node => { if (node.isText) expect(node.marks.some(mark => mark.type.name === 'textStyle')).toBe(false); });
    expect(results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted', severity: 'info' }));
  });

  it('keeps meaningful spaces, NBSP, hard breaks and code-block whitespace', () => {
    const { editor } = mount();
    paste(editor, '<div style="font-weight:bold"><p>A<span> </span>B&nbsp;C<br>D</p><pre><code> E\n  F </code></pre></div>');
    expect(editor.state.doc.child(0).textContent).toBe('A B\u00a0CD');
    expect(editor.state.doc.child(0).content.content.map(node => node.type.name)).toContain('hardBreak');
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock');
    expect(editor.state.doc.child(1).textContent).toBe(' E\n  F ');
  });

  it('bypasses external adaptation for an actual serialized internal styled fragment', () => {
    const source = mount({}, '<p id="source"><span data-text-color="red" data-bg-color="blue" style="font-family:Calibri;font-size:16px"><strong>Bold</strong>Plain<strong>Again</strong></span></p>').editor;
    const copied = source.view.serializeForClipboard(source.state.selection.content());
    expect(copied.dom.innerHTML).toContain('data-pm-slice');
    const { editor, results } = mount({ formatting: 'adapt' });
    const before = snapshot(editor);
    paste(editor, copied.dom.innerHTML, copied.text);
    expect(editor.getJSON()).toEqual(source.getJSON());
    expect(markNames(editor, 'Plain')).not.toContain('bold');
    expect(textStyle(editor, 'Plain')).toMatchObject({ colorToken: 'red', backgroundColorToken: 'blue', fontFamily: 'Calibri', fontSize: '16px' });
    expect(results.at(-1)?.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'formatting-adapted' }));
    history(editor, before);
  });

  it('rejects generated formatting beyond the output node budget before changing selection or document', () => {
    const { editor, results, transactions } = mount({ limits: { maxNodes: 4 } }, '<p id="target">Keep</p>');
    const before = snapshot(editor);
    paste(editor, '<p style="font-weight:bold;font-style:italic;color:red">New</p>');
    expect(snapshot(editor)).toEqual(before);
    expect(transactions).toEqual([]);
    expect(results.at(-1)).toMatchObject({ status: 'rejected', html: '' });
    expect(results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'structure-limit', severity: 'error' }));
  });
});
