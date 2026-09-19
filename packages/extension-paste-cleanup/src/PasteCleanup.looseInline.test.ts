/**
 * Inline content that follows a block at the top of pasted HTML: ProseMirror's parse reads a space
 * between its words that is a text node of white space only as the space between two blocks and
 * drops it. PasteCleanup wraps such a run in a paragraph, where the space stays.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold, BulletList, Document, Editor, FontFamily, FontSize, HardBreak, Italic, ListItem, Paragraph, Text, TextColor,
  TextStyle,
} from '@domternal/core';
import type { Node as PMNode } from '@domternal/pm/model';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult, PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

// The last paragraph of a partial Google Docs selection may arrive as bare spans after the blocks
// before it, inside the guid wrapper. The shape is authored, not a native capture.
const google = (content: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-00000000-7fff-4000-8000-000000000009">${content}</b>`;
const run = (style: string, text: string): string =>
  `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;${style}white-space:pre-wrap;">${text}</span>`;
// The final run deliberately contains only the first three letters of "italic".
const partialLast = run('font-weight:400;', 'GB09 ') + run('font-weight:700;', 'bold') + run('font-weight:400;', ' ')
  + run('font-weight:400;font-style:italic;', 'ita');
const first = '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;">First</span></p>';

function mount(options: PasteCleanupOptions = {}): { editor: Editor; results: NormalizePasteHTMLResult[] } {
  const results: NormalizePasteHTMLResult[] = [];
  const editor = new Editor({
    content: '<p>Replace</p>',
    extensions: [Document, Paragraph, Text, HardBreak, Bold, Italic, BulletList, ListItem, TextStyle, FontFamily, FontSize, TextColor,
      PasteCleanup.configure({ ...options, onResult: result => { results.push(result); } })],
  });
  editors.push(editor);
  editor.commands.selectAll();
  return { editor, results };
}

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], files: [], getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
}

/** Each top-level block's type and text, with a hard break shown as a line feed. */
function blocks(editor: Editor): string[] {
  const text = (node: PMNode): string => {
    let value = '';
    node.descendants(child => { value += child.isText ? child.text ?? '' : child.type.name === 'hardBreak' ? '\n' : ''; });
    return value;
  };
  const result: string[] = [];
  editor.state.doc.forEach(node => { result.push(`${node.type.name}: ${text(node)}`); });
  return result;
}

describe('PasteCleanup keeps the spaces of inline content that follows a block', () => {
  it.each(['preserve', 'adapt'] as const)('keeps a space span of a partial Google Docs last paragraph in %s', formatting => {
    const { editor, results } = mount({ formatting });
    paste(editor, google(first + partialLast));
    expect(blocks(editor)).toEqual(['paragraph: First', 'paragraph: GB09 bold ita']);
    const marked: string[] = [];
    editor.state.doc.descendants(node => {
      if (node.isText) marked.push(`${node.text ?? ''}:${node.marks.map(mark => mark.type.name).filter(name => name !== 'textStyle').join('+')}`);
    });
    expect(marked).toEqual(['First:', 'GB09 :', 'bold:bold', ' :', 'ita:italic']);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('cleaned');
  });

  it('keeps it after a line break Google Docs writes for an empty paragraph', () => {
    const { editor } = mount({ formatting: 'adapt' });
    paste(editor, google(`${first}<br />${partialLast}`));
    expect(blocks(editor)).toEqual(['paragraph: First', 'paragraph: \nGB09 bold ita']);
  });

  it.each([
    ['a paragraph', '<p>x</p><b>a</b> <i>b</i>', ['paragraph: x', 'paragraph: a b']],
    ['a list', '<ul><li>x</li></ul><b>a</b> <i>b</i>', ['bulletList: x', 'paragraph: a b']],
    ['a division', '<div>x</div><span>a</span><span> </span><span>b</span>', ['paragraph: x', 'paragraph: a b']],
    ['a paragraph, two preformatted spaces', '<p>x</p><span style="white-space:pre-wrap">a</span><span style="white-space:pre-wrap">  </span>'
      + '<span style="white-space:pre-wrap">b</span>', ['paragraph: x', 'paragraph: a  b']],
  ])('keeps the space of inline content after %s', (_name, html, expected) => {
    const { editor } = mount();
    paste(editor, html);
    expect(blocks(editor)).toEqual(expected);
  });

  it('leaves inline content before the first block to merge into the caret paragraph as before', () => {
    const { editor } = mount();
    editor.commands.setContent('<p>Host</p>');
    editor.commands.focus('end');
    paste(editor, '<b>a</b> <i>b</i><p>x</p>');
    expect(blocks(editor)).toEqual(['paragraph: Hosta b', 'paragraph: x']);
  });
});
