import { describe, it, expect, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { ExtensionManager } from './ExtensionManager.js';
import { Extension } from './Extension.js';
import { Node } from './Node.js';
import { Mark } from './Mark.js';

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

// Mock editor for testing
const mockEditor = {
  schema: validSchema,
};

// Test extensions
const DocumentNode = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
});

const ParagraphNode = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML() {
    return [{ tag: 'p' }];
  },
  renderHTML() {
    return ['p', 0];
  },
});

const TextNode = Node.create({
  name: 'text',
  group: 'inline',
});

const BoldMark = Mark.create({
  name: 'bold',
  parseHTML() {
    return [{ tag: 'strong' }];
  },
  renderHTML() {
    return ['strong', 0];
  },
});

describe('ExtensionManager', () => {
  describe('constructor - schema mode (backward compatibility)', () => {
    it('creates instance with schema option', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(manager).toBeInstanceOf(ExtensionManager);
      expect(manager.schema).toBe(validSchema);
      expect(manager.extensions).toEqual([]);
    });

    it('returns the schema passed in options', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(manager.schema).toBe(validSchema);
      expect(manager.schema.nodes['doc']).toBeDefined();
      expect(manager.schema.nodes['paragraph']).toBeDefined();
      expect(manager.schema.nodes['text']).toBeDefined();
    });
  });

  describe('constructor - extensions mode', () => {
    it('creates instance with extensions', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode] },
        mockEditor
      );

      expect(manager).toBeInstanceOf(ExtensionManager);
      expect(manager.extensions.length).toBe(3);
    });

    it('throws error when neither schema nor extensions provided', () => {
      expect(() => {
        new ExtensionManager({}, mockEditor);
      }).toThrow('ExtensionManager requires either extensions or schema');
    });

    it('throws error for empty extensions array', () => {
      expect(() => {
        new ExtensionManager({ extensions: [] }, mockEditor);
      }).toThrow('ExtensionManager requires either extensions or schema');
    });

    it('builds schema from Node extensions', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode] },
        mockEditor
      );

      expect(manager.schema.nodes['doc']).toBeDefined();
      expect(manager.schema.nodes['paragraph']).toBeDefined();
      expect(manager.schema.nodes['text']).toBeDefined();
    });

    it('builds schema from Node and Mark extensions', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, BoldMark] },
        mockEditor
      );

      expect(manager.schema.nodes['doc']).toBeDefined();
      expect(manager.schema.marks['bold']).toBeDefined();
    });
  });

  describe('flattenExtensions', () => {
    it('flattens nested extensions from addExtensions()', () => {
      const NestedExtension = Extension.create({
        name: 'nested',
      });

      const BundleExtension = Extension.create({
        name: 'bundle',
        addExtensions() {
          return [NestedExtension];
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, BundleExtension] },
        mockEditor
      );

      const names = manager.extensions.map((e) => e.name);
      expect(names).toContain('bundle');
      expect(names).toContain('nested');
    });
  });

  describe('resolveExtensions (priority)', () => {
    it('sorts extensions by priority (higher first)', () => {
      const LowPriority = Extension.create({
        name: 'low',
        priority: 50,
      });

      const HighPriority = Extension.create({
        name: 'high',
        priority: 200,
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, LowPriority, HighPriority, ParagraphNode, TextNode] },
        mockEditor
      );

      const names = manager.extensions.map((e) => e.name);
      const highIndex = names.indexOf('high');
      const lowIndex = names.indexOf('low');

      expect(highIndex).toBeLessThan(lowIndex);
    });
  });

  describe('detectConflicts (AD-7)', () => {
    it('throws error for duplicate extension names', () => {
      const Ext1 = Extension.create({ name: 'duplicate' });
      const Ext2 = Extension.create({ name: 'duplicate' });

      expect(() => {
        new ExtensionManager(
          { extensions: [DocumentNode, ParagraphNode, TextNode, Ext1, Ext2] },
          mockEditor
        );
      }).toThrow('Extension name conflict: "duplicate"');
    });
  });

  describe('checkDependencies', () => {
    it('throws error when dependency is missing', () => {
      const DependentExt = Extension.create({
        name: 'dependent',
        dependencies: ['missingDep'],
      });

      expect(() => {
        new ExtensionManager(
          { extensions: [DocumentNode, ParagraphNode, TextNode, DependentExt] },
          mockEditor
        );
      }).toThrow('Extension "dependent" requires "missingDep" extension');
    });

    it('passes when all dependencies are present', () => {
      const RequiredExt = Extension.create({ name: 'required' });
      const DependentExt = Extension.create({
        name: 'dependent',
        dependencies: ['required'],
      });

      expect(() => {
        new ExtensionManager(
          { extensions: [DocumentNode, ParagraphNode, TextNode, RequiredExt, DependentExt] },
          mockEditor
        );
      }).not.toThrow();
    });
  });

  describe('storage', () => {
    it('initializes storage from addStorage()', () => {
      const ExtWithStorage = Extension.create({
        name: 'withStorage',
        addStorage() {
          return { count: 0, items: [] };
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtWithStorage] },
        mockEditor
      );

      expect(manager.storage['withStorage']).toEqual({ count: 0, items: [] });
    });

    it('sets storage on extension instance', () => {
      const ExtWithStorage = Extension.create({
        name: 'withStorage',
        addStorage() {
          return { value: 42 };
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtWithStorage] },
        mockEditor
      );

      const ext = manager.extensions.find((e) => e.name === 'withStorage') as Extension;
      expect(ext.storage).toEqual({ value: 42 });
    });
  });

  describe('plugins', () => {
    it('returns empty array (Step 2.4.5 TODO)', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(manager.plugins).toEqual([]);
      expect(Array.isArray(manager.plugins)).toBe(true);
    });
  });

  describe('validateSchema', () => {
    it('does not throw for valid schema', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(() => {
        manager.validateSchema();
      }).not.toThrow();
    });

    it('throws error for schema without doc node', () => {
      const manager = new ExtensionManager(
        { schema: schemaWithoutDoc },
        { schema: schemaWithoutDoc }
      );

      expect(() => {
        manager.validateSchema();
      }).toThrow('Invalid schema: missing required "doc" node');
    });

    it('throws error after destroy', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);
      manager.destroy();

      expect(() => {
        manager.validateSchema();
      }).toThrow('ExtensionManager has been destroyed');
    });
  });

  describe('destroy', () => {
    it('can be called without error', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(() => {
        manager.destroy();
      }).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      manager.destroy();
      expect(() => {
        manager.destroy();
      }).not.toThrow();
    });

    it('calls onDestroy on all extensions', () => {
      const onDestroySpy = vi.fn();
      const ExtWithDestroy = Extension.create({
        name: 'withDestroy',
        onDestroy: onDestroySpy,
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtWithDestroy] },
        mockEditor
      );

      manager.destroy();
      expect(onDestroySpy).toHaveBeenCalledTimes(1);
    });
  });
});
