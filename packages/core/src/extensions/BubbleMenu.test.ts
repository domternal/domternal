/**
 * Tests for BubbleMenu extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { BubbleMenu, bubbleMenuPluginKey, createBubbleMenuPlugin } from './BubbleMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
import { Editor } from '../Editor.js';
import { PluginKey } from 'prosemirror-state';

interface BubbleMenuPluginState { visible: boolean; from: number; to: number }

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
      expect(BubbleMenu.options.offset).toBe(8);
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
        offset: 20,
      });
      expect(CustomBubbleMenu.options.offset).toBe(20);
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

    it('plugin state becomes visible when text is selected', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element: menuElement })],
        content: '<p>Hello world</p>',
      });

      // Mock coordsAtPos for jsdom (no real layout)
      editor.view.coordsAtPos = () => ({ left: 10, right: 50, top: 10, bottom: 30 });

      // Select "Hello"
      const tr = editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 6),
      );
      editor.view.dispatch(tr);

      const ps = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps.visible).toBe(true);
      expect(ps.from).toBe(1);
      expect(ps.to).toBe(6);
    });

    it('plugin state becomes invisible when selection collapses', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element: menuElement })],
        content: '<p>Hello world</p>',
      });

      editor.view.coordsAtPos = () => ({ left: 10, right: 50, top: 10, bottom: 30 });

      // Select "Hello"
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
      );
      expect((bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState).visible).toBe(true);

      // Collapse to cursor
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
      );
      expect((bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState).visible).toBe(false);
    });

    it('plugin state tracks from/to on selection change', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element: menuElement })],
        content: '<p>Hello world</p>',
      });

      editor.view.coordsAtPos = () => ({ left: 10, right: 50, top: 10, bottom: 30 });

      // Select "Hello"
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
      );
      let ps = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps.from).toBe(1);
      expect(ps.to).toBe(6);

      // Change to "world" (7-12)
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 12)),
      );
      ps = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps.from).toBe(7);
      expect(ps.to).toBe(12);
    });

    it('returns empty plugins when no editor', () => {
      const element = document.createElement('div');
      const CustomBubbleMenu = BubbleMenu.configure({ element });

      // No editor set
      (CustomBubbleMenu as unknown as { editor: unknown }).editor = null;

      const plugins = CustomBubbleMenu.config.addProseMirrorPlugins?.call(CustomBubbleMenu);
      expect(plugins).toEqual([]);
    });

    it('createBubbleMenuPlugin works standalone', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      const pluginKey = new PluginKey('testBubble');
      const plugin = createBubbleMenuPlugin({
        pluginKey,
        editor,
        element: menuElement,
      });

      expect(plugin).toBeDefined();
      expect(plugin.spec.key).toBe(pluginKey);
    });

    it('createBubbleMenuPlugin respects custom shouldShow', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      const pluginKey = new PluginKey('testBubble2');
      const alwaysFalse = (): boolean => false;

      // Add plugin to editor
      const plugin = createBubbleMenuPlugin({
        pluginKey,
        editor,
        element: menuElement,
        shouldShow: alwaysFalse,
      });

      expect(plugin).toBeDefined();
      // The plugin should have been created with our custom key
      expect(plugin.spec.key).toBe(pluginKey);
    });

    it('hides menu element via data-show attribute on init', () => {
      menuElement = document.createElement('div');
      menuElement.setAttribute('data-show', '');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element: menuElement })],
        content: '<p>Hello</p>',
      });

      // On init with no selection, menu should be hidden
      expect(menuElement.hasAttribute('data-show')).toBe(false);
    });

    it('repositions when doc changes but selection stays at same pos (e.g. setNodeMarkup)', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      // alwaysShow: show for any non-empty selection (including NodeSelection)
      const alwaysShow = ({ state }: { state: { selection: { empty: boolean } } }): boolean =>
        !state.selection.empty;

      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule, BubbleMenu.configure({ element: menuElement, shouldShow: alwaysShow })],
        content: '<p>Hello</p><hr><p>World</p>',
      });

      editor.view.coordsAtPos = () => ({ left: 10, right: 50, top: 10, bottom: 30 });

      // Select the HR node
      let hrPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'horizontalRule') { hrPos = pos; return false; }
        return true;
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)),
      );

      const ps1 = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps1.visible).toBe(true);
      expect(menuElement.hasAttribute('data-show')).toBe(true);

      // Now change the doc WITHOUT changing selection position:
      // insert text at beginning of first paragraph (shifts nothing for the HR selection pos)
      // Simulate what setNodeMarkup does: doc changes, selection from/to stay the same
      const { state } = editor;
      const tr = state.tr.insertText('X', 1, 1);
      // Keep the NodeSelection at the HR (now shifted by 1)
      tr.setSelection(NodeSelection.create(tr.doc, hrPos + 1));
      editor.view.dispatch(tr);

      // Plugin state: from/to changed (shifted), so update fires anyway.
      // But the key test: menu must still be shown and data-show present
      const ps2 = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps2.visible).toBe(true);
      expect(menuElement.hasAttribute('data-show')).toBe(true);
    });

    it('repositions when node attrs change via setNodeMarkup (same from/to)', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      // Use a custom shouldShow that allows NodeSelection
      const alwaysShow = ({ state }: { state: { selection: { empty: boolean } } }): boolean =>
        !state.selection.empty;

      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule, BubbleMenu.configure({ element: menuElement, shouldShow: alwaysShow })],
        content: '<p>Hello</p><hr><p>World</p>',
      });

      editor.view.coordsAtPos = () => ({ left: 10, right: 50, top: 10, bottom: 30 });

      // Select the HR node
      let hrPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'horizontalRule') { hrPos = pos; return false; }
        return true;
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)),
      );
      expect(menuElement.hasAttribute('data-show')).toBe(true);

      // setNodeMarkup changes the doc but keeps selection at the same from/to
      // This simulates what happens when changing image float attribute
      const { state } = editor;
      const prevDoc = state.doc;
      const tr = state.tr.setNodeMarkup(hrPos, undefined, {});
      tr.setSelection(NodeSelection.create(tr.doc, hrPos));
      editor.view.dispatch(tr);

      // Doc must have changed
      expect(editor.state.doc).not.toBe(prevDoc);

      // from/to are the same, but doc changed → menu must still be shown
      const ps = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps.visible).toBe(true);
      expect(ps.from).toBe(hrPos);
      expect(menuElement.hasAttribute('data-show')).toBe(true);
    });

    it('keeps menu hidden for node selection', () => {
      menuElement = document.createElement('div');
      document.body.appendChild(menuElement);

      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule, BubbleMenu.configure({ element: menuElement })],
        content: '<p>Hello</p><hr><p>World</p>',
      });

      // Find HR position
      let hrPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'horizontalRule') { hrPos = pos; return false; }
        return true;
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)),
      );

      const ps = bubbleMenuPluginKey.getState(editor.state) as BubbleMenuPluginState;
      expect(ps.visible).toBe(false);
    });
  });
});
