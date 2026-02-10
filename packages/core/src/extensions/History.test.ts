import { describe, it, expect, afterEach } from 'vitest';
import { History } from './History.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

const extensions = [Document, Text, Paragraph, History];

describe('History', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(History.name).toBe('history');
    });

    it('is an extension type', () => {
      expect(History.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = History.config.addOptions?.call(History);
      expect(opts).toEqual({ depth: 100, newGroupDelay: 500 });
    });

    it('can configure depth', () => {
      const custom = History.configure({ depth: 50 });
      expect(custom.options.depth).toBe(50);
    });

    it('can configure newGroupDelay', () => {
      const custom = History.configure({ newGroupDelay: 1000 });
      expect(custom.options.newGroupDelay).toBe(1000);
    });
  });

  describe('addCommands', () => {
    it('provides undo and redo commands', () => {
      const commands = History.config.addCommands?.call(History);
      expect(commands).toHaveProperty('undo');
      expect(commands).toHaveProperty('redo');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-z, Mod-Shift-z, and Mod-y shortcuts', () => {
      const shortcuts = History.config.addKeyboardShortcuts?.call(History);
      expect(shortcuts).toHaveProperty('Mod-z');
      expect(shortcuts).toHaveProperty('Mod-Shift-z');
      expect(shortcuts).toHaveProperty('Mod-y');
    });

    it('shortcuts return false when no editor', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shortcuts = History.config.addKeyboardShortcuts?.call({
        ...History, editor: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as Record<string, any> | undefined;
      expect(shortcuts?.['Mod-z']({ editor: null })).toBe(false);
      expect(shortcuts?.['Mod-Shift-z']({ editor: null })).toBe(false);
      expect(shortcuts?.['Mod-y']({ editor: null })).toBe(false);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns history plugin', () => {
      const plugins = History.config.addProseMirrorPlugins?.call(History);
      expect(plugins).toHaveLength(1);
    });
  });

  describe('integration', () => {
    it('registers history plugin', () => {
      editor = new Editor({ extensions, content: '<p>test</p>' });
      expect(editor.state.plugins.length).toBeGreaterThan(0);
    });

    it('undo reverts inserted text', () => {
      editor = new Editor({ extensions, content: '<p>hello</p>' });
      editor.view.dispatch(editor.state.tr.insertText(' world', 6));
      expect(editor.getText()).toContain('hello world');
      editor.commands['undo']?.();
      expect(editor.getText()).toBe('hello');
    });

    it('redo restores undone changes', () => {
      editor = new Editor({ extensions, content: '<p>hello</p>' });
      editor.view.dispatch(editor.state.tr.insertText(' world', 6));
      editor.commands['undo']?.();
      editor.commands['redo']?.();
      expect(editor.getText()).toContain('hello world');
    });

    it('undo returns false when nothing to undo', () => {
      editor = new Editor({ extensions, content: '<p>hello</p>' });
      expect(editor.commands['undo']?.()).toBe(false);
    });

    it('redo returns false when nothing to redo', () => {
      editor = new Editor({ extensions, content: '<p>hello</p>' });
      expect(editor.commands['redo']?.()).toBe(false);
    });

    it('undo reverts text deletion', () => {
      editor = new Editor({ extensions, content: '<p>hello world</p>' });
      editor.view.dispatch(editor.state.tr.delete(6, 12));
      expect(editor.getText()).toBe('hello');
      editor.commands['undo']?.();
      expect(editor.getText()).toContain('hello world');
    });
  });
});
