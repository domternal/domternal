/**
 * Tests for FloatingMenuController - headless floating-menu state machine
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FloatingMenuController,
  FLOATING_MENU_NO_FOCUS,
} from './FloatingMenuController.js';
import type { Editor } from './Editor.js';
import type { FloatingMenuItem, FloatingMenuItemsOverride } from './types/FloatingMenu.js';

// === Test helpers ===

interface MockEditorOptions {
  items?: FloatingMenuItem[];
  commands?: Record<string, (...args: unknown[]) => boolean>;
  canCommands?: Record<string, (...args: unknown[]) => boolean>;
  canThrows?: boolean;
}

function createMockEditor(opts: MockEditorOptions = {}): {
  editor: Editor;
  handlers: Map<string, (() => void)[]>;
} {
  const handlers = new Map<string, (() => void)[]>();
  const editor = {
    floatingMenuItems: opts.items ?? [],
    commands: opts.commands ?? {},
    can: (): Record<string, (...args: unknown[]) => boolean> => {
      if (opts.canThrows) throw new Error('can() failure');
      return opts.canCommands ?? {};
    },
    on: (name: string, handler: () => void): void => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    off: (name: string, handler: () => void): void => {
      const list = handlers.get(name) ?? [];
      handlers.set(
        name,
        list.filter((h) => h !== handler),
      );
    },
  } as unknown as Editor;
  return { editor, handlers };
}

function item(name: string, overrides?: Partial<FloatingMenuItem>): FloatingMenuItem {
  return {
    name,
    label: name,
    command: `insert${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    ...overrides,
  };
}

describe('FloatingMenuController', () => {
  let controller: FloatingMenuController | undefined;

  afterEach(() => {
    controller?.destroy();
    controller = undefined;
  });

  // =========================================================================
  // Static: resolveItems
  // =========================================================================
  describe('resolveItems', () => {
    it('returns defaults when no override', () => {
      const defaults = [item('a'), item('b')];
      const { editor } = createMockEditor({ items: defaults });
      expect(FloatingMenuController.resolveItems(editor)).toBe(defaults);
    });

    it('returns array override verbatim', () => {
      const defaults = [item('a')];
      const override = [item('x'), item('y')];
      const { editor } = createMockEditor({ items: defaults });
      expect(FloatingMenuController.resolveItems(editor, override)).toBe(override);
    });

    it('calls function override with defaults and editor', () => {
      const defaults = [item('a')];
      const { editor } = createMockEditor({ items: defaults });
      const fn: FloatingMenuItemsOverride = (defs, ed) => {
        expect(defs).toBe(defaults);
        expect(ed).toBe(editor);
        return [...defs, item('b')];
      };
      const result = FloatingMenuController.resolveItems(editor, fn);
      expect(result.map((i) => i.name)).toEqual(['a', 'b']);
    });

    it('falls back to defaults when function override throws', () => {
      const defaults = [item('a')];
      const { editor } = createMockEditor({ items: defaults });
      const fn: FloatingMenuItemsOverride = () => {
        throw new Error('boom');
      };
      expect(FloatingMenuController.resolveItems(editor, fn)).toBe(defaults);
    });
  });

  // =========================================================================
  // Static: executeItem
  // =========================================================================
  describe('executeItem', () => {
    it('calls function command with editor', () => {
      const { editor } = createMockEditor();
      const cmd = vi.fn();
      FloatingMenuController.executeItem(editor, item('fn', { command: cmd }));
      expect(cmd).toHaveBeenCalledWith(editor);
    });

    it('invokes string command via editor.commands without args', () => {
      const cmd = vi.fn().mockReturnValue(true);
      const { editor } = createMockEditor({ commands: { toggleBold: cmd } });
      FloatingMenuController.executeItem(editor, item('bold', { command: 'toggleBold' }));
      expect(cmd).toHaveBeenCalledTimes(1);
      expect(cmd).toHaveBeenCalledWith();
    });

    it('invokes string command with commandArgs', () => {
      const cmd = vi.fn().mockReturnValue(true);
      const { editor } = createMockEditor({ commands: { toggleHeading: cmd } });
      FloatingMenuController.executeItem(
        editor,
        item('h1', { command: 'toggleHeading', commandArgs: [{ level: 1 }] }),
      );
      expect(cmd).toHaveBeenCalledWith({ level: 1 });
    });

    it('silently no-ops when command name missing from editor.commands', () => {
      const { editor } = createMockEditor({ commands: {} });
      expect(() => {
        FloatingMenuController.executeItem(editor, item('missing', { command: 'nope' }));
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Constructor / rebuild / groupItems
  // =========================================================================
  describe('rebuild and grouping', () => {
    it('rebuilds on construction with no items', () => {
      const { editor } = createMockEditor({ items: [] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.groups).toEqual([]);
      expect(controller.flatItems).toEqual([]);
      expect(controller.itemCount).toBe(0);
    });

    it('groups items by group name, preserving first-seen order, ungrouped first', () => {
      const items = [
        item('a', { group: 'Basic' }),
        item('b', { group: 'Media' }),
        item('c', { group: 'Basic' }),
        item('d'), // empty group
      ];
      const { editor } = createMockEditor({ items });
      controller = new FloatingMenuController(editor, () => undefined);
      const groupNames = controller.groups.map((g) => g.name);
      // Ungrouped leads however late it arrives; ordering itself is tested in
      // groupFloatingMenuItems.test.ts.
      expect(groupNames).toEqual(['', 'Basic', 'Media']);
      const basic = controller.groups.find((g) => g.name === 'Basic')!;
      expect(basic.items.map((i) => i.name)).toEqual(['a', 'c']);
    });

    it('sorts items within group by priority (higher first), defaults to 100', () => {
      const items = [
        item('low', { group: 'G', priority: 10 }),
        item('high', { group: 'G', priority: 500 }),
        item('mid', { group: 'G' }),
      ];
      const { editor } = createMockEditor({ items });
      controller = new FloatingMenuController(editor, () => undefined);
      const names = controller.groups[0]!.items.map((i) => i.name);
      expect(names).toEqual(['high', 'mid', 'low']);
    });

    it('flatItems is flat order across groups', () => {
      const items = [
        item('a', { group: 'G1' }),
        item('b', { group: 'G2' }),
        item('c', { group: 'G1' }),
      ];
      const { editor } = createMockEditor({ items });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.flatItems.map((i) => i.name)).toEqual(['a', 'c', 'b']);
      expect(controller.itemCount).toBe(3);
    });

    it('applies override at construction time', () => {
      const defaults = [item('a'), item('b')];
      const { editor } = createMockEditor({ items: defaults });
      controller = new FloatingMenuController(
        editor,
        () => undefined,
        [item('x')],
      );
      expect(controller.flatItems.map((i) => i.name)).toEqual(['x']);
    });

    it('rebuild resets focusedIndex when it exceeds new item count', () => {
      const { editor } = createMockEditor({ items: [item('a'), item('b'), item('c')] });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.last(); // focuses index 2
      expect(controller.focusedIndex).toBe(2);

      // Simulate editor returning fewer items, then force rebuild.
      (editor as unknown as { floatingMenuItems: FloatingMenuItem[] }).floatingMenuItems = [
        item('a'),
      ];
      controller.rebuild();
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
    });
  });

  // =========================================================================
  // Keyboard navigation (roving tabindex)
  // =========================================================================
  describe('keyboard navigation', () => {
    const buildItems = (): FloatingMenuItem[] => [item('a'), item('b'), item('c')];

    it('enterMenu focuses first item and notifies', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
      expect(controller.isEntered).toBe(false);

      expect(controller.enterMenu()).toBe(0);
      expect(controller.focusedIndex).toBe(0);
      expect(controller.isEntered).toBe(true);
      expect(onChange).toHaveBeenCalled();
    });

    it('enterMenu returns NO_FOCUS when no items', () => {
      const { editor } = createMockEditor({ items: [] });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      expect(controller.enterMenu()).toBe(FLOATING_MENU_NO_FOCUS);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('leaveMenu clears focus and notifies', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.enterMenu();
      onChange.mockClear();

      controller.leaveMenu();
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('leaveMenu is no-op when already un-focused', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.leaveMenu();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('next wraps around to 0 at end', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      controller.enterMenu();
      expect(controller.next()).toBe(1);
      expect(controller.next()).toBe(2);
      expect(controller.next()).toBe(0);
    });

    it('next from NO_FOCUS starts at index 0', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.next()).toBe(0);
    });

    it('next returns NO_FOCUS for empty item list', () => {
      const { editor } = createMockEditor({ items: [] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.next()).toBe(FLOATING_MENU_NO_FOCUS);
    });

    it('prev wraps around to last at start', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      controller.enterMenu();
      expect(controller.prev()).toBe(2);
      expect(controller.prev()).toBe(1);
    });

    it('prev from NO_FOCUS wraps to last', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.prev()).toBe(2);
    });

    it('prev returns NO_FOCUS for empty item list', () => {
      const { editor } = createMockEditor({ items: [] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.prev()).toBe(FLOATING_MENU_NO_FOCUS);
    });

    it('first moves to index 0', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      controller.last();
      expect(controller.first()).toBe(0);
    });

    it('first returns NO_FOCUS on empty list', () => {
      const { editor } = createMockEditor({ items: [] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.first()).toBe(FLOATING_MENU_NO_FOCUS);
    });

    it('last moves to final index', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.last()).toBe(2);
    });

    it('last returns NO_FOCUS on empty list', () => {
      const { editor } = createMockEditor({ items: [] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.last()).toBe(FLOATING_MENU_NO_FOCUS);
    });

    it('setFocusedIndex sets index and notifies on change', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.setFocusedIndex(1);
      expect(controller.focusedIndex).toBe(1);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('setFocusedIndex ignores out-of-range values', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.setFocusedIndex(-1);
      controller.setFocusedIndex(99);
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('setFocusedIndex no-ops when index unchanged', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.setFocusedIndex(1);
      onChange.mockClear();
      controller.setFocusedIndex(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('focusedItem returns current item or null', () => {
      const items = buildItems();
      const { editor } = createMockEditor({ items });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.focusedItem()).toBe(null);
      controller.setFocusedIndex(1);
      expect(controller.focusedItem()).toBe(items[1]);
    });

    it('getFlatIndex returns index by name or -1', () => {
      const { editor } = createMockEditor({ items: buildItems() });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.getFlatIndex('a')).toBe(0);
      expect(controller.getFlatIndex('c')).toBe(2);
      expect(controller.getFlatIndex('missing')).toBe(-1);
    });
  });

  // =========================================================================
  // execute + disabled state
  // =========================================================================
  describe('execute and disabled state', () => {
    it('execute runs command and resets focus', () => {
      const cmd = vi.fn().mockReturnValue(true);
      const { editor } = createMockEditor({
        items: [item('bold', { command: 'toggleBold' })],
        commands: { toggleBold: cmd },
      });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.enterMenu();
      onChange.mockClear();

      controller.execute(controller.flatItems[0]!);
      expect(cmd).toHaveBeenCalled();
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
      expect(onChange).toHaveBeenCalled();
    });

    it('execute no-ops when item is disabled', () => {
      const cmd = vi.fn();
      const disabled = item('x', {
        command: 'nope',
        isDisabled: () => true,
      });
      const { editor } = createMockEditor({
        items: [disabled],
        commands: { nope: cmd },
      });
      controller = new FloatingMenuController(editor, () => undefined);
      controller.execute(controller.flatItems[0]!);
      expect(cmd).not.toHaveBeenCalled();
    });

    it('isDisabled returns false by default', () => {
      const { editor } = createMockEditor({ items: [item('a')] });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
    });

    it('uses custom isDisabled predicate when provided', () => {
      const { editor } = createMockEditor({
        items: [item('x', { isDisabled: () => true })],
      });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(true);
      expect(onChange).toHaveBeenCalled(); // first disabled-state change notifies
    });

    it('isDisabled predicate exceptions fall back to false', () => {
      const { editor } = createMockEditor({
        items: [
          item('x', {
            isDisabled: () => {
              throw new Error('boom');
            },
          }),
        ],
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
    });

    it('falls back to editor.can() dry-run for string commands without isDisabled', () => {
      const canToggle = vi.fn().mockReturnValue(false); // can't -> disabled
      const { editor } = createMockEditor({
        items: [item('b', { command: 'toggleBold' })],
        canCommands: { toggleBold: canToggle },
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(true);
      expect(canToggle).toHaveBeenCalled();
    });

    it('passes commandArgs into can() dry-run', () => {
      const canToggle = vi.fn().mockReturnValue(true); // can -> enabled
      const { editor } = createMockEditor({
        items: [
          item('h1', {
            command: 'toggleHeading',
            commandArgs: [{ level: 1 }],
          }),
        ],
        canCommands: { toggleHeading: canToggle },
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
      expect(canToggle).toHaveBeenCalledWith({ level: 1 });
    });

    it('ignores can() dry-run exceptions', () => {
      const canToggle = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      const { editor } = createMockEditor({
        items: [item('b', { command: 'toggleBold' })],
        canCommands: { toggleBold: canToggle },
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
    });

    it('skips disabled detection when editor.can() throws', () => {
      const { editor } = createMockEditor({
        items: [item('b', { command: 'toggleBold' })],
        canThrows: true,
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
    });

    it('no disabled detection for function commands (left enabled)', () => {
      const { editor } = createMockEditor({
        items: [item('fn', { command: () => undefined })],
      });
      controller = new FloatingMenuController(editor, () => undefined);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);
    });

    it('disabledMap getter returns read-only view', () => {
      const { editor } = createMockEditor({
        items: [item('x', { isDisabled: () => true })],
      });
      controller = new FloatingMenuController(editor, () => undefined);
      const map = controller.disabledMap;
      expect(map.get('x')).toBe(true);
    });
  });

  // =========================================================================
  // Lifecycle: subscribe / destroy
  // =========================================================================
  describe('lifecycle', () => {
    it('subscribe registers transaction handler that refreshes disabled state', () => {
      let allowed = true;
      const canToggle = vi.fn(() => allowed);
      const { editor, handlers } = createMockEditor({
        items: [item('b', { command: 'toggleBold' })],
        canCommands: { toggleBold: canToggle },
      });
      const onChange = vi.fn();
      controller = new FloatingMenuController(editor, onChange);
      controller.subscribe();

      expect(handlers.get('transaction')?.length).toBe(1);
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(false);

      onChange.mockClear();
      allowed = false;
      handlers.get('transaction')?.[0]?.();
      expect(controller.isDisabled(controller.flatItems[0]!)).toBe(true);
      expect(onChange).toHaveBeenCalled();
    });

    it('destroy unsubscribes and resets internal state', () => {
      const { editor, handlers } = createMockEditor({
        items: [item('a'), item('b')],
      });
      controller = new FloatingMenuController(editor, () => undefined);
      controller.subscribe();
      controller.enterMenu();
      expect(controller.focusedIndex).toBe(0);

      controller.destroy();
      expect(handlers.get('transaction')?.length).toBe(0);
      expect(controller.groups).toEqual([]);
      expect(controller.flatItems).toEqual([]);
      expect(controller.focusedIndex).toBe(FLOATING_MENU_NO_FOCUS);
      expect(controller.disabledMap.size).toBe(0);

      // Safe to call destroy twice (no transaction handler).
      expect(() => controller?.destroy()).not.toThrow();
      controller = undefined;
    });
  });
});
