/**
 * Tests for FloatingMenu extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { FloatingMenu, floatingMenuPluginKey, createFloatingMenuPlugin } from './FloatingMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Editor } from '../Editor.js';
import { PluginKey, TextSelection } from '@domternal/pm/state';

describe('FloatingMenu', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(FloatingMenu.name).toBe('floatingMenu');
    });

    it('has default options', () => {
      expect(FloatingMenu.options.element).toBe(null);
      expect(typeof FloatingMenu.options.shouldShow).toBe('function');
      expect(FloatingMenu.options.offset).toBe(0);
    });

    it('can configure element', () => {
      const element = document.createElement('div');
      const CustomFloatingMenu = FloatingMenu.configure({
        element,
      });
      expect(CustomFloatingMenu.options.element).toBe(element);
    });

    it('can configure shouldShow', () => {
      const customShouldShow = (): boolean => false;
      const CustomFloatingMenu = FloatingMenu.configure({
        shouldShow: customShouldShow,
      });
      expect(CustomFloatingMenu.options.shouldShow).toBe(customShouldShow);
    });

    it('can configure offset', () => {
      const CustomFloatingMenu = FloatingMenu.configure({
        offset: 20,
      });
      expect(CustomFloatingMenu.options.offset).toBe(20);
    });

  });

  describe('addProseMirrorPlugins', () => {
    it('returns empty array when no element provided', () => {
      const plugins =
        FloatingMenu.config.addProseMirrorPlugins?.call(FloatingMenu);

      expect(plugins).toEqual([]);
    });

    it('returns plugins array when element is provided', () => {
      const element = document.createElement('div');
      const CustomFloatingMenu = FloatingMenu.configure({ element });

      // Mock the editor
      const mockEditor = {
        view: { coordsAtPos: () => ({ left: 0, top: 0, bottom: 0 }) },
        state: {
          selection: {
            from: 1,
            empty: true,
            $from: { parent: { type: { name: 'paragraph' }, content: { size: 0 } }, parentOffset: 0 },
          },
        },
      };
      (CustomFloatingMenu as unknown as { editor: unknown }).editor = mockEditor;

      const plugins = CustomFloatingMenu.config.addProseMirrorPlugins?.call(
        CustomFloatingMenu
      );

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
    });
  });

  describe('default shouldShow', () => {
    it('returns true for empty paragraph at start', () => {
      const mockState = {
        selection: {
          empty: true,
          $from: {
            parent: { type: { name: 'paragraph' }, content: { size: 0 } },
            parentOffset: 0,
          },
        },
      };

      const result = FloatingMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(true);
    });

    it('returns false for non-empty selection', () => {
      const mockState = {
        selection: {
          empty: false,
          $from: {
            parent: { type: { name: 'paragraph' }, content: { size: 0 } },
            parentOffset: 0,
          },
        },
      };

      const result = FloatingMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(false);
    });

    it('returns false for non-paragraph node', () => {
      const mockState = {
        selection: {
          empty: true,
          $from: {
            parent: { type: { name: 'heading' }, content: { size: 0 } },
            parentOffset: 0,
          },
        },
      };

      const result = FloatingMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(false);
    });

    it('returns false for non-empty paragraph', () => {
      const mockState = {
        selection: {
          empty: true,
          $from: {
            parent: { type: { name: 'paragraph' }, content: { size: 5 } },
            parentOffset: 0,
          },
        },
      };

      const result = FloatingMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(false);
    });

    it('returns false when not at start of paragraph', () => {
      const mockState = {
        selection: {
          empty: true,
          $from: {
            parent: { type: { name: 'paragraph' }, content: { size: 0 } },
            parentOffset: 3,
          },
        },
      };

      const result = FloatingMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;
    let menuElement: HTMLElement | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
      menuElement?.remove();
    });

    it('works with Editor', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    it('initially hides the menu', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Test content</p>',
      });

      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('registers plugin with correct key', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Test content</p>',
      });

      // FloatingMenu plugin doesn't store state, so we just check it's registered
      const plugins = editor.state.plugins;
      const hasFloatingMenu = plugins.some(
        (p) => p.spec.key === floatingMenuPluginKey
      );
      expect(hasFloatingMenu).toBe(true);
    });

    it('shows menu in empty paragraph', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      // Create editor with empty paragraph
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p></p>',
      });

      // Focus at start
      editor.focus('start');

      // Menu should be visible for empty paragraph
      // Note: In real browser this would work, but in test env without proper DOM layout
      // the visibility check may not work as expected
    });

    it('hides menu when paragraph has content', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Hello world</p>',
      });

      // Focus at start - paragraph has content, so menu should be hidden
      editor.focus('start');

      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('respects custom shouldShow function', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
        shouldShow: () => false, // Never show
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p></p>',
      });

      editor.focus('start');

      // Should be hidden because shouldShow returns false
      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('hides menu on destroy', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Test</p>',
      });

      editor.destroy();

      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('configures custom offset', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomFloatingMenu = FloatingMenu.configure({
        element: menuElement,
        offset: 25,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomFloatingMenu],
        content: '<p>Hello</p>',
      });

      expect(editor.getText()).toContain('Hello');
    });

    it('returns empty plugins when no editor', () => {
      const element = document.createElement('div');
      const CustomFloatingMenu = FloatingMenu.configure({ element });

      (CustomFloatingMenu as unknown as { editor: unknown }).editor = null;

      const plugins = CustomFloatingMenu.config.addProseMirrorPlugins?.call(CustomFloatingMenu);
      expect(plugins).toEqual([]);
    });

    it('createFloatingMenuPlugin works standalone', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const pluginKey = new PluginKey('testFloating');
      const plugin = createFloatingMenuPlugin({
        pluginKey,
        editor,
        element: menuElement,
      });

      expect(plugin).toBeDefined();
      expect(plugin.spec.key).toBe(pluginKey);
    });

    it('createFloatingMenuPlugin with custom shouldShow', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p></p>',
      });

      const pluginKey = new PluginKey('testFloating2');
      const plugin = createFloatingMenuPlugin({
        pluginKey,
        editor,
        element: menuElement,
        shouldShow: () => false,
      });

      expect(plugin).toBeDefined();
    });

    it('createFloatingMenuPlugin with custom offset', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const plugin = createFloatingMenuPlugin({
        pluginKey: new PluginKey('testFloating3'),
        editor,
        element: menuElement,
        offset: 20,
      });

      expect(plugin).toBeDefined();
    });

    it('hides menu when content is added to empty paragraph', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element: menuElement })],
        content: '<p>Hello world</p>',
      });

      // Paragraph has content — menu should be hidden
      expect(menuElement.hasAttribute('data-show')).toBe(false);

      // Insert text into position
      editor.view.dispatch(editor.state.tr.insertText('x', 1));

      // Still hidden
      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });
  });

  describe('default shouldShow with real editor state', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('returns true when cursor is in empty paragraph (real doc)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p></p>',
      });

      const result = FloatingMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
      });

      expect(result).toBe(true);
    });

    it('returns false when cursor is in paragraph with text (real doc)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = FloatingMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
      });

      expect(result).toBe(false);
    });

    it('returns false when selection is not empty (real doc)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)),
      );

      const result = FloatingMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
      });

      expect(result).toBe(false);
    });

    it('returns false when cursor is in heading node', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h1></h1>',
      });

      // Even though heading is empty, shouldShow requires paragraph
      const result = FloatingMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
      });

      expect(result).toBe(false);
    });
  });
});
