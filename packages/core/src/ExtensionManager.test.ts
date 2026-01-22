import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { ExtensionManager } from './ExtensionManager.js';

// Valid test schema with required nodes
const validSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
    },
    text: { group: 'inline' },
  },
});

// Invalid schema missing 'doc' node
const schemaWithoutDoc = new Schema({
  nodes: {
    paragraph: {
      content: 'inline*',
      toDOM() {
        return ['p', 0];
      },
    },
    text: { group: 'inline' },
  },
  topNode: 'paragraph',
});

// Note: ProseMirror enforces 'text' node at schema creation time,
// so we can't create a schema without it for testing.
// The validateSchema check for 'text' is a defensive measure.

// Mock editor for testing
const mockEditor = {
  schema: validSchema,
};

describe('ExtensionManager', () => {
  describe('constructor', () => {
    it('creates instance with schema and editor', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      expect(manager).toBeInstanceOf(ExtensionManager);
      expect(manager.schema).toBe(validSchema);
    });
  });

  describe('schema', () => {
    it('returns the schema passed to constructor', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      expect(manager.schema).toBe(validSchema);
      expect(manager.schema.nodes['doc']).toBeDefined();
      expect(manager.schema.nodes['paragraph']).toBeDefined();
      expect(manager.schema.nodes['text']).toBeDefined();
    });
  });

  describe('plugins', () => {
    it('returns empty array in Step 1.3 (no extensions)', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      expect(manager.plugins).toEqual([]);
      expect(Array.isArray(manager.plugins)).toBe(true);
    });
  });

  describe('validateSchema', () => {
    it('does not throw for valid schema', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      expect(() => manager.validateSchema()).not.toThrow();
    });

    it('throws error for schema without doc node', () => {
      const manager = new ExtensionManager(schemaWithoutDoc, {
        schema: schemaWithoutDoc,
      });

      expect(() => manager.validateSchema()).toThrow(
        'Invalid schema: missing required "doc" node'
      );
    });

    // Note: Can't test missing 'text' node because ProseMirror
    // enforces it at schema creation time (throws RangeError)

    it('throws error after destroy', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);
      manager.destroy();

      expect(() => manager.validateSchema()).toThrow(
        'ExtensionManager has been destroyed'
      );
    });
  });

  describe('destroy', () => {
    it('can be called without error', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      expect(() => manager.destroy()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      const manager = new ExtensionManager(validSchema, mockEditor);

      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });
  });
});
