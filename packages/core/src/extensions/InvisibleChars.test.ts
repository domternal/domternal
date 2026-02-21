/**
 * Tests for InvisibleChars extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { InvisibleChars, invisibleCharsPluginKey } from './InvisibleChars.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HardBreak } from '../nodes/HardBreak.js';
import { Editor } from '../Editor.js';
import type { ToolbarButton } from '../types/Toolbar.js';

describe('InvisibleChars', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(InvisibleChars.name).toBe('invisibleChars');
    });

    it('has default options', () => {
      expect(InvisibleChars.options).toEqual({
        visible: false,
        paragraph: true,
        hardBreak: true,
        space: true,
        nbsp: true,
        className: 'invisible-char',
      });
    });

    it('can configure visible', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        visible: true,
      });
      expect(CustomInvisibleChars.options.visible).toBe(true);
    });

    it('can configure paragraph', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        paragraph: false,
      });
      expect(CustomInvisibleChars.options.paragraph).toBe(false);
    });

    it('can configure hardBreak', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        hardBreak: false,
      });
      expect(CustomInvisibleChars.options.hardBreak).toBe(false);
    });

    it('can configure space', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        space: false,
      });
      expect(CustomInvisibleChars.options.space).toBe(false);
    });

    it('can configure nbsp', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        nbsp: false,
      });
      expect(CustomInvisibleChars.options.nbsp).toBe(false);
    });

    it('can configure className', () => {
      const CustomInvisibleChars = InvisibleChars.configure({
        className: 'custom-invisible',
      });
      expect(CustomInvisibleChars.options.className).toBe('custom-invisible');
    });
  });

  describe('addStorage', () => {
    it('provides toggle function', () => {
      const storage = InvisibleChars.config.addStorage?.call(InvisibleChars);
      expect(typeof storage?.toggle).toBe('function');
    });

    it('provides isVisible function', () => {
      const storage = InvisibleChars.config.addStorage?.call(InvisibleChars);
      expect(typeof storage?.isVisible).toBe('function');
    });
  });

  describe('addCommands', () => {
    it('provides toggleInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('toggleInvisibleChars');
      expect(typeof commands?.['toggleInvisibleChars']).toBe('function');
    });

    it('provides showInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('showInvisibleChars');
      expect(typeof commands?.['showInvisibleChars']).toBe('function');
    });

    it('provides hideInvisibleChars command', () => {
      const commands = InvisibleChars.config.addCommands?.call(InvisibleChars);
      expect(commands).toHaveProperty('hideInvisibleChars');
      expect(typeof commands?.['hideInvisibleChars']).toBe('function');
    });
  });

  describe('addToolbarItems', () => {
    it('provides toolbar button with isActiveFn', () => {
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      expect(items).toHaveLength(1);
      const btn = items![0] as ToolbarButton;
      expect(btn.type).toBe('button');
      expect(btn.name).toBe('invisibleChars');
      expect(typeof btn.isActiveFn).toBe('function');
    });

    it('isActiveFn returns false when hidden', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      const btn = items![0] as ToolbarButton;
      expect(btn.isActiveFn!(editor)).toBe(false);
      editor.destroy();
    });

    it('isActiveFn returns true when visible', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      editor.commands.toggleInvisibleChars();
      const items = InvisibleChars.config.addToolbarItems?.call(InvisibleChars);
      const btn = items![0] as ToolbarButton;
      expect(btn.isActiveFn!(editor)).toBe(true);
      editor.destroy();
    });
  });

  describe('commands dispatch guard', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('toggleInvisibleChars does not toggle on can() dry-run', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(false);

      // can() should not trigger side effects
      const canProxy = editor.can();
      canProxy['toggleInvisibleChars']?.();

      expect(storage.isVisible()).toBe(false);
    });

    it('showInvisibleChars does not toggle on can() dry-run', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test</p>',
      });
      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;

      const canProxy = editor.can();
      canProxy['showInvisibleChars']?.();

      expect(storage.isVisible()).toBe(false);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns plugins array', () => {
      const plugins = InvisibleChars.config.addProseMirrorPlugins?.call(
        InvisibleChars
      );

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    it('starts hidden by default', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InvisibleChars],
        content: '<p>Test content</p>',
      });

      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(false);
    });

    it('can start visible when configured', () => {
      const VisibleInvisibleChars = InvisibleChars.configure({
        visible: true,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
        content: '<p>Test content</p>',
      });

      const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
      expect(storage.isVisible()).toBe(true);
    });

    describe('storage.toggle', () => {
      it('toggles visibility from false to true', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        storage.toggle();
        expect(storage.isVisible()).toBe(true);
      });

      it('toggles visibility from true to false', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        storage.toggle();
        expect(storage.isVisible()).toBe(false);
      });
    });

    describe('toggleInvisibleChars command', () => {
      it('toggles visibility', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.toggleInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });
    });

    describe('showInvisibleChars command', () => {
      it('shows invisible chars when hidden', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.showInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });

      it('keeps visible when already visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        editor.commands.showInvisibleChars();

        expect(storage.isVisible()).toBe(true);
      });
    });

    describe('hideInvisibleChars command', () => {
      it('hides invisible chars when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(true);

        editor.commands.hideInvisibleChars();

        expect(storage.isVisible()).toBe(false);
      });

      it('keeps hidden when already hidden', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const storage = editor.storage['invisibleChars'] as typeof InvisibleChars.storage;
        expect(storage.isVisible()).toBe(false);

        editor.commands.hideInvisibleChars();

        expect(storage.isVisible()).toBe(false);
      });
    });

    describe('plugin state', () => {
      it('tracks visibility in plugin state', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        const pluginState = invisibleCharsPluginKey.getState(editor.state) as
          | { visible: boolean }
          | undefined;
        expect(pluginState?.visible).toBe(false);

        editor.commands.toggleInvisibleChars();

        const newPluginState = invisibleCharsPluginKey.getState(editor.state) as
          | { visible: boolean }
          | undefined;
        expect(newPluginState?.visible).toBe(true);
      });

      it('preserves state on unrelated transaction', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, InvisibleChars],
          content: '<p>Test</p>',
        });

        // Toggle to true
        editor.commands.toggleInvisibleChars();
        expect(
          (invisibleCharsPluginKey.getState(editor.state) as { visible: boolean }).visible
        ).toBe(true);

        // Dispatch an unrelated transaction (e.g., inserting text)
        editor.view.dispatch(editor.state.tr.insertText('x', 1));

        // State should remain true (apply returns value unchanged)
        expect(
          (invisibleCharsPluginKey.getState(editor.state) as { visible: boolean }).visible
        ).toBe(true);
      });
    });

    describe('with hardBreak', () => {
      it('works with hard breaks in content', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, InvisibleChars],
          content: '<p>Line 1<br>Line 2</p>',
        });

        expect(editor.getText()).toContain('Line 1');
        expect(editor.getText()).toContain('Line 2');
      });

      it('creates decorations for hardBreak when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, HardBreak, VisibleInvisibleChars],
          content: '<p>Line 1<br>Line 2</p>',
        });

        // Plugin should create decorations (hardBreak + paragraph + spaces)
        const pluginState = invisibleCharsPluginKey.getState(editor.state) as { visible: boolean };
        expect(pluginState.visible).toBe(true);

        // Check that the view has the invisible char decorations rendered
        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char');
      });
    });

    describe('with nbsp content', () => {
      it('creates decorations for non-breaking spaces when visible', () => {
        const VisibleInvisibleChars = InvisibleChars.configure({
          visible: true,
        });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, VisibleInvisibleChars],
          content: '<p>Hello\u00A0world</p>',
        });

        const html = editor.view.dom.innerHTML;
        expect(html).toContain('invisible-char');
      });
    });
  });
});
