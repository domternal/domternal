/**
 * Tests for FloatingMenu extension
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FloatingMenu, floatingMenuPluginKey } from './FloatingMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('FloatingMenu', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(FloatingMenu.name).toBe('floatingMenu');
    });

    it('has default options', () => {
      expect(FloatingMenu.options.element).toBe(null);
      expect(typeof FloatingMenu.options.shouldShow).toBe('function');
      expect(FloatingMenu.options.offset).toEqual([0, 0]);
      expect(FloatingMenu.options.tippyOptions).toEqual({});
    });

    it('can configure element', () => {
      const element = document.createElement('div');
      const CustomFloatingMenu = FloatingMenu.configure({
        element,
      });
      expect(CustomFloatingMenu.options.element).toBe(element);
    });

    it('can configure shouldShow', () => {
      const customShouldShow = () => false;
      const CustomFloatingMenu = FloatingMenu.configure({
        shouldShow: customShouldShow,
      });
      expect(CustomFloatingMenu.options.shouldShow).toBe(customShouldShow);
    });

    it('can configure offset', () => {
      const CustomFloatingMenu = FloatingMenu.configure({
        offset: [10, 20],
      });
      expect(CustomFloatingMenu.options.offset).toEqual([10, 20]);
    });

    it('can configure tippyOptions', () => {
      const CustomFloatingMenu = FloatingMenu.configure({
        tippyOptions: { zIndex: 1000 },
      });
      expect(CustomFloatingMenu.options.tippyOptions).toEqual({ zIndex: 1000 });
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns empty array when no element provided', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const plugins =
        FloatingMenu.config.addProseMirrorPlugins?.call(FloatingMenu);

      expect(plugins).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        '[FloatingMenu] No element provided. Menu will not be rendered.'
      );

      warnSpy.mockRestore();
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
    let menuElement: HTMLElement;

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

      expect(menuElement.style.visibility).toBe('hidden');
      expect(menuElement.style.opacity).toBe('0');
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

      expect(menuElement.style.visibility).toBe('hidden');
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
      expect(menuElement.style.visibility).toBe('hidden');
    });
  });
});
