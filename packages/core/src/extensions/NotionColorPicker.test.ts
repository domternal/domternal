/**
 * Tests for NotionColorPicker extension
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import {
  NotionColorPicker,
  DEFAULT_NOTION_COLOR_PALETTE,
  type RecentEntry,
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

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    localStorage.clear();
  });

  describe('configuration', () => {
    it('has correct name and type', () => {
      expect(NotionColorPicker.name).toBe('notionColorPicker');
      expect(NotionColorPicker.type).toBe('extension');
    });

    it('has default options', () => {
      expect(NotionColorPicker.options.palette).toEqual(DEFAULT_NOTION_COLOR_PALETTE);
      expect(NotionColorPicker.options.recentLimit).toBe(5);
      expect(NotionColorPicker.options.storageKey).toBe('dm-notion-color-recent');
    });

    it('default palette matches Notion 9-color set', () => {
      expect(DEFAULT_NOTION_COLOR_PALETTE).toEqual([
        'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
      ]);
    });

    it('can configure palette, recentLimit, storageKey', () => {
      const custom = NotionColorPicker.configure({
        palette: ['gray', 'blue'],
        recentLimit: 10,
        storageKey: 'custom-key',
      });
      expect(custom.options.palette).toEqual(['gray', 'blue']);
      expect(custom.options.recentLimit).toBe(10);
      expect(custom.options.storageKey).toBe('custom-key');
    });

    it('palette is frozen to prevent accidental mutation', () => {
      expect(Object.isFrozen(DEFAULT_NOTION_COLOR_PALETTE)).toBe(true);
    });
  });

  describe('storage initialization', () => {
    it('starts with empty recent and isOpen=false when localStorage empty', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
      expect((editor.storage['notionColorPicker'] as { isOpen: boolean }).isOpen).toBe(false);
    });

    it('loads recent from localStorage on init', () => {
      const seed: RecentEntry[] = [
        { kind: 'text', token: 'gray' },
        { kind: 'bg', token: 'yellow' },
      ];
      localStorage.setItem('dm-notion-color-recent', JSON.stringify(seed));

      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual(seed);
    });

    it('ignores malformed JSON in localStorage', () => {
      localStorage.setItem('dm-notion-color-recent', 'not-json{');
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
    });

    it('filters out malformed entries from localStorage', () => {
      const mixed = [
        { kind: 'text', token: 'gray' },          // valid
        { kind: 'bogus', token: 'red' },           // invalid kind
        null,                                      // not an object
        { kind: 'bg', token: 42 },                 // invalid token type
        { kind: 'bg', token: null },               // valid (null = default)
      ];
      localStorage.setItem('dm-notion-color-recent', JSON.stringify(mixed));
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
        { kind: 'bg', token: null },
      ]);
    });

    it('storageKey=null disables persistence', () => {
      const Disabled = NotionColorPicker.configure({ storageKey: null });
      // Pre-populate the default key — it must be ignored.
      localStorage.setItem('dm-notion-color-recent', JSON.stringify([
        { kind: 'text', token: 'gray' },
      ]));
      editor = new Editor({
        extensions: [...baseExtensions, Disabled],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
    });
  });

  describe('pushRecentColor command', () => {
    it('adds entry to front of recent list', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
      ]);
    });

    it('newest-first ordering', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      editor.commands.pushRecentColor({ kind: 'bg', token: 'yellow' });
      editor.commands.pushRecentColor({ kind: 'text', token: 'red' });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'red' },
        { kind: 'bg', token: 'yellow' },
        { kind: 'text', token: 'gray' },
      ]);
    });

    it('deduplicates by (kind, token)', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      editor.commands.pushRecentColor({ kind: 'bg', token: 'gray' });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' }); // re-push
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },  // moved to front
        { kind: 'bg', token: 'gray' },    // different kind, kept
      ]);
    });

    it('respects recentLimit', () => {
      const Limited = NotionColorPicker.configure({ recentLimit: 2 });
      editor = new Editor({
        extensions: [...baseExtensions, Limited],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      editor.commands.pushRecentColor({ kind: 'bg', token: 'yellow' });
      editor.commands.pushRecentColor({ kind: 'text', token: 'red' });
      const recent = (editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent;
      expect(recent).toHaveLength(2);
      expect(recent[0]).toEqual({ kind: 'text', token: 'red' });
    });

    it('persists to localStorage', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      const raw = localStorage.getItem('dm-notion-color-recent');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual([{ kind: 'text', token: 'gray' }]);
    });

    it('does not persist when storageKey is null', () => {
      const Disabled = NotionColorPicker.configure({ storageKey: null });
      editor = new Editor({
        extensions: [...baseExtensions, Disabled],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      expect(localStorage.getItem('dm-notion-color-recent')).toBeNull();
    });

    it('accepts null token (default-color entry)', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      const ok = editor.commands.pushRecentColor({ kind: 'text', token: null });
      expect(ok).toBe(true);
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent[0]).toEqual({
        kind: 'text', token: null,
      });
    });

    it('rejects invalid entries', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      const ok = editor.commands.pushRecentColor(
        { kind: 'bogus', token: 'x' } as unknown as RecentEntry,
      );
      expect(ok).toBe(false);
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
    });
  });

  describe('clearRecentColors command', () => {
    it('empties storage and localStorage', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      editor.commands.clearRecentColors();
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
      expect(localStorage.getItem('dm-notion-color-recent')).toBe('[]');
    });
  });

  describe('localStorage failure modes', () => {
    it('survives quota exceeded on setItem (recent stays in-memory)', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });

      // Force every future setItem to throw QuotaExceededError.
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

      const ok = editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      // In-memory write still succeeds even though persistence failed.
      expect(ok).toBe(true);
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
      ]);

      setItemSpy.mockRestore();
    });

    it('survives getItem throwing on init (recent stays empty)', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('access denied', 'SecurityError');
      });

      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);

      getItemSpy.mockRestore();
    });

    it('handles SSR-like environment where localStorage is undefined', () => {
      // Swap window.localStorage to a property descriptor that returns
      // undefined. Mirrors a Node SSR worker where globalThis has window
      // bindings but no Storage implementation.
      const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => undefined,
      });

      try {
        editor = new Editor({
          extensions: [...baseExtensions, NotionColorPicker],
          content: '<p>Hello</p>',
        });
        expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);

        // Push must still succeed in-memory (no persistence).
        const ok = editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
        expect(ok).toBe(true);
        expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
          { kind: 'text', token: 'gray' },
        ]);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(window, 'localStorage', originalDescriptor);
        }
      }
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

  describe('integration with TextColor / Highlight schema (Phase 1)', () => {
    it('setTextColorToken + pushRecentColor records the same selection', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      // Mirror what the picker UI does on swatch click.
      editor.commands.setTextColorToken('gray');
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });

      expect(editor.getHTML()).toContain('data-text-color="gray"');
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
      ]);
    });

    it('setBackgroundColorToken + pushRecentColor records the same selection', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      editor.commands.setBackgroundColorToken('yellow');
      editor.commands.pushRecentColor({ kind: 'bg', token: 'yellow' });

      expect(editor.getHTML()).toContain('data-bg-color="yellow"');
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'bg', token: 'yellow' },
      ]);
    });

    it('user picking text then bg builds 2-entry recent in MRU order', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello world</p>',
      });
      selectAll(editor);

      editor.commands.setTextColorToken('blue');
      editor.commands.pushRecentColor({ kind: 'text', token: 'blue' });
      editor.commands.setBackgroundColorToken('pink');
      editor.commands.pushRecentColor({ kind: 'bg', token: 'pink' });

      const html = editor.getHTML();
      expect(html).toContain('data-text-color="blue"');
      expect(html).toContain('data-bg-color="pink"');

      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'bg', token: 'pink' },
        { kind: 'text', token: 'blue' },
      ]);
    });

    it('loads without TextColor/Highlight extensions (commands missing but no crash)', () => {
      // Picker is independent of who registers colorToken / backgroundColorToken
      // attrs. Without TextColor + Highlight, the picker still works as a
      // storage + recent-tracker; only the mark commands are unavailable.
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      const ok = editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });
      expect(ok).toBe(true);
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toHaveLength(1);
    });
  });

  describe('multi-editor on same page (shared storageKey)', () => {
    it('writes from editor A propagate to editor B via storage event', () => {
      const editorA = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>A</p>',
      });
      const editorB = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>B</p>',
      });

      try {
        editorA.commands.pushRecentColor({ kind: 'text', token: 'gray' });

        // Same-tab storage event doesn't fire automatically; simulate the
        // browser-cross-tab behavior so editor B sees A's write. Real
        // browsers fire this on every other same-origin tab.
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'dm-notion-color-recent',
            newValue: localStorage.getItem('dm-notion-color-recent'),
            oldValue: null,
          }),
        );

        expect((editorB.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
          { kind: 'text', token: 'gray' },
        ]);
      } finally {
        editorA.destroy();
        editorB.destroy();
      }
    });

    it('separate storageKeys keep recents independent', () => {
      const A = NotionColorPicker.configure({ storageKey: 'editor-a-recent' });
      const B = NotionColorPicker.configure({ storageKey: 'editor-b-recent' });
      const editorA = new Editor({
        extensions: [...baseExtensions, A],
        content: '<p>A</p>',
      });
      const editorB = new Editor({
        extensions: [...baseExtensions, B],
        content: '<p>B</p>',
      });

      try {
        editorA.commands.pushRecentColor({ kind: 'text', token: 'gray' });
        editorB.commands.pushRecentColor({ kind: 'bg', token: 'yellow' });

        expect((editorA.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
          { kind: 'text', token: 'gray' },
        ]);
        expect((editorB.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
          { kind: 'bg', token: 'yellow' },
        ]);
      } finally {
        editorA.destroy();
        editorB.destroy();
        localStorage.removeItem('editor-a-recent');
        localStorage.removeItem('editor-b-recent');
      }
    });
  });

  describe('cross-tab sync via storage event', () => {
    it('updates recent when another tab writes the same key', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });

      const newValue = JSON.stringify([
        { kind: 'text', token: 'blue' },
        { kind: 'bg', token: 'pink' },
      ]);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'dm-notion-color-recent',
          newValue,
          oldValue: null,
        }),
      );

      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'blue' },
        { kind: 'bg', token: 'pink' },
      ]);
    });

    it('clears recent when another tab removes the key', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'dm-notion-color-recent',
          newValue: null,
          oldValue: 'whatever',
        }),
      );

      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([]);
    });

    it('ignores storage events for other keys', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: JSON.stringify([]),
          oldValue: null,
        }),
      );

      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
      ]);
    });

    it('ignores malformed payload from another tab', () => {
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.commands.pushRecentColor({ kind: 'text', token: 'gray' });

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'dm-notion-color-recent',
          newValue: 'not-json{',
          oldValue: null,
        }),
      );

      // Stale data preserved instead of crashing.
      expect((editor.storage['notionColorPicker'] as { recent: RecentEntry[] }).recent).toEqual([
        { kind: 'text', token: 'gray' },
      ]);
    });

    it('removes the storage listener on editor destroy', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      editor = new Editor({
        extensions: [...baseExtensions, NotionColorPicker],
        content: '<p>Hello</p>',
      });
      editor.destroy();
      editor = undefined;
      expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));
      removeSpy.mockRestore();
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

    it('button has a no-op fallback command (emitEvent takes priority at click time)', () => {
      const items = NotionColorPicker.config.addToolbarItems?.call(NotionColorPicker);
      const button = items?.[0] as ToolbarButton;
      // command is schema-required; clearRecentColors is a sensible no-op
      // for hosts that haven't wired up the popover UI.
      expect(button.command).toBe('clearRecentColors');
    });
  });
});
