/**
 * ExtensionManager tests
 *
 * ESLint rules disabled for testing patterns that require flexible typing.
 */
/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/only-throw-error */
import { describe, it, expect, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
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

  describe('deduplicateExtensions', () => {
    it('keeps last occurrence when duplicate names exist', () => {
      const Ext1 = Extension.create({ name: 'duplicate', priority: 50 });
      const Ext2 = Extension.create({ name: 'duplicate', priority: 200 });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, Ext1, Ext2] },
        mockEditor
      );

      const dupes = manager.extensions.filter((e) => e.name === 'duplicate');
      expect(dupes).toHaveLength(1);
      expect((dupes[0] as Extension).config.priority).toBe(200);
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
    it('returns empty array in schema mode', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      expect(manager.plugins).toEqual([]);
      expect(Array.isArray(manager.plugins)).toBe(true);
    });

    it('collects keyboard shortcuts into keymap plugin', () => {
      const ExtWithShortcuts = Extension.create({
        name: 'shortcuts',
        addKeyboardShortcuts() {
          return {
            'Mod-b': () => true,
          };
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtWithShortcuts] },
        mockEditor
      );

      expect(manager.plugins.length).toBeGreaterThanOrEqual(1);
    });

    it('collects custom plugins from extensions', () => {
      const mockPlugin = { key: { key: 'test' } } as unknown as Plugin;
      const ExtWithPlugin = Extension.create({
        name: 'withPlugin',
        addProseMirrorPlugins() {
          return [mockPlugin];
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtWithPlugin] },
        mockEditor
      );

      expect(manager.plugins).toContain(mockPlugin);
    });

    it('caches plugins after first call', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode] },
        mockEditor
      );

      const plugins1 = manager.plugins;
      const plugins2 = manager.plugins;

      expect(plugins1).toBe(plugins2);
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

  describe('safeCall (2.7: Extension Error Isolation)', () => {
    it('returns result on successful execution', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      const result = manager.safeCall(() => 42, 'test.context');
      expect(result).toBe(42);
    });

    it('returns undefined on error', () => {
      const manager = new ExtensionManager({ schema: validSchema }, mockEditor);

      const result = manager.safeCall(() => {
        throw new Error('Test error');
      }, 'test.context');

      expect(result).toBeUndefined();
    });

    it('emits error event when error occurs', () => {
      const emit = vi.fn();
      const editorWithEmit = {
        schema: validSchema,
        emit,
      };

      const manager = new ExtensionManager({ schema: validSchema }, editorWithEmit);

      manager.safeCall(() => {
        throw new Error('Test error');
      }, 'TestExt.addCommands');

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('error', {
        error: expect.any(Error),
        context: 'TestExt.addCommands',
      });
    });

    it('converts non-Error throws to Error', () => {
      const emit = vi.fn();
      const editorWithEmit = {
        schema: validSchema,
        emit,
      };

      const manager = new ExtensionManager({ schema: validSchema }, editorWithEmit);

      manager.safeCall(() => {
        throw 'string error';
      }, 'test.context');

      expect(emit).toHaveBeenCalledWith('error', {
        error: expect.objectContaining({ message: 'string error' }),
        context: 'test.context',
      });
    });
  });

  describe('addExtensions auto-include (TextStyle pattern)', () => {
    const ChildMark = Mark.create({
      name: 'childMark',
      parseHTML() { return [{ tag: 'span.child' }]; },
      renderHTML() { return ['span', { class: 'child' }, 0]; },
    });

    const ParentExtension = Extension.create({
      name: 'parent',
      addExtensions() {
        return [ChildMark];
      },
    });

    it('extension auto-includes a mark via addExtensions()', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ParentExtension] },
        mockEditor,
      );

      const names = manager.extensions.map((e) => e.name);
      expect(names).toContain('parent');
      expect(names).toContain('childMark');
      expect(manager.schema.marks['childMark']).toBeDefined();
    });

    it('deduplicates when child mark is also provided explicitly', () => {
      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ChildMark, ParentExtension] },
        mockEditor,
      );

      const childCount = manager.extensions.filter((e) => e.name === 'childMark').length;
      expect(childCount).toBe(1);
      expect(manager.schema.marks['childMark']).toBeDefined();
    });

    it('multiple parents sharing same child produce only one instance', () => {
      const Parent2 = Extension.create({
        name: 'parent2',
        addExtensions() {
          return [ChildMark];
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ParentExtension, Parent2] },
        mockEditor,
      );

      const childCount = manager.extensions.filter((e) => e.name === 'childMark').length;
      expect(childCount).toBe(1);
      expect(manager.schema.marks['childMark']).toBeDefined();
    });
  });

  describe('error isolation in extension lifecycle', () => {
    it('continues processing other extensions after one throws in addCommands', () => {
      const ExtThatThrows = Extension.create({
        name: 'throws',
        addCommands() {
          throw new Error('Commands error');
        },
      });

      const ExtWithCommands = Extension.create({
        name: 'works',
        addCommands() {
          return {
            testCommand:
              () =>
              (): boolean =>
                true,
          };
        },
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtThatThrows, ExtWithCommands] },
        mockEditor
      );

      // ExtThatThrows should not crash, and ExtWithCommands should work
      expect(manager.commands['testCommand']).toBeDefined();
    });

    it('continues processing other extensions after one throws in onDestroy', () => {
      const onDestroySpy = vi.fn();

      const ExtThatThrows = Extension.create({
        name: 'throws',
        onDestroy() {
          throw new Error('Destroy error');
        },
      });

      const ExtWithDestroy = Extension.create({
        name: 'works',
        onDestroy: onDestroySpy,
      });

      const manager = new ExtensionManager(
        { extensions: [DocumentNode, ParagraphNode, TextNode, ExtThatThrows, ExtWithDestroy] },
        mockEditor
      );

      // Should not throw, and should call both onDestroy handlers
      expect(() => { manager.destroy(); }).not.toThrow();
      expect(onDestroySpy).toHaveBeenCalledTimes(1);
    });
  });
});
