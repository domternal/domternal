/**
 * Tests for NotionColorPicker extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import {
  NotionColorPicker,
  DEFAULT_NOTION_COLOR_PALETTE,
} from './NotionColorPicker.js';
import { TextStyle } from '../marks/TextStyle.js';
import { TextColor } from './TextColor.js';
import { Highlight } from './Highlight.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import type { ToolbarButton } from '../types/Toolbar.js';

const baseExtensions = [Document, Text, Paragraph, TextStyle, TextColor, Highlight];

function selectAll(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1),
    ),
  );
}

describe('NotionColorPicker', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name and type', () => {
      expect(NotionColorPicker.name).toBe('notionColorPicker');
      expect(NotionColorPicker.type).toBe('extension');
    });

    it('has default options', () => {
      expect(NotionColorPicker.options.palette).toEqual(DEFAULT_NOTION_COLOR_PALETTE);
    });

    it('default palette matches Notion 9-color set', () => {
      expect(DEFAULT_NOTION_COLOR_PALETTE).toEqual([
        'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
      ]);
    });

    it('can configure palette', () => {
      const custom = NotionColorPicker.configure({ palette: ['gray', 'blue'] });
      expect(custom.options.palette).toEqual(['gray', 'blue']);
    });

    it('palette is frozen to prevent accidental mutation', () => {
      expect(Object.isFrozen(DEFAULT_NOTION_COLOR_PALETTE)).toBe(true);
    });
  });

  describe('storage initialization', () => {
    it('starts with isOpen=false', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { isOpen: boolean }).isOpen).toBe(false);
    });
  });

  describe('isOpen flag', () => {
    it('starts false and is writable (UI lifecycle marker)', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      const storage = editor.storage['notionColorPicker'] as { isOpen: boolean };
      expect(storage.isOpen).toBe(false);

      // UI wrappers flip this when the picker mounts/unmounts.
      storage.isOpen = true;
      expect(storage.isOpen).toBe(true);

      storage.isOpen = false;
      expect(storage.isOpen).toBe(false);
    });
  });

  describe('integration with TextColor / Highlight schema', () => {
    it('setTextColorToken applies data-text-color to the selection', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      editor.commands.setTextColorToken('gray');
      expect(editor.getHTML()).toContain('data-text-color="gray"');
    });

    it('setBackgroundColorToken applies data-bg-color to the selection', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      editor.commands.setBackgroundColorToken('yellow');
      expect(editor.getHTML()).toContain('data-bg-color="yellow"');
    });

    it('text + bg apply to the same selection independently', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      editor.commands.setTextColorToken('blue');
      editor.commands.setBackgroundColorToken('pink');

      const html = editor.getHTML();
      expect(html).toContain('data-text-color="blue"');
      expect(html).toContain('data-bg-color="pink"');
    });

    it('loads without TextColor/Highlight (just registers the toolbar item)', () => {
      // Picker is independent of who registers colorToken / backgroundColorToken
      // attrs. Without TextColor + Highlight the mark commands are unavailable
      // but the extension itself still loads cleanly.
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect(editor.storage['notionColorPicker']).toBeDefined();
    });
  });

  describe('addToolbarItems', () => {
    it('registers a single bubble-menu-only button', () => {
      const items = NotionColorPicker.config.addToolbarItems?.call(NotionColorPicker);
      expect(items).toHaveLength(1);
      const button = items?.[0] as ToolbarButton;
      expect(button.type).toBe('button');
      expect(button.name).toBe('notionColor');
      expect(button.toolbar).toBe(false);
      expect(button.emitEvent).toBe('notionColorOpen');
      expect(button.icon).toBe('textAUnderline');
      expect(button.group).toBe('textStyle');
    });

    it('button has a harmless fallback command (emitEvent takes priority at click time)', () => {
      const items = NotionColorPicker.config.addToolbarItems?.call(NotionColorPicker);
      const button = items?.[0] as ToolbarButton;
      expect(button.command).toBe('focus');
    });
  });
});
