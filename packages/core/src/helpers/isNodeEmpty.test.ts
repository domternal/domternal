import { describe, it, expect } from 'vitest';
import { Schema, Node as PMNode } from 'prosemirror-model';
import { isNodeEmpty, isDocumentEmpty } from './isNodeEmpty.js';

// Test schema with various node types
const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    hardBreak: {
      group: 'inline',
      inline: true,
      selectable: false,
    },
    image: {
      group: 'inline',
      inline: true,
      attrs: { src: {} },
    },
    horizontalRule: {
      group: 'block',
    },
    text: { group: 'inline' },
  },
});

// Helper to create nodes from JSON
function createNode(json: Record<string, unknown>): PMNode {
  return PMNode.fromJSON(testSchema, json);
}

describe('isNodeEmpty', () => {
  describe('text nodes', () => {
    // Note: ProseMirror doesn't allow creating empty text nodes (throws RangeError)
    // So we only test non-empty text nodes

    it('returns false for text node with content', () => {
      const node = testSchema.text('Hello');
      expect(isNodeEmpty(node)).toBe(false);
    });

    it('returns false for text node with whitespace', () => {
      const node = testSchema.text('   ');
      expect(isNodeEmpty(node)).toBe(false);
    });
  });

  describe('paragraph nodes', () => {
    it('returns true for empty paragraph', () => {
      const node = createNode({ type: 'paragraph' });
      expect(isNodeEmpty(node)).toBe(true);
    });

    it('returns false for paragraph with text', () => {
      const node = createNode({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello' }],
      });
      expect(isNodeEmpty(node)).toBe(false);
    });

    it('returns true for paragraph with only hardBreak (ignoreHardBreaks: true)', () => {
      const node = createNode({
        type: 'paragraph',
        content: [{ type: 'hardBreak' }],
      });
      expect(isNodeEmpty(node, { ignoreHardBreaks: true })).toBe(true);
    });

    it('returns false for paragraph with only hardBreak (ignoreHardBreaks: false)', () => {
      const node = createNode({
        type: 'paragraph',
        content: [{ type: 'hardBreak' }],
      });
      expect(isNodeEmpty(node, { ignoreHardBreaks: false })).toBe(false);
    });
  });

  describe('document nodes', () => {
    it('returns true for doc with empty paragraph', () => {
      const node = createNode({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      });
      expect(isNodeEmpty(node)).toBe(true);
    });

    it('returns false for doc with text content', () => {
      const node = createNode({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      });
      expect(isNodeEmpty(node)).toBe(false);
    });

    it('returns true for doc with multiple empty paragraphs', () => {
      const node = createNode({
        type: 'doc',
        content: [{ type: 'paragraph' }, { type: 'paragraph' }],
      });
      expect(isNodeEmpty(node)).toBe(true);
    });

    it('returns false for doc with one non-empty paragraph', () => {
      const node = createNode({
        type: 'doc',
        content: [
          { type: 'paragraph' },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      });
      expect(isNodeEmpty(node)).toBe(false);
    });
  });

  describe('leaf nodes', () => {
    it('returns false for horizontalRule (non-empty leaf)', () => {
      const node = createNode({ type: 'horizontalRule' });
      expect(isNodeEmpty(node)).toBe(false);
    });

    it('returns false for image node', () => {
      const node = createNode({
        type: 'image',
        attrs: { src: 'test.jpg' },
      });
      expect(isNodeEmpty(node)).toBe(false);
    });
  });

  describe('checkChildren option', () => {
    it('returns false when checkChildren is false and has children', () => {
      const node = createNode({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      });
      expect(isNodeEmpty(node, { checkChildren: false })).toBe(false);
    });

    it('returns true when checkChildren is false and no children', () => {
      // Create a node that can have no children
      const node = createNode({ type: 'paragraph' });
      expect(isNodeEmpty(node, { checkChildren: false })).toBe(true);
    });
  });

  describe('default options', () => {
    it('uses checkChildren: true by default', () => {
      const node = createNode({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      });
      // Default should check children, so empty paragraph = empty doc
      expect(isNodeEmpty(node)).toBe(true);
    });

    it('uses ignoreHardBreaks: true by default', () => {
      const node = createNode({
        type: 'paragraph',
        content: [{ type: 'hardBreak' }],
      });
      expect(isNodeEmpty(node)).toBe(true);
    });
  });
});

describe('isDocumentEmpty', () => {
  it('returns true for empty document', () => {
    const doc = createNode({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(isDocumentEmpty(doc)).toBe(true);
  });

  it('returns false for document with content', () => {
    const doc = createNode({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });
    expect(isDocumentEmpty(doc)).toBe(false);
  });

  it('returns true for document with only hardBreaks', () => {
    const doc = createNode({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'hardBreak' }],
        },
      ],
    });
    expect(isDocumentEmpty(doc)).toBe(true);
  });
});
