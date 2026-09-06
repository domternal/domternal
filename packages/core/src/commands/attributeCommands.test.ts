import { describe, it, expect, afterEach } from 'vitest';
import { Schema } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Bold } from '../marks/Bold.js';
import { Link } from '../marks/Link.js';
import { Mark } from '../Mark.js';
import { Node } from '../Node.js';
import { OrderedList } from '../nodes/OrderedList.js';

/** A mark whose attributes declare ProseMirror validators. */
const Tone = Mark.create({
  name: 'tone',
  addAttributes: () => ({ tone: { default: 'calm', validate: 'string' }, level: { default: 1, validate: 'number' } }),
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

    it('judges only the values it sets, so a stored unknown marker does not block an unrelated change', () => {
      editor = new Editor({ extensions, content: '<ol><li><p>A</p></li></ol>' });
      // An unmigrated collaborative document binds such a value without validation.
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'listStyleType', 'bogus'));
      setSelection(editor, 3);
      expect(editor.can().updateAttributes('orderedList', { start: 3 })).toBe(true);
      expect(editor.commands.updateAttributes('orderedList', { start: 3 })).toBe(true);
      // normalizeContentAttributes, not an unrelated update, owns the stored value.
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ start: 3, listStyleType: 'bogus' });
      const before = editor.state.doc;
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: 'bogus' })).toBe(false);
      expect(editor.commands.updateAttributes('orderedList', { start: 4, listStyleType: 'upper-latin' })).toBe(false);
      expect(editor.state.doc).toBe(before);
      expect(editor.commands.updateAttributes('orderedList', { listStyleType: 'lower-alpha' })).toBe(true);
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

    it('judges only the mark values it sets, so a stored invalid value does not block an unrelated change', () => {
      editor = new Editor({ extensions, content: '<p><span data-tone="">Text</span></p>' });
      // Mark creation does not validate, so a document can hold a value its JSON would not load.
      editor.view.dispatch(editor.state.tr.addMark(1, 5, editor.schema.marks['tone']!.create({ tone: 5 })));
      setSelection(editor, 1, 5);
      const attrs = (): unknown => editor?.state.doc.firstChild?.firstChild?.marks[0]?.attrs;
      expect(editor.commands.updateAttributes('tone', { level: 2 })).toBe(true);
      expect(attrs()).toEqual({ tone: 5, level: 2 });
      expect(editor.commands.updateAttributes('tone', { level: 'high' })).toBe(false);
      expect(editor.commands.updateAttributes('tone', { tone: 6 })).toBe(false);
      expect(attrs()).toEqual({ tone: 5, level: 2 });
    });

    it('keeps valid stored values in place of defaults that fail their own validators', () => {
      // An extension attribute declared without a default gets an undefined one, which 'string' rejects.
      const Callout = Node.create({
        name: 'callout',
        group: 'block',
        content: 'paragraph+',
        addAttributes: () => ({
          kind: { validate: 'string', parseHTML: element => element.getAttribute('data-kind') },
          tone: { default: 'calm', validate: 'string' },
        }),
        parseHTML: () => [{ tag: 'aside' }],
        renderHTML: ({ HTMLAttributes }) => ['aside', HTMLAttributes, 0],
      });
      const Badge = Mark.create({
        name: 'badge',
        addAttributes: () => ({
          id: { default: null, validate: 'string', parseHTML: element => element.getAttribute('data-id') },
          level: { default: 1, validate: 'number' },
        }),
        parseHTML: () => [{ tag: 'span[data-id]' }],
        renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Callout, Badge],
        content: '<aside data-kind="note"><p><span data-id="x">A</span></p></aside>',
      });
      setSelection(editor, 2, 3);
      const mark = (): unknown => editor?.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.attrs;
      expect(editor.commands.updateAttributes('callout', { tone: 'warm' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs).toEqual({ kind: 'note', tone: 'warm' });
      expect(editor.commands.updateAttributes('badge', { level: 2 })).toBe(true);
      expect(mark()).toEqual({ id: 'x', level: 2 });
      expect(editor.schema.nodeFromJSON(editor.getJSON()).eq(editor.state.doc)).toBe(true);
      const before = editor.state.doc;
      expect(editor.commands.updateAttributes('callout', { kind: 7 })).toBe(false);
      expect(editor.commands.updateAttributes('badge', { id: null })).toBe(false);
      expect(editor.state.doc).toBe(before);
      // With both a failing stored value and a failing default, nothing valid can stand in.
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'kind', 9));
      expect(editor.commands.updateAttributes('callout', { tone: 'cool' })).toBe(false);
    });

    it('still ignores attributes the type does not declare', () => {
      editor = new Editor({ extensions, content: '<h1>Title</h1>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('heading', { level: 2, unknown: 'x' })).toBe(true);
      expect(editor.getHTML()).toBe('<h2>Title</h2>');
    });
  });

  describe('updateAttributes with required attributes', () => {
    // Node and Mark extensions always write a default, so a raw schema covers attributes without one.
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
        callout: {
          group: 'block',
          content: 'paragraph+',
          attrs: { kind: { validate: 'string' }, tone: { default: 'calm', validate: 'string' } },
          toDOM: () => ['aside', 0],
        },
        text: { group: 'inline' },
      },
      marks: {
        ref: {
          attrs: { id: { validate: 'string' }, label: { default: '', validate: 'string' } },
          toDOM: () => ['span', 0],
        },
      },
    });
    const content = {
      type: 'doc',
      content: [{
        type: 'callout',
        attrs: { kind: 'note' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A', marks: [{ type: 'ref', attrs: { id: 'a' } }] }] }],
      }],
    };

    it('keeps a required value it does not set, and judges only the values it sets', () => {
      editor = new Editor({ schema, content });
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'tone', 5));
      setSelection(editor, 2, 3);
      expect(editor.commands.updateAttributes('callout', { kind: 'tip' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs).toEqual({ kind: 'tip', tone: 5 });
      expect(editor.commands.updateAttributes('callout', { kind: 7 })).toBe(false);
      // A required attribute has no default to fall back to, so clearing it is refused rather than thrown.
      expect(editor.commands.updateAttributes('callout', { kind: undefined })).toBe(false);
      expect(editor.state.doc.firstChild?.attrs).toEqual({ kind: 'tip', tone: 5 });
    });

    it('judges a stored required value, since no default can stand in for it', () => {
      editor = new Editor({ schema, content });
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'kind', 9));
      setSelection(editor, 2, 3);
      expect(editor.commands.updateAttributes('callout', { tone: 'warm' })).toBe(false);
      expect(editor.commands.updateAttributes('callout', { kind: 'note', tone: 'warm' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs).toEqual({ kind: 'note', tone: 'warm' });
    });

    it('applies the same rule to marks with required attributes', () => {
      editor = new Editor({ schema, content });
      editor.view.dispatch(editor.state.tr.addMark(2, 3, schema.marks.ref.create({ id: 'a', label: 5 })));
      setSelection(editor, 2, 3);
      const attrs = (): unknown => editor?.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.attrs;
      expect(editor.commands.updateAttributes('ref', { id: 'b' })).toBe(true);
      expect(attrs()).toEqual({ id: 'b', label: 5 });
      expect(editor.commands.updateAttributes('ref', { id: 3 })).toBe(false);
      expect(editor.commands.updateAttributes('ref', { id: undefined })).toBe(false);
      expect(attrs()).toEqual({ id: 'b', label: 5 });
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
