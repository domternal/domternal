/**
 * Minimal ProseMirror schema for testing
 *
 * Contains only essential nodes and marks:
 * - doc: root node
 * - paragraph: block node
 * - text: inline text
 * - bold: mark for testing mark functionality
 */
import { Schema } from 'prosemirror-model';

/**
 * Minimal test schema with doc, paragraph, text, and bold mark
 */
export const testSchema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
    },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0];
      },
    },
    text: {
      group: 'inline',
    },
  },
  marks: {
    bold: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        {
          style: 'font-weight',
          getAttrs: (value) =>
            /^(bold|[5-9]\d{2,})$/.test(value as string) && null,
        },
      ],
      toDOM() {
        return ['strong', 0];
      },
    },
  },
});

/**
 * Empty document for testing
 */
export const emptyDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Simple document with text for testing
 */
export const simpleDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ],
};

/**
 * Document with bold text for testing marks
 */
export const boldDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        {
          type: 'text',
          text: 'bold',
          marks: [{ type: 'bold' }],
        },
        { type: 'text', text: ' world' },
      ],
    },
  ],
};

/**
 * HTML content equivalents for testing HTML parsing
 */
export const testHTML = {
  empty: '<p></p>',
  simple: '<p>Hello world</p>',
  bold: '<p>Hello <strong>bold</strong> world</p>',
  multiParagraph: '<p>First paragraph</p><p>Second paragraph</p>',
};
