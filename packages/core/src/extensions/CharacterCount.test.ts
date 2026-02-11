/**
 * Tests for CharacterCount extension
 *
 * Tests the storage functions and limit enforcement.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { CharacterCount, characterCountPluginKey } from './CharacterCount.js';
import type { CharacterCountStorage } from './CharacterCount.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

// Create a simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
});

// Helper to create editor state with content
function createState(text: string): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({ schema, doc });
}

describe('CharacterCount', () => {
  describe('extension creation', () => {
    it('creates extension with default options', () => {
      const ext = CharacterCount;

      expect(ext.name).toBe('characterCount');
      expect(ext.config.addOptions).toBeDefined();
    });

    it('can configure with custom options', () => {
      const ext = CharacterCount.configure({
        limit: 100,
        wordLimit: 20,
        mode: 'nodeSize',
      });

      expect(ext.name).toBe('characterCount');
    });
  });

  describe('plugin creation', () => {
    it('creates no plugin when no limits set', () => {
      const ext = CharacterCount.configure({
        limit: null,
        wordLimit: null,
      });

      // Get plugins from extension
      const plugins = ext.config.addProseMirrorPlugins?.call({
        options: { limit: null, wordLimit: null, mode: 'textSize' },
        editor: null,
        name: 'characterCount',
        storage: {},
      } as never);

      expect(plugins).toHaveLength(0);
    });

    it('creates plugin when character limit set', () => {
      const ext = CharacterCount.configure({
        limit: 100,
      });

      const plugins = ext.config.addProseMirrorPlugins?.call({
        options: { limit: 100, wordLimit: null, mode: 'textSize' },
        editor: null,
        name: 'characterCount',
        storage: {},
      } as never);

      expect(plugins).toHaveLength(1);
    });

    it('creates plugin when word limit set', () => {
      const ext = CharacterCount.configure({
        wordLimit: 50,
      });

      const plugins = ext.config.addProseMirrorPlugins?.call({
        options: { limit: null, wordLimit: 50, mode: 'textSize' },
        editor: null,
        name: 'characterCount',
        storage: {},
      } as never);

      expect(plugins).toHaveLength(1);
    });
  });

  describe('filterTransaction', () => {
    it('allows transaction under character limit', () => {
      const plugins = CharacterCount.configure({ limit: 100 }).config
        .addProseMirrorPlugins?.call({
          options: { limit: 100, wordLimit: null, mode: 'textSize' },
          editor: null,
          name: 'characterCount',
          storage: {},
        } as never);

      const plugin = plugins?.[0];
      expect(plugin).toBeDefined();

      const state = createState('Hello');
      const tr = state.tr.insertText(' world', 6);

      // Get filterTransaction from plugin spec
       
      const filterFn = (plugin as any).spec?.filterTransaction as
        | ((tr: unknown) => boolean)
        | undefined;
      if (filterFn) {
        const result = filterFn(tr);
        expect(result).toBe(true);
      }
    });

    it('blocks transaction exceeding character limit', () => {
      const plugins = CharacterCount.configure({ limit: 10 }).config
        .addProseMirrorPlugins?.call({
          options: { limit: 10, wordLimit: null, mode: 'textSize' },
          editor: null,
          name: 'characterCount',
          storage: {},
        } as never);

      const plugin = plugins?.[0];
      const state = createState('Hello');
      const tr = state.tr.insertText(' world!!!!', 6); // Would exceed 10 chars

       
      const filterFn = (plugin as any).spec?.filterTransaction as
        | ((tr: unknown) => boolean)
        | undefined;
      if (filterFn) {
        const result = filterFn(tr);
        expect(result).toBe(false);
      }
    });

    it('allows non-document-changing transactions', () => {
      const plugins = CharacterCount.configure({ limit: 5 }).config
        .addProseMirrorPlugins?.call({
          options: { limit: 5, wordLimit: null, mode: 'textSize' },
          editor: null,
          name: 'characterCount',
          storage: {},
        } as never);

      const plugin = plugins?.[0];
      const state = createState('Hello');

      // Selection-only transaction
      const tr = state.tr.setSelection(state.selection);

       
      const filterFn = (plugin as any).spec?.filterTransaction as
        | ((tr: unknown) => boolean)
        | undefined;
      if (filterFn) {
        const result = filterFn(tr);
        expect(result).toBe(true);
      }
    });

    it('blocks transaction exceeding word limit', () => {
      const plugins = CharacterCount.configure({ wordLimit: 3 }).config
        .addProseMirrorPlugins?.call({
          options: { limit: null, wordLimit: 3, mode: 'textSize' },
          editor: null,
          name: 'characterCount',
          storage: {},
        } as never);

      const plugin = plugins?.[0];
      const state = createState('one two');
      const tr = state.tr.insertText(' three four', 7); // Would have 4 words

       
      const filterFn = (plugin as any).spec?.filterTransaction as
        | ((tr: unknown) => boolean)
        | undefined;
      if (filterFn) {
        const result = filterFn(tr);
        expect(result).toBe(false);
      }
    });
  });

  describe('storage functions', () => {
    it('initializes storage with placeholder functions', () => {
      const storage = CharacterCount.config.addStorage?.call({
        options: { limit: null, wordLimit: null, mode: 'textSize' },
      } as never);

      expect(storage).toBeDefined();
      expect(typeof storage?.characters).toBe('function');
      expect(typeof storage?.words).toBe('function');
      expect(typeof storage?.percentage).toBe('function');
      expect(typeof storage?.remaining).toBe('function');
      expect(typeof storage?.isLimitExceeded).toBe('function');
    });

    it('storage placeholder functions return defaults', () => {
      const storage = CharacterCount.config.addStorage?.call({
        options: { limit: null, wordLimit: null, mode: 'textSize' },
      } as never);

      expect(storage?.characters()).toBe(0);
      expect(storage?.words()).toBe(0);
      expect(storage?.percentage()).toBe(0);
      expect(storage?.remaining()).toBe(Infinity);
      expect(storage?.isLimitExceeded()).toBe(false);
    });
  });
});

describe('characterCountPluginKey', () => {
  it('is defined', () => {
    expect(characterCountPluginKey).toBeDefined();
  });
});

describe('CharacterCount integration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('characters() returns text character count', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p>Hello world</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.characters()).toBe(11);
  });

  it('words() returns word count', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p>Hello world foo</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.words()).toBe(3);
  });

  it('words() returns 0 for empty doc', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p></p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.words()).toBe(0);
  });

  it('percentage() returns 0 when no limit', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.percentage()).toBe(0);
  });

  it('percentage() returns percentage when limit set', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ limit: 20 })],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.percentage()).toBe(25);
  });

  it('remaining() returns Infinity when no limit', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.remaining()).toBe(Infinity);
  });

  it('remaining() returns remaining chars when limit set', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ limit: 10 })],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.remaining()).toBe(5);
  });

  it('isLimitExceeded() returns false when under limit', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ limit: 100 })],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.isLimitExceeded()).toBe(false);
  });

  it('isLimitExceeded() returns false when no limit', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount],
      content: '<p>Hello</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    expect(storage.isLimitExceeded()).toBe(false);
  });

  it('nodeSize mode returns doc.nodeSize', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ mode: 'nodeSize' })],
      content: '<p>Hi</p>',
    });
    const storage = editor.storage['characterCount'] as CharacterCountStorage;
    // nodeSize includes structural characters
    expect(storage.characters()).toBe(editor.state.doc.nodeSize);
  });

  it('character limit blocks insertion', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ limit: 5 })],
      content: '<p>Hello</p>',
    });
    // Try to insert beyond limit - the filterTransaction should block it
    const tr = editor.state.tr.insertText(' world', 6);
    editor.view.dispatch(tr);
    // Content should remain unchanged (blocked by filterTransaction)
    expect(editor.getText()).toBe('Hello');
  });

  it('word limit blocks insertion', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CharacterCount.configure({ wordLimit: 2 })],
      content: '<p>hello world</p>',
    });
    // Try to add a third word
    const tr = editor.state.tr.insertText(' extra', 12);
    editor.view.dispatch(tr);
    // Should be blocked
    expect(editor.getText()).toBe('hello world');
  });
});
