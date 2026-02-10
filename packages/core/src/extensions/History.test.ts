import { describe, it, expect, afterEach } from 'vitest';
import { History } from './History.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('History', () => {
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
  });

  describe('addProseMirrorPlugins', () => {
    it('returns history plugin', () => {
      const plugins = History.config.addProseMirrorPlugins?.call(History);
      expect(plugins).toHaveLength(1);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('registers history plugin', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, History],
        content: '<p>test</p>',
      });
      // History plugin should be active
      expect(editor.state.plugins.length).toBeGreaterThan(0);
    });
  });
});
