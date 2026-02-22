/**
 * Tests for BubbleMenu extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { BubbleMenu, bubbleMenuPluginKey } from './BubbleMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
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
      const customShouldShow = (): boolean => false;
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

  });

  describe('addProseMirrorPlugins', () => {
    it('returns empty array when no element provided', () => {
      const plugins = BubbleMenu.config.addProseMirrorPlugins?.call(BubbleMenu);

      expect(plugins).toEqual([]);
    });

    it('returns plugins array when element is provided', () => {
      const element = document.createElement('div');
      const CustomBubbleMenu = BubbleMenu.configure({ element });

      // Mock the editor
      const mockEditor = {
        view: { coordsAtPos: () => ({ left: 0, top: 0, bottom: 0 }) },
        on: () => { /* noop */ },
        off: () => { /* noop */ },
        isEditable: true,
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
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('returns true for text selection with content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      // Create a text selection over "Hello"
      const { state } = editor;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, 1, 6)
      );
      editor.view.dispatch(tr);

      const result = BubbleMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      });
      expect(result).toBe(true);
    });

    it('returns false for empty selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      // Cursor at position 1 (no selection range)
      const { state } = editor;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, 1)
      );
      editor.view.dispatch(tr);

      const result = BubbleMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      });
      expect(result).toBe(false);
    });

    it('returns false for node selection (e.g. horizontal rule)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule],
        content: '<p>Hello</p><hr><p>World</p>',
      });

      // Find the HR node position and create a NodeSelection on it
      const { state } = editor;
      let hrPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'horizontalRule') {
          hrPos = pos;
          return false;
        }
        return true;
      });

      expect(hrPos).toBeGreaterThan(-1);

      const tr = state.tr.setSelection(
        NodeSelection.create(state.doc, hrPos)
      );
      editor.view.dispatch(tr);

      const result = BubbleMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      });
      expect(result).toBe(false);
    });

    it('returns false when editor is not editable', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
        editable: false,
      });

      // Create a text selection
      const { state } = editor;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, 1, 6)
      );
      editor.view.dispatch(tr);

      const result = BubbleMenu.options.shouldShow({
        editor,
        view: editor.view,
        state: editor.state,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
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

      expect(menuElement.hasAttribute('data-show')).toBe(false);
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

      const pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
        from: number;
        to: number;
      } | undefined;
      expect(pluginState).toBeDefined();
      expect(pluginState).toHaveProperty('visible');
      expect(pluginState).toHaveProperty('from');
      expect(pluginState).toHaveProperty('to');
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
        TextSelection.create(state.doc, 1, 6)
      );
      editor.view.dispatch(tr);

      // Should still be hidden because shouldShow returns false
      const pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
      };
      expect(pluginState.visible).toBe(false);
    });

    it('plugin state init returns correct defaults', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      const pluginState = bubbleMenuPluginKey.getState(editor.state) as {
        visible: boolean;
        from: number;
        to: number;
      };
      expect(pluginState.visible).toBe(false);
      expect(pluginState.from).toBeDefined();
      expect(pluginState.to).toBeDefined();
    });

    it('hides menu on destroy', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      editor.destroy();

      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('configures bottom placement', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
        placement: 'bottom',
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      expect(editor.getText()).toContain('Hello world');
    });

    it('configures updateDelay', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      const CustomBubbleMenu = BubbleMenu.configure({
        element: menuElement,
        updateDelay: 200,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomBubbleMenu],
        content: '<p>Hello world</p>',
      });

      expect(editor.getText()).toContain('Hello world');
    });
  });
});
