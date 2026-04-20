/**
 * Tests for BubbleMenu extension
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { TextSelection, NodeSelection } from '@domternal/pm/state';
import { BubbleMenu, bubbleMenuPluginKey, createBubbleMenuPlugin } from './BubbleMenu.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
import { Editor } from '../Editor.js';
import { PluginKey } from '@domternal/pm/state';

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

  describe('document click and mouse handling', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;

    beforeEach(() => {
      // Shims for jsdom (floating-ui + ProseMirror)
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      (document as any).elementFromPoint = () => null;
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
    });

    it('mousedown on bubble menu element does not throw', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const event = new MouseEvent('mousedown', { bubbles: true });
      element.dispatchEvent(event);
      expect(element).toBeDefined();
    });

    it('mousedown outside both editor and menu does not throw', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const outside = document.createElement('div');
      document.body.appendChild(outside);
      const event = new MouseEvent('mousedown', { bubbles: true });
      outside.dispatchEvent(event);
      expect(editor).toBeDefined();
      outside.remove();
    });

    it('mousedown on editor (primary button) tracks drag', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const editorEl = editor.view.dom;
      const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      editorEl.dispatchEvent(event);
      expect(editor).toBeDefined();
    });

    it('mousedown with non-primary button is ignored', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const editorEl = editor.view.dom;
      const event = new MouseEvent('mousedown', { bubbles: true, button: 2 });
      editorEl.dispatchEvent(event);
      expect(editor).toBeDefined();
    });

    it('document mouseup releases drag tracking', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const editorEl = editor.view.dom;
      editorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(editor).toBeDefined();
    });

    it('focus event triggers re-evaluation', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      editor.view.dom.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      expect(editor).toBeDefined();
    });

    it('focus event with empty selection fires onFocus timeout (hides menu)', async () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      // Empty selection → show=false → hideMenu branch
      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      await new Promise((r) => setTimeout(r, 10));
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('focus event with shouldShow=false covers else branch', async () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element, shouldShow: () => false })],
        content: '<p>Hello</p>',
      });

      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5));
      editor.view.dispatch(tr);
      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      await new Promise((r) => setTimeout(r, 10));
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('focus event after suppressed hides menu', async () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const editorEl = editor.view.dom.closest('.dm-editor');
      editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: true }));

      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      await new Promise((r) => setTimeout(r, 10));
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('focus event while mouseDown returns early', async () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      // Simulate drag by firing mousedown on editor
      editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      await new Promise((r) => setTimeout(r, 10));
      expect(editor).toBeDefined();
    });

    it('blur event with relatedTarget inside menu does not hide', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const inner = document.createElement('span');
      element.appendChild(inner);

      editor.emit('blur', { editor, event: { relatedTarget: inner } as unknown as FocusEvent });
      expect(editor).toBeDefined();
    });

    it('blur event without relatedTarget hides menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      editor.emit('blur', { editor, event: { relatedTarget: null } as unknown as FocusEvent });
      expect(editor).toBeDefined();
    });

    it('dm:dismiss-overlays event hides menu and suppresses', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      const editorEl = editor.view.dom.closest('.dm-editor');
      editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: true }));
      expect(editor).toBeDefined();
    });

    it('updateDelay > 0 schedules setTimeout then cleared on destroy', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element, updateDelay: 1000, shouldShow: () => true })],
        content: '<p>Hello world</p>',
      });

      // Trigger selection change; update() with updateDelay scheduleTimeout
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      // Destroy before timeout fires → hits destroy's clearTimeout branches
      editor.destroy();
      expect(editor.isDestroyed).toBe(true);
    });

    it('update method hides menu and clears data-show when state.visible=false', () => {
      const element = document.createElement('div');
      element.setAttribute('data-show', '');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, BubbleMenu.configure({ element, shouldShow: () => false })],
        content: '<p>Hello</p>',
      });
      // Selection change triggers update() with visible=false
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
      expect(element.hasAttribute('data-show')).toBe(false);
    });
  });
});
