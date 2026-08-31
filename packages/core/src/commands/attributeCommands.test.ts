import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Bold } from '../marks/Bold.js';
import { Link } from '../marks/Link.js';
import { Mark } from '../Mark.js';
import { OrderedList } from '../nodes/OrderedList.js';

/** A mark whose attribute declares a ProseMirror validator. */
const Tone = Mark.create({
  name: 'tone',
  addAttributes: () => ({ tone: { default: 'calm', validate: 'string' } }),
  parseHTML: () => [{ tag: 'span[data-tone]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', { 'data-tone': '', ...HTMLAttributes }, 0],
});
const extensions = [Document, Text, Paragraph, Heading, Bold, Link, OrderedList, Tone];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('attributeCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('updateAttributes', () => {
    it('updates heading level attribute', () => {
      editor = new Editor({ extensions, content: '<h1>Title</h1>' });
      setSelection(editor, 2);
      editor.commands.updateAttributes('heading', { level: 3 });
      expect(editor.getHTML()).toBe('<h3>Title</h3>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('fake', { x: 1 })).toBe(false);
    });

    it('updates mark attributes (link href)', () => {
      editor = new Editor({
        extensions,
        content: '<p><a href="https://old.com">Link</a></p>',
      });
      setSelection(editor, 1, 5);
      editor.commands.updateAttributes('link', { href: 'https://new.com' });
      expect(editor.getHTML()).toContain('href="https://new.com"');
    });

    it('returns false when no matching nodes in selection', () => {
      editor = new Editor({ extensions, content: '<p>No heading here</p>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('heading', { level: 2 })).toBe(false);
    });

    it('refuses node attributes that fail schema validation, matching toggleList', () => {
      editor = new Editor({ extensions, content: '<ol><li><p>A</p></li></ol><ol><li><p>B</p></li></ol>' });
      setSelection(editor, 3, editor.state.doc.content.size - 3);
      const before = editor.state.doc;
      expect(editor.can().updateAttributes('orderedList', { listStyleType: 'bogus' })).toBe(false);
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: 'bogus' })).toBe(false);
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: 7 })).toBe(false);
      expect(editor.state.doc).toBe(before);
      const markers = (): unknown[] => [0, 1].map(index => editor?.state.doc.child(index).attrs['listStyleType']);
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: 'upper-roman' })).toBe(true);
      expect(markers()).toEqual(['upper-roman', 'upper-roman']);
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: null })).toBe(true);
      expect(markers()).toEqual([null, null]);
    });

    it('judges the resulting attributes, so a stored unknown marker blocks other changes until it is replaced', () => {
      editor = new Editor({ extensions, content: '<ol><li><p>A</p></li></ol>' });
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'listStyleType', 'bogus'));
      setSelection(editor, 3);
      expect(editor.commands.updateAttributes('orderedList', { start: 3 })).toBe(false);
      expect(editor.commands.updateAttributes('orderedList', { start: 3, listStyleType: 'lower-alpha' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ start: 3, listStyleType: 'lower-alpha' });
    });

    it('refuses mark attributes that fail schema validation', () => {
      editor = new Editor({ extensions, content: '<p><span data-tone="">Text</span></p>' });
      setSelection(editor, 1, 5);
      expect(editor.commands.updateAttributes('tone', { tone: 5 })).toBe(false);
      expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs['tone']).toBe('calm');
      expect(editor.commands.updateAttributes('tone', { tone: 'warm' })).toBe(true);
      expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs['tone']).toBe('warm');
    });

    it('still ignores attributes the type does not declare', () => {
      editor = new Editor({ extensions, content: '<h1>Title</h1>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('heading', { level: 2, unknown: 'x' })).toBe(true);
      expect(editor.getHTML()).toBe('<h2>Title</h2>');
    });
  });

  describe('resetAttributes', () => {
    it('resets heading level to default', () => {
      editor = new Editor({ extensions, content: '<h3>Title</h3>' });
      setSelection(editor, 2);
      editor.commands.resetAttributes('heading', 'level');
      // Default level is 1
      expect(editor.getHTML()).toBe('<h1>Title</h1>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.resetAttributes('unknown', 'level')).toBe(false);
    });

    it('returns false when no matching nodes found', () => {
      editor = new Editor({ extensions, content: '<p>No heading</p>' });
      setSelection(editor, 2);
      expect(editor.commands.resetAttributes('heading', 'level')).toBe(false);
    });
  });
});
