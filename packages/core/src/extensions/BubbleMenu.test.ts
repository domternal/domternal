/**
 * Tests for BubbleMenu extension
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BubbleMenu, bubbleMenuPluginKey } from './BubbleMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('BubbleMenu', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(BubbleMenu.name).toBe('bubbleMenu');
    });

    it('has default options', () => {
      expect(BubbleMenu.options.element).toBe(null);
      expect(BubbleMenu.options.updateDelay).toBe(0);
      expect(typeof BubbleMenu.options.shouldShow).toBe('function');
      expect(BubbleMenu.options.placement).toBe('top');
      expect(BubbleMenu.options.offset).toEqual([0, 8]);
      expect(BubbleMenu.options.tippyOptions).toEqual({});
    });

    it('can configure element', () => {
      const element = document.createElement('div');
      const CustomBubbleMenu = BubbleMenu.configure({
        element,
      });
      expect(CustomBubbleMenu.options.element).toBe(element);
    });

    it('can configure updateDelay', () => {
      const CustomBubbleMenu = BubbleMenu.configure({
        updateDelay: 100,
      });
      expect(CustomBubbleMenu.options.updateDelay).toBe(100);
    });

    it('can configure shouldShow', () => {
      const customShouldShow = () => false;
      const CustomBubbleMenu = BubbleMenu.configure({
        shouldShow: customShouldShow,
      });
      expect(CustomBubbleMenu.options.shouldShow).toBe(customShouldShow);
    });

    it('can configure placement', () => {
      const CustomBubbleMenu = BubbleMenu.configure({
        placement: 'bottom',
      });
      expect(CustomBubbleMenu.options.placement).toBe('bottom');
    });

    it('can configure offset', () => {
      const CustomBubbleMenu = BubbleMenu.configure({
        offset: [10, 20],
      });
      expect(CustomBubbleMenu.options.offset).toEqual([10, 20]);
    });

    it('can configure tippyOptions', () => {
      const CustomBubbleMenu = BubbleMenu.configure({
        tippyOptions: { zIndex: 1000 },
      });
      expect(CustomBubbleMenu.options.tippyOptions).toEqual({ zIndex: 1000 });
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns empty array when no element provided', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const plugins = BubbleMenu.config.addProseMirrorPlugins?.call(BubbleMenu);

      expect(plugins).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        '[BubbleMenu] No element provided. Menu will not be rendered.'
      );

      warnSpy.mockRestore();
    });

    it('returns plugins array when element is provided', () => {
      const element = document.createElement('div');
      const CustomBubbleMenu = BubbleMenu.configure({ element });

      // Mock the editor
      const mockEditor = {
        view: { coordsAtPos: () => ({ left: 0, top: 0, bottom: 0 }) },
      };
      (CustomBubbleMenu as unknown as { editor: unknown }).editor = mockEditor;

      const plugins = CustomBubbleMenu.config.addProseMirrorPlugins?.call(
        CustomBubbleMenu
      );

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
    });
  });

  describe('default shouldShow', () => {
    it('returns true for non-empty selection', () => {
      const mockState = {
        selection: { empty: false },
      };

      const result = BubbleMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
        from: 1,
        to: 5,
      });

      expect(result).toBe(true);
    });

    it('returns false for empty selection', () => {
      const mockState = {
        selection: { empty: true },
      };

      const result = BubbleMenu.options.shouldShow({
        editor: {} as Editor,
        view: {} as never,
        state: mockState as never,
        from: 1,
        to: 1,
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

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    it('initially hides the menu', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Test content</p>',
      });

      expect(menuElement.style.visibility).toBe('hidden');
      expect(menuElement.style.opacity).toBe('0');
    });

    it('registers plugin with correct key', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Test content</p>',
      });

      const pluginState = bubbleMenuPluginKey.getState(editor.state);
      expect(pluginState).toBeDefined();
      expect(pluginState).toHaveProperty('visible');
      expect(pluginState).toHaveProperty('from');
      expect(pluginState).toHaveProperty('to');
    });

    it('plugin state tracks selection', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      // Initial state - no selection
      let pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
        from: number;
        to: number;
      };
      expect(pluginState.visible).toBe(false);

      // Create a selection
      const { state } = editor;
      const tr = state.tr.setSelection(
        state.selection.constructor.create(state.doc, 1, 6)
      );
      editor.view.dispatch(tr);

      // Check plugin state updated
      pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
        from: number;
        to: number;
      };
      expect(pluginState.visible).toBe(true);
      expect(pluginState.from).toBe(1);
      expect(pluginState.to).toBe(6);
    });

    it('respects custom shouldShow function', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
        shouldShow: () => false, // Never show
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      // Create a selection
      const { state } = editor;
      const tr = state.tr.setSelection(
        state.selection.constructor.create(state.doc, 1, 6)
      );
      editor.view.dispatch(tr);

      // Should still be hidden because shouldShow returns false
      const pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
      };
      expect(pluginState.visible).toBe(false);
    });
  });
});
