/**
 * setMark judges the attributes it sets before applying them, also in dry-run
 * can() calls, which the toolbar makes for every style item on every
 * transaction. The given values are judged once; only a mark type whose
 * schema validates attributes, or requires one without a default, is judged
 * per text node, once for each distinct stored value.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Schema } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Bold } from '../marks/Bold.js';
import { Link } from '../marks/Link.js';
import { TextStyle } from '../marks/TextStyle.js';
import { TextColor } from '../extensions/TextColor.js';
import { FontSize } from '../extensions/FontSize.js';
import type { JSONContent } from '../types/Content.js';

const extensions = [Document, Text, Paragraph, Bold, Link, TextStyle, TextColor, FontSize];

/** Paragraphs of three text nodes each: plain, bold and plain. */
function paragraphs(count: number, link?: (index: number) => string | null): JSONContent {
  return {
    type: 'doc',
    content: Array.from({ length: count }, (_, index) => {
      const href = link?.(index) ?? null;
      return {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain words ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' tail', ...(href !== null && { marks: [{ type: 'link', attrs: { href } }] }) },
        ],
      };
    }),
  };
}

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; vi.restoreAllMocks(); });

describe('setMark attribute judging', () => {
  it('judges the given values once for a mark type without validators, however many text nodes are selected', () => {
    editor = new Editor({ extensions, content: paragraphs(500) });
    editor.commands.selectAll();
    const markFromJSON = vi.spyOn(editor.schema, 'markFromJSON');
    expect(editor.can().setTextColor('#ff0000')).toBe(true);
    expect(editor.can().setFontSize('18px')).toBe(true);
    expect(editor.can().setMark('textStyle', { color: 'red', fontSize: '12px' })).toBe(true);
    expect(markFromJSON.mock.calls.length).toBeLessThanOrEqual(3);
    expect(editor.commands.setTextColor('#00ff00')).toBe(true);
    let colored = 0;
    editor.state.doc.descendants(node => { if (node.marks.some(mark => mark.attrs['color'] === '#00ff00')) colored++; });
    expect(colored).toBe(1500);
  });

  it('judges a validated mark once for each distinct stored value, not once per text node', () => {
    editor = new Editor({ extensions, content: paragraphs(500, index => (index % 2 === 0 ? 'https://a.example/' : null)) });
    editor.commands.selectAll();
    const markFromJSON = vi.spyOn(editor.schema, 'markFromJSON');
    expect(editor.can().setMark('link', { href: 'https://ok.example/' })).toBe(true);
    // Text without a link once, and the 250 equal stored link marks once.
    expect(markFromJSON.mock.calls.length).toBeLessThanOrEqual(2);
    markFromJSON.mockClear();
    expect(editor.can().setMark('link', { href: 'javascript:alert(1)' })).toBe(false);
    expect(editor.can().setMark('link', { href: ['https://ok.example/'] })).toBe(false);
    expect(markFromJSON.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('still judges each distinct stored value of a mark with a required attribute', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
        text: {},
      },
      marks: {
        ref: { attrs: { id: { validate: 'string' }, label: { default: '', validate: 'string' } }, toDOM: () => ['span', 0] },
      },
    });
    const content = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A', marks: [{ type: 'ref', attrs: { id: 'a' } }] }, { type: 'text', text: 'B', marks: [{ type: 'ref', attrs: { id: 'b' } }] }] },
    ] };
    editor = new Editor({ schema, content });
    const select = (): void => { editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(editor!.state.doc, 1, 3))); };
    select();
    expect(editor.can().setMark('ref', { label: 'x' })).toBe(true);
    // A stored required value that fails validation has no default to stand in.
    editor.view.dispatch(editor.state.tr.addMark(2, 3, schema.marks.ref.create({ id: 9 })));
    select();
    expect(editor.can().setMark('ref', { label: 'x' })).toBe(false);
    expect(editor.can().setMark('ref', { id: 'c', label: 'x' })).toBe(true);
    expect(editor.can().setMark('ref', { label: 5 })).toBe(false);
  });
});
