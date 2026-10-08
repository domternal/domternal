import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold, BulletList, Document, Editor, FontFamily, FontSize, History, LineHeight, ListItem, OrderedList, Paragraph,
  Text, TextAlign, TextColor, TextStyle,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { PasteCleanup } from './index.js';
import type { PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function mount(content: string, cleanup: PasteCleanupOptions | false = {}): Editor {
  const extensions: NonNullable<EditorOptions['extensions']> = [
    Document, Text, Paragraph, Bold, BulletList, OrderedList, ListItem, TextStyle, FontFamily, FontSize, TextColor,
    TextAlign, History,
  ];
  if (cleanup !== false) extensions.push(PasteCleanup.configure(cleanup));
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  return editor;
}

function copyAll(editor: Editor): string {
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
}

function paste(editor: Editor, html: string, text = 'Fallback'): void {
  editor.commands.selectAll();
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function textStyle(editor: Editor): Record<string, unknown> | undefined {
  let attrs: Record<string, unknown> | undefined;
  editor.state.doc.descendants(node => {
    attrs ??= node.marks.find(mark => mark.type.name === 'textStyle')?.attrs;
  });
  return attrs;
}

const styledSource = '<p style="text-align:center"><span style="font-family:Georgia;font-size:18px;color:#123456">Styled copy</span></p>';

describe('PasteCleanup own-copy recognition', () => {
  it('marks its own copies and recognizes a copy between two editors on one page in adapt', () => {
    const source = mount(styledSource);
    const copied = copyAll(source);
    expect(copied).toMatch(/^<p style="text-align: center;" data-domternal-copy="v1\.[A-Za-z0-9_-]{22}" data-pm-slice="0 0 \[\]">/);
    const target = mount('<p></p>', { formatting: 'adapt' });

    paste(target, copied);

    expect(target.getJSON()).toEqual(source.getJSON());
    expect(target.getHTML()).not.toContain('data-domternal-copy');
  });

  it('keeps a paragraph\'s normal line height that LineHeight writes when the host lists it, in both policies', () => {
    const mountSpacing = (content: string, formatting: 'preserve' | 'adapt'): Editor => {
      const editor = new Editor({ extensions: [Document, Text, Paragraph, LineHeight.configure({ lineHeights: [], defaultLineHeight: '1.5' }),
        PasteCleanup.configure({ formatting })], content });
      editors.push(editor);
      return editor;
    };
    for (const formatting of ['preserve', 'adapt'] as const) {
      const source = mountSpacing('<p style="line-height: normal">Single</p><p>Default</p>', formatting);
      expect(source.state.doc.firstChild?.attrs['lineHeight']).toBe('normal');
      const copied = copyAll(source);
      expect(copied).toContain('line-height: normal');
      const target = mountSpacing('<p></p>', formatting);

      paste(target, copied);

      expect(target.getJSON()).toEqual(source.getJSON());
    }
  });

  it('treats a copy from an editor without PasteCleanup as external content', () => {
    const source = mount(styledSource, false);
    const copied = copyAll(source);
    expect(copied).not.toContain('data-domternal-copy');
    const target = mount('<p></p>', { formatting: 'adapt' });

    paste(target, copied);

    expect(target.state.doc.textContent).toBe('Styled copy');
    expect(textStyle(target)).toBeUndefined();
    expect(target.state.doc.firstChild?.attrs['textAlign']).not.toBe('center');
  });

  it('treats a Tiptap-like slice as external rich HTML and keeps its structural context', () => {
    const target = mount('<p></p>', { formatting: 'adapt' });
    paste(target, '<p data-pm-slice="1 1 []" style="text-align:center"><span style="font-family:Comic Sans MS;font-size:30px;color:red">Foreign</span></p>');
    expect(target.state.doc.textContent).toBe('Foreign');
    expect(textStyle(target)).toBeUndefined();

    const preserved = mount('<p></p>');
    paste(preserved, '<li data-pm-slice=\'2 2 ["bulletList",null]\'><p>One</p></li><li><p>Two</p></li>');
    expect(preserved.getJSON()).toMatchObject({ type: 'doc', content: [{ type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
    ] }] });
  });

  it('treats a forged copy marker with an unknown nonce as external', () => {
    const target = mount('<p></p>', { formatting: 'adapt' });
    paste(target, '<p data-domternal-copy="v1.AAAAAAAAAAAAAAAAAAAAAA" data-pm-slice="0 0 []"><span style="font-family:Georgia;color:#123456">Forged</span></p>');
    expect(target.state.doc.textContent).toBe('Forged');
    expect(textStyle(target)).toBeUndefined();
  });

  it.each(['preserve', 'adapt'] as const)('keeps every root block when a nested marker would descend in %s', formatting => {
    const target = mount('<p></p>', { formatting });
    paste(target, '<p>Keep first</p><div><p>Also keep</p><p><span data-pm-slice="0 0 -1 []">x</span></p></div><p>Last</p>');
    const blocks: string[] = [];
    target.state.doc.forEach(node => { blocks.push(node.textContent); });
    expect(blocks).toEqual(['Keep first', 'Also keep', 'x', 'Last']);
  });

  it('reconstructs Word lists next to a deeply nested marker', () => {
    const target = mount('<p></p>');
    const item = (marker: string, text: string): string =>
      `<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${text}</p>`;
    paste(target, `${item('1.', 'One')}${item('2.', 'Two')}<div><div><div><span data-pm-slice="0 0 []"></span></div></div></div>`);
    expect(target.state.doc.firstChild?.type.name).toBe('orderedList');
    expect(target.state.doc.firstChild?.textContent).toBe('OneTwo');
  });
});
