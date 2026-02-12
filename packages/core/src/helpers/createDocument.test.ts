import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { createDocument } from './createDocument.js';

// Minimal test schema
const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0];
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM() {
        return ['strong', 0];
      },
    },
  },
});

describe('createDocument', () => {
  describe('null/undefined content', () => {
    it('creates empty document for null content', () => {
      const doc = createDocument(null, testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
      expect(doc.firstChild?.childCount).toBe(0);
    });

    it('creates empty document for undefined content', () => {
      const doc = createDocument(undefined, testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('JSON content', () => {
    it('parses JSON content with type property', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      };

      const doc = createDocument(json, testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
      expect(doc.textContent).toBe('Hello world');
    });

    it('parses JSON content with marks', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      };

      const doc = createDocument(json, testSchema);

      expect(doc.textContent).toBe('Hello bold');
      // Check that the second text node has bold mark
      const paragraph = doc.firstChild;
      if (!paragraph) throw new Error('Expected paragraph');
      const boldText = paragraph.child(1);
      expect(boldText.marks.length).toBe(1);
      expect(boldText.marks[0]?.type.name).toBe('bold');
    });

    it('parses empty doc JSON', () => {
      const json = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      };

      const doc = createDocument(json, testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
    });
  });

  describe('HTML content', () => {
    it('parses simple HTML paragraph', () => {
      const doc = createDocument('<p>Hello world</p>', testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.textContent).toBe('Hello world');
    });

    it('parses HTML with marks', () => {
      const doc = createDocument('<p>Hello <strong>bold</strong></p>', testSchema);

      expect(doc.textContent).toBe('Hello bold');
    });

    it('parses multiple paragraphs', () => {
      const doc = createDocument(
        '<p>First</p><p>Second</p>',
        testSchema
      );

      expect(doc.childCount).toBe(2);
      expect(doc.child(0).textContent).toBe('First');
      expect(doc.child(1).textContent).toBe('Second');
    });

    it('handles HTML with whitespace', () => {
      const doc = createDocument('  <p>Hello</p>  ', testSchema);

      expect(doc.textContent).toBe('Hello');
    });

    it('handles empty paragraph HTML', () => {
      const doc = createDocument('<p></p>', testSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('empty document fallback (no paragraph type)', () => {
    it('uses first block type when paragraph is not available', () => {
      const noParagraphSchema = new Schema({
        nodes: {
          doc: { content: 'block+' },
          heading: {
            group: 'block',
            content: 'inline*',
            attrs: { level: { default: 1 } },
            parseDOM: [{ tag: 'h1' }],
            toDOM() {
              return ['h1', 0];
            },
          },
          text: { group: 'inline' },
        },
      });

      const doc = createDocument(null, noParagraphSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('heading');
    });

    it('creates empty doc when no block types exist', () => {
      const minimalSchema = new Schema({
        nodes: {
          doc: { content: 'text*' },
          text: {},
        },
      });

      const doc = createDocument(null, minimalSchema);

      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(0);
    });
  });

  describe('invalid content', () => {
    it('throws error for plain text (no HTML tags)', () => {
      expect(() => {
        createDocument('Hello world', testSchema);
      }).toThrow('Invalid content format: plain text is not supported');
    });

    it('creates empty document for empty string', () => {
      const doc = createDocument('', testSchema);
      expect(doc.type.name).toBe('doc');
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });

    it('throws error for whitespace-only string', () => {
      expect(() => {
        createDocument('   ', testSchema);
      }).toThrow('Invalid content format: plain text is not supported');
    });

    it('throws error for object without type property', () => {
      expect(() => {
        createDocument({ content: [] } as never, testSchema);
      }).toThrow('Invalid content format');
    });

    it('throws error for array content', () => {
      expect(() => {
        createDocument([] as never, testSchema);
      }).toThrow('Invalid content format');
    });

    it('throws error for number content', () => {
      expect(() => {
        createDocument(123 as never, testSchema);
      }).toThrow('Invalid content format');
    });
  });
});
