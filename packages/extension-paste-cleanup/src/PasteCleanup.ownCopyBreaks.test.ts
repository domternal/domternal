import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, Bold, BulletList, Document, Editor, HardBreak, Heading, History, ListItem, Paragraph, Text } from '@domternal/core';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
import { normalizePasteHTML, PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult, PasteFormatting } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(content: string, formatting: PasteFormatting = 'preserve', maxNodes?: number): {
  editor: Editor; results: NormalizePasteHTMLResult[];
} {
  const results: NormalizePasteHTMLResult[] = [];
  const editor = new Editor({ content, extensions: [Document, Paragraph, Text, HardBreak, Bold, Heading,
    Blockquote, BulletList, ListItem, History, PasteCleanup.configure({ formatting,
      ...(maxNodes === undefined ? {} : { limits: { maxNodes } }), onResult: result => { results.push(result); },
    })] });
  editors.push(editor);
  return { editor, results };
}

function copied(editor: Editor): string {
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
}

function paste(editor: Editor, html: string): void {
  editor.commands.selectAll();
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], files: [], getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
}

describe('trailing hard breaks in verified own copies', () => {
  for (const formatting of ['preserve', 'adapt'] as const) {
    it.each([
      ['a break-only paragraph', '<p><br></p>'],
      ['one trailing break', '<p>Text<br></p>'],
      ['consecutive trailing breaks', '<p>Text<br><br><br></p>'],
      ['separate paragraphs', '<p>A<br></p><p>B<br></p><p></p>'],
      ['a marked break and a bare break', '<p><strong><br></strong><br></p>'],
      ['a heading', '<h2>Title<br></h2>'],
      ['a list item', '<ul><li><p>Item<br></p></li></ul>'],
      ['a blockquote', '<blockquote><p>Quote<br></p></blockquote>'],
    ])(`keeps %s exactly in ${formatting}`, (_name, html) => {
      const source = mount(html).editor;
      const target = mount('<p>Replace</p>', formatting);
      const before = target.editor.getJSON();
      const expected = source.getJSON();
      paste(target.editor, copied(source));
      expect(target.editor.getJSON()).toEqual(expected);
      expect(target.results).toHaveLength(1);
      expect(target.results[0]?.status).toBe('cleaned');
      expect(target.results[0]?.diagnostics).toEqual([]);
      expect(target.editor.commands.undo()).toBe(true);
      expect(target.editor.getJSON()).toEqual(before);
      expect(target.editor.commands.redo()).toBe(true);
      expect(target.editor.getJSON()).toEqual(expected);
    });
  }

  it('does not turn empty paragraphs into additional hard breaks', () => {
    const source = mount('<p></p><p>Text</p><p></p>').editor;
    const target = mount('<p>Replace</p>').editor;
    paste(target, copied(source));
    expect(target.getJSON()).toEqual(source.getJSON());
  });

  it('keeps a selected trailing break when its surrounding text is not copied', () => {
    const source = mount('<p>A<br></p>').editor;
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 2, 3)));
    const html = source.view.serializeForClipboard(source.state.selection.content()).dom.innerHTML;
    const target = mount('<p>Replace</p>').editor;
    paste(target, html);
    expect(target.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'hardBreak' }] }] });
  });

  it('keeps the root break of a node selection without moving its slice context', () => {
    const source = mount('<p>A<br></p>').editor;
    source.view.dispatch(source.state.tr.setSelection(NodeSelection.create(source.state.doc, 2)));
    const html = source.view.serializeForClipboard(source.state.selection.content()).dom.innerHTML;
    expect(html).toMatch(/^<br\b/);
    const target = mount('<p>Replace</p>').editor;
    paste(target, html);
    expect(target.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'hardBreak' }] }] });
  });

  it('treats a break added by a host clipboard serializer as intentional serialized content', () => {
    const source = new Editor({ content: '<p>Text</p>', extensions: [Document, Paragraph, Text, HardBreak, PasteCleanup],
      clipboardHTMLTransform: html => html.replaceAll('</p>', '<br></p>'),
    });
    editors.push(source);
    const target = mount('<p>Replace</p>').editor;
    paste(target, copied(source));
    expect(target.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Text' }, { type: 'hardBreak' },
    ] }] });
    expect(source.state.doc.firstChild?.childCount).toBe(1);
  });

  it.each([
    '<p>Text<br></p>',
    '<p data-pm-slice="0 0 []">Text<br></p>',
    '<p data-pm-slice="0 0 []" data-domternal-copy="v1.AAAAAAAAAAAAAAAAAAAAAA">Text<br></p>',
  ])('retains the browser placeholder rule for unverified HTML: %s', html => {
    const target = mount('<p>Replace</p>').editor;
    paste(target, html);
    expect(target.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] });
  });

  it('counts protective wrappers in the shared output bound and rejects atomically', () => {
    const source = mount('<p>Text<br></p>'.repeat(4)).editor;
    const html = copied(source);
    expect(normalizePasteHTML(html, { limits: { maxNodes: 16 } }).status).toBe('cleaned');
    const target = mount('<p>Replace</p>', 'preserve', 16);
    const before = target.editor.getJSON();
    paste(target.editor, html);
    expect(target.results[0]).toMatchObject({ status: 'rejected', html: '', diagnostics: [{ code: 'structure-limit', severity: 'error' }] });
    expect(target.editor.getJSON()).toEqual(before);
    expect(target.editor.commands.undo()).toBe(false);
  });
});
