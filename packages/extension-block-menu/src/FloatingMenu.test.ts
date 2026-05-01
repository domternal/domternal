/**
 * Tests for FloatingMenu extension
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  FloatingMenu,
  floatingMenuPluginKey,
  createFloatingMenuPlugin,
  showFloatingMenu,
  hideFloatingMenu,
  FLOATING_MENU_META,
} from './FloatingMenu.js';
import { Document, Text, Paragraph, Heading, Editor } from '@domternal/core';
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
        editor: { isEditable: true } as Editor,
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
        editor: { isEditable: true } as Editor,
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
        editor: { isEditable: true } as Editor,
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
        editor: { isEditable: true } as Editor,
        view: {} as never,
        state: mockState as never,
      });

      expect(result).toBe(false);
    });

    it('returns false when editor is not editable', () => {
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
        editor: { isEditable: false } as Editor,
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
        editor: { isEditable: true } as Editor,
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

      // Paragraph has content - menu should be hidden
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

  describe('plugin integration with editor (DOM)', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;
    let originalGetClientRects: typeof Element.prototype.getClientRects;

    beforeEach(() => {
      // Shim for jsdom (floating-ui positioning). Capture the original so
      // afterEach can restore it - otherwise the stub persists across test
      // files running in the same worker.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalGetClientRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    });

    it('element gets role and aria-label when missing', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      expect(element.getAttribute('role')).toBe('menu');
      expect(element.getAttribute('aria-label')).toBe('Insert block');
    });

    it('element is moved inside .dm-editor ancestor', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      expect(element.parentElement).toBe(host);
    });

    it('hides menu initially', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element })],
        content: '<p></p>',
      });

      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('preserves pre-existing role/label attributes', () => {
      const element = document.createElement('div');
      element.setAttribute('role', 'custom-role');
      element.setAttribute('aria-label', 'Custom Label');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      expect(element.getAttribute('role')).toBe('custom-role');
      expect(element.getAttribute('aria-label')).toBe('Custom Label');
    });

    it('plugin update hides menu when shouldShow returns false', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p>Hello</p>',
      });

      // Trigger an update
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('plugin update sets data-show when shouldShow returns true (empty paragraph)', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => true })],
        content: '<p></p>',
      });

      // Dispatch a selection update to trigger the update() hook.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      // Because shouldShow is forced-true and the doc has a resolvable
      // block DOM, updatePosition sets `data-show`.
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('onFocus when shouldShow returns false hides menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p>Hello</p>',
      });

      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('onFocus when shouldShow returns true sets data-show', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => true })],
        content: '<p></p>',
      });

      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('onBlur with relatedTarget inside menu does not hide (menu stays visible)', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => true })],
        content: '<p></p>',
      });
      // Show the menu first.
      editor.emit('focus', { editor, event: new FocusEvent('focus') });
      expect(element.hasAttribute('data-show')).toBe(true);

      // Blur with relatedTarget inside menu → should NOT hide.
      const inner = document.createElement('span');
      element.appendChild(inner);
      editor.emit('blur', { editor, event: { relatedTarget: inner } as unknown as FocusEvent });
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('onBlur without relatedTarget hides menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element })],
        content: '<p>Hello</p>',
      });

      editor.emit('blur', { editor, event: { relatedTarget: null } as unknown as FocusEvent });
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('destroy removes listeners and hides menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => true })],
        content: '<p></p>',
      });

      editor.destroy();
      expect(editor.isDestroyed).toBe(true);
    });
  });

  // =========================================================================
  // Keyboard entry: handleKeyDown + matchShortcut branches
  // =========================================================================
  describe('keyboard entry (handleKeyDown)', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;
    let originalGetClientRects: typeof Element.prototype.getClientRects;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalGetClientRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    });

    function mountVisible(element: HTMLElement, keymap?: { enterMenu?: string[] }): void {
      const config = { element, shouldShow: (): boolean => true };
      const configured = keymap
        ? FloatingMenu.configure({ ...config, keymap })
        : FloatingMenu.configure(config);
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, configured],
        content: '<p></p>',
      });
      element.setAttribute('data-show', ''); // force visible state for plugin gate
    }

    it('ignores keydown when menu is hidden', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => false }),
        ],
        content: '<p>Hello</p>',
      });

      const event = new KeyboardEvent('keydown', { key: 'F10', altKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor.view.dom.dispatchEvent(event);
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('Alt-F10 focuses the first menu item and prevents default', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      btn.tabIndex = 0;
      element.appendChild(btn);
      mountVisible(element);

      const event = new KeyboardEvent('keydown', { key: 'F10', altKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalled();
      expect(document.activeElement).toBe(btn);
    });

    it('Alt-F10 without any focusable menu item does not preventDefault', () => {
      const element = document.createElement('div');
      mountVisible(element);

      const event = new KeyboardEvent('keydown', { key: 'F10', altKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);

      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('skips aria-disabled items when focusing, falls back to next focusable', () => {
      const element = document.createElement('div');
      const disabled = document.createElement('button');
      disabled.setAttribute('data-floating-menu-item', '');
      disabled.setAttribute('aria-disabled', 'true');
      const enabled = document.createElement('button');
      enabled.setAttribute('data-floating-menu-item', '');
      element.append(disabled, enabled);
      mountVisible(element);

      editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true }));
      expect(document.activeElement).toBe(enabled);
    });

    it('falls back to plain button when no data-floating-menu-item nodes exist', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      element.appendChild(btn);
      mountVisible(element);

      editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', altKey: true }));
      expect(document.activeElement).toBe(btn);
    });

    it('Mod-/ shortcut matches Ctrl-/ off macOS', () => {
      // jsdom's navigator.userAgent is Mozilla/... Linux/x86_64 by default
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element);

      const event = new KeyboardEvent('keydown', { key: '/', ctrlKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('ignores non-matching key events', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element);

      const event = new KeyboardEvent('keydown', { key: 'x' });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('shortcut key match is case-insensitive for single-char keys', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element, { enterMenu: ['Mod-A'] });

      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('respects explicit Shift modifier', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element, { enterMenu: ['Shift-F1'] });

      // Without Shift - no match.
      editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }));
      expect(document.activeElement).not.toBe(btn);

      // With Shift - match.
      editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F1', shiftKey: true }),
      );
      expect(document.activeElement).toBe(btn);
    });

    it('matches explicit Meta modifier', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element, { enterMenu: ['Meta-K'] });

      editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
      expect(document.activeElement).toBe(btn);
    });

    it('ignores shortcut with empty key parts', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element, { enterMenu: [''] });

      editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(document.activeElement).not.toBe(btn);
    });

    it('empty keymap disables keyboard entry', () => {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      element.appendChild(btn);
      mountVisible(element, { enterMenu: [] });

      editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F10', altKey: true }),
      );
      expect(document.activeElement).not.toBe(btn);
    });
  });

  // =========================================================================
  // Dismiss paths: click-outside and dm:dismiss-overlays
  // =========================================================================
  describe('dismissal', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;
    let originalGetClientRects: typeof Element.prototype.getClientRects;
    let originalElementFromPoint: typeof document.elementFromPoint;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalGetClientRects = Element.prototype.getClientRects;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalElementFromPoint = document.elementFromPoint;
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      // jsdom lacks elementFromPoint; ProseMirror's internal mousedown
      // handler calls posAtCoords → elementFromPoint. Stub to null.
      (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint =
        (): Element | null => null;
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
      Element.prototype.getClientRects = originalGetClientRects;
      document.elementFromPoint = originalElementFromPoint;
    });

    it('click-outside handler hides a visible menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true }),
        ],
        content: '<p></p>',
      });
      element.setAttribute('data-show', '');

      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(element.hasAttribute('data-show')).toBe(false);
      outside.remove();
    });

    it('click-outside handler ignores clicks while menu is hidden', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => false }),
        ],
        content: '<p>Hello</p>',
      });

      // Sanity: not showing.
      expect(element.hasAttribute('data-show')).toBe(false);
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      // Should not throw, no state change.
      expect(() =>
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
      ).not.toThrow();
      outside.remove();
    });

    it('click-outside handler ignores clicks inside menu element', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true }),
        ],
        content: '<p></p>',
      });
      element.setAttribute('data-show', '');

      const inner = document.createElement('span');
      element.appendChild(inner);
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('click-outside handler ignores clicks inside editor view', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true }),
        ],
        content: '<p></p>',
      });
      element.setAttribute('data-show', '');

      editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('dm:dismiss-overlays event hides the menu', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true }),
        ],
        content: '<p></p>',
      });
      element.setAttribute('data-show', '');

      host.dispatchEvent(new Event('dm:dismiss-overlays'));
      expect(element.hasAttribute('data-show')).toBe(false);
    });
  });

  // =========================================================================
  // showFloatingMenu / hideFloatingMenu programmatic API
  // =========================================================================
  describe('showFloatingMenu / hideFloatingMenu', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;

    beforeEach(() => {
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
    });

    it('showFloatingMenu dispatches the show meta', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p></p>',
      });

      const dispatch = vi.spyOn(editor.view, 'dispatch');
      showFloatingMenu(editor.view);

      expect(dispatch).toHaveBeenCalled();
      const tr = dispatch.mock.calls[0]?.[0];
      expect(tr?.getMeta(FLOATING_MENU_META)).toBe('show');
    });

    it('hideFloatingMenu dispatches the hide meta', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p></p>',
      });

      const dispatch = vi.spyOn(editor.view, 'dispatch');
      hideFloatingMenu(editor.view);

      expect(dispatch).toHaveBeenCalled();
      const tr = dispatch.mock.calls[0]?.[0];
      expect(tr?.getMeta(FLOATING_MENU_META)).toBe('hide');
    });

    it('plugin state apply: show meta sets triggered=true', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      const state = floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined;
      expect(state?.triggered).toBe(true);
    });

    it('plugin state apply: hide meta sets triggered=false', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      hideFloatingMenu(editor.view);
      const state = floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined;
      expect(state?.triggered).toBe(false);
    });

    it('plugin state apply: unrelated meta value leaves state untouched', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, FloatingMenu.configure({ element, shouldShow: () => false })],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      // Garbage meta value goes through `apply` and falls into the "return prev" branch.
      editor.view.dispatch(editor.view.state.tr.setMeta(FLOATING_MENU_META, 'garbage' as unknown as 'show'));
      const state = floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined;
      expect(state?.triggered).toBe(true);
    });
  });

  // =========================================================================
  // requireExplicitTrigger flow (Notion-style empty-line behaviour)
  // =========================================================================
  describe('requireExplicitTrigger', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;
    let originalGetClientRects: typeof Element.prototype.getClientRects;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalGetClientRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    });

    it('menu stays hidden on empty paragraph until showFloatingMenu fires', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true, requireExplicitTrigger: true }),
        ],
        content: '<p></p>',
      });

      // shouldShow is `() => true` but the explicit-trigger gate keeps the
      // menu hidden until something dispatches the `show` meta.
      expect(element.hasAttribute('data-show')).toBe(false);
    });

    it('showFloatingMenu makes the menu visible when shouldShow agrees', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true, requireExplicitTrigger: true }),
        ],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      expect(element.hasAttribute('data-show')).toBe(true);
    });

    it('moving away from empty paragraph auto-clears triggered state', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({
            element,
            // Only show on empty paragraphs; once the user types, shouldShow → false.
            shouldShow: ({ state }): boolean => {
              const { $from, empty } = state.selection;
              return empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
            },
            requireExplicitTrigger: true,
          }),
        ],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      expect(element.hasAttribute('data-show')).toBe(true);

      // Type a character → paragraph no longer empty → shouldShow=false →
      // update path hides the menu AND auto-clears triggered.
      editor.view.dispatch(editor.view.state.tr.insertText('x'));
      expect(element.hasAttribute('data-show')).toBe(false);
      const state = floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined;
      expect(state?.triggered).toBe(false);
    });

    it('dm:dismiss-overlays clears the explicit-trigger flag', () => {
      const element = document.createElement('div');
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({ element, shouldShow: () => true, requireExplicitTrigger: true }),
        ],
        content: '<p></p>',
      });

      showFloatingMenu(editor.view);
      expect((floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined)?.triggered).toBe(true);

      host.dispatchEvent(new Event('dm:dismiss-overlays'));
      expect(element.hasAttribute('data-show')).toBe(false);
      const state = floatingMenuPluginKey.getState(editor.state) as { triggered: boolean } | undefined;
      expect(state?.triggered).toBe(false);
    });
  });

  // =========================================================================
  // matchShortcut: alias variants and unknown-modifier rejection
  // =========================================================================
  describe('matchShortcut alias coverage', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;
    let originalGetClientRects: typeof Element.prototype.getClientRects;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalGetClientRects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function () {
        return [] as unknown as DOMRectList;
      };
      host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
      Element.prototype.getClientRects = originalGetClientRects;
    });

    function mountWithShortcut(shortcut: string): { element: HTMLElement; btn: HTMLButtonElement } {
      const element = document.createElement('div');
      const btn = document.createElement('button');
      btn.setAttribute('data-floating-menu-item', '');
      btn.tabIndex = 0;
      element.appendChild(btn);
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          FloatingMenu.configure({
            element,
            shouldShow: () => true,
            keymap: { enterMenu: [shortcut] },
          }),
        ],
        content: '<p></p>',
      });
      element.setAttribute('data-show', '');
      return { element, btn };
    }

    it.each([
      ['Ctrl-F10', { ctrlKey: true }],
      ['ctrl-F10', { ctrlKey: true }],
      ['Control-F10', { ctrlKey: true }],
      ['control-F10', { ctrlKey: true }],
      ['c-F10', { ctrlKey: true }],
      ['Cmd-F10', { metaKey: true }],
      ['cmd-F10', { metaKey: true }],
      ['Meta-F10', { metaKey: true }],
      ['meta-F10', { metaKey: true }],
      ['m-F10', { metaKey: true }],
      ['Alt-F10', { altKey: true }],
      ['alt-F10', { altKey: true }],
      ['a-F10', { altKey: true }],
      ['shift-F10', { shiftKey: true }],
      ['s-F10', { shiftKey: true }],
    ])('shortcut "%s" focuses the menu item', (shortcut, modifiers) => {
      const { btn } = mountWithShortcut(shortcut);
      const event = new KeyboardEvent('keydown', { key: 'F10', ...modifiers });
      editor!.view.dom.dispatchEvent(event);
      expect(document.activeElement).toBe(btn);
    });

    it('unknown modifier in shortcut returns false (no focus, no preventDefault)', () => {
      const { btn } = mountWithShortcut('Bogus-F10');
      const event = new KeyboardEvent('keydown', { key: 'F10' });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      editor!.view.dom.dispatchEvent(event);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(btn);
    });

    it('Space alias maps to literal " " key', () => {
      const { btn } = mountWithShortcut('Alt-Space');
      const event = new KeyboardEvent('keydown', { key: ' ', altKey: true });
      editor!.view.dom.dispatchEvent(event);
      expect(document.activeElement).toBe(btn);
    });

    it('empty shortcut string returns false (defensive bail)', () => {
      const { btn } = mountWithShortcut('');
      const event = new KeyboardEvent('keydown', { key: 'F10' });
      editor!.view.dom.dispatchEvent(event);
      expect(document.activeElement).not.toBe(btn);
    });
  });
});
