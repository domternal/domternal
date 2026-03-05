/**
 * Tests for ToolbarController — headless toolbar state machine
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ToolbarController,
  type ToolbarControllerEditor,
} from './ToolbarController.js';
import type { ToolbarItem, ToolbarButton, ToolbarDropdown, ToolbarLayoutEntry } from './types/Toolbar.js';

// === Test helpers ===

function createMockEditor(
  items: ToolbarItem[] = [],
  overrides?: Partial<ToolbarControllerEditor>,
): ToolbarControllerEditor {
  return {
    toolbarItems: items,
    storage: {},
    isActive: () => false,
    commands: {},
    can: () => ({}),
    on: () => { /* stub */ },
    off: () => { /* stub */ },
    ...overrides,
  };
}

function btn(name: string, overrides?: Partial<ToolbarButton>): ToolbarButton {
  return {
    type: 'button',
    name,
    command: `toggle${name.charAt(0).toUpperCase() + name.slice(1)}`,
    icon: name,
    label: name,
    ...overrides,
  };
}

function dropdown(name: string, items: ToolbarButton[], overrides?: Partial<ToolbarDropdown>): ToolbarDropdown {
  return {
    type: 'dropdown',
    name,
    icon: name,
    label: name,
    items,
    ...overrides,
  };
}

describe('ToolbarController', () => {
  let controller: ToolbarController | undefined;

  afterEach(() => {
    controller?.destroy();
  });

  // =========================================================================
  // Static: resolveActive
  // =========================================================================
  describe('resolveActive', () => {
    it('returns false when no isActive and no isActiveFn', () => {
      const editor = createMockEditor();
      const item = btn('bold');
      expect(ToolbarController.resolveActive(editor, item)).toBe(false);
    });

    it('uses isActiveFn when defined (takes precedence)', () => {
      const editor = createMockEditor();
      const item = btn('custom', { isActiveFn: () => true });
      expect(ToolbarController.resolveActive(editor, item)).toBe(true);
    });

    it('isActiveFn receives editor as argument', () => {
      const editor = createMockEditor([], { storage: { myExt: { flag: true } } });
      const item = btn('custom', {
        isActiveFn: (ed) => (ed.storage['myExt'] as { flag: boolean }).flag,
      });
      expect(ToolbarController.resolveActive(editor, item)).toBe(true);
    });

    it('resolves string isActive via editor.isActive(name)', () => {
      const isActive = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { isActive });
      const item = btn('bold', { isActive: 'bold' });
      expect(ToolbarController.resolveActive(editor, item)).toBe(true);
      expect(isActive).toHaveBeenCalledWith('bold');
    });

    it('resolves object isActive via editor.isActive(name, attributes)', () => {
      const isActive = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { isActive });
      const item = btn('heading', {
        isActive: { name: 'heading', attributes: { level: 1 } },
      });
      expect(ToolbarController.resolveActive(editor, item)).toBe(true);
      expect(isActive).toHaveBeenCalledWith('heading', { level: 1 });
    });

    it('resolves array isActive — true if any match', () => {
      const isActive = vi.fn()
        .mockReturnValueOnce(false)  // first check
        .mockReturnValueOnce(true);  // second check
      const editor = createMockEditor([], { isActive });
      const item = btn('alignLeft', {
        isActive: [
          'paragraph',
          { name: 'heading', attributes: { textAlign: 'left' } },
        ],
      });
      expect(ToolbarController.resolveActive(editor, item)).toBe(true);
    });

    it('resolves array isActive — false if none match', () => {
      const isActive = vi.fn().mockReturnValue(false);
      const editor = createMockEditor([], { isActive });
      const item = btn('alignLeft', {
        isActive: ['paragraph', { name: 'heading', attributes: { textAlign: 'left' } }],
      });
      expect(ToolbarController.resolveActive(editor, item)).toBe(false);
    });

    it('isActiveFn takes precedence over isActive string', () => {
      const isActive = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { isActive });
      const item = btn('bold', {
        isActive: 'bold',
        isActiveFn: () => false,
      });
      expect(ToolbarController.resolveActive(editor, item)).toBe(false);
      expect(isActive).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Static: executeItem
  // =========================================================================
  describe('executeItem', () => {
    it('calls command without args', () => {
      const toggleBold = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { commands: { toggleBold } });
      const item = btn('bold', { command: 'toggleBold' });

      ToolbarController.executeItem(editor, item);
      expect(toggleBold).toHaveBeenCalledOnce();
      expect(toggleBold).toHaveBeenCalledWith();
    });

    it('calls command with args', () => {
      const setHeading = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { commands: { setHeading } });
      const item = btn('h1', { command: 'setHeading', commandArgs: [{ level: 1 }] });

      ToolbarController.executeItem(editor, item);
      expect(setHeading).toHaveBeenCalledWith({ level: 1 });
    });

    it('does not throw for missing command', () => {
      const editor = createMockEditor([], { commands: {} });
      const item = btn('missing', { command: 'nonexistent' });

      expect(() => { ToolbarController.executeItem(editor, item); }).not.toThrow();
    });

    it('does not call command when commandArgs is empty array', () => {
      const toggleBold = vi.fn().mockReturnValue(true);
      const editor = createMockEditor([], { commands: { toggleBold } });
      const item = btn('bold', { command: 'toggleBold', commandArgs: [] });

      ToolbarController.executeItem(editor, item);
      expect(toggleBold).toHaveBeenCalledWith();
    });
  });

  // =========================================================================
  // Constructor & Grouping
  // =========================================================================
  describe('constructor', () => {
    it('builds groups from toolbarItems on creation', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('italic', { group: 'format' }),
        btn('undo', { group: 'history' }),
      ];
      const editor = createMockEditor(items);
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);

      expect(controller.groups).toHaveLength(2);
      expect(controller.groups[0]!.name).toBe('format');
      expect(controller.groups[0]!.items).toHaveLength(2);
      expect(controller.groups[1]!.name).toBe('history');
      expect(controller.groups[1]!.items).toHaveLength(1);
    });

    it('places items without group in default empty-string group', () => {
      const items: ToolbarItem[] = [btn('bold'), btn('italic')];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.name).toBe('');
    });

    it('preserves group order of first appearance', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'B' }),
        btn('undo', { group: 'A' }),
        btn('italic', { group: 'B' }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups[0]!.name).toBe('B');
      expect(controller.groups[1]!.name).toBe('A');
    });

    it('starts with focusedIndex at 0', () => {
      controller = new ToolbarController(createMockEditor([btn('bold')]), vi.fn());
      expect(controller.focusedIndex).toBe(0);
    });

    it('starts with no open dropdown', () => {
      controller = new ToolbarController(createMockEditor([btn('bold')]), vi.fn());
      expect(controller.openDropdown).toBe(null);
    });
  });

  // =========================================================================
  // Priority sorting
  // =========================================================================
  describe('priority sorting', () => {
    it('sorts items within group by priority (higher first)', () => {
      const items: ToolbarItem[] = [
        btn('low', { group: 'g', priority: 10 }),
        btn('high', { group: 'g', priority: 200 }),
        btn('mid', { group: 'g', priority: 100 }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toEqual(['high', 'mid', 'low']);
    });

    it('defaults to priority 100 when not specified', () => {
      const items: ToolbarItem[] = [
        btn('explicit', { group: 'g', priority: 200 }),
        btn('default', { group: 'g' }),  // no priority → defaults to 100
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toEqual(['explicit', 'default']);
    });

    it('handles priority: 0 correctly (not treated as default 100)', () => {
      const items: ToolbarItem[] = [
        btn('zero', { group: 'g', priority: 0 }),
        btn('default', { group: 'g' }),  // defaults to 100
        btn('fifty', { group: 'g', priority: 50 }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      const names = controller.groups[0]!.items.map(i => i.name);
      // 100 > 50 > 0
      expect(names).toEqual(['default', 'fifty', 'zero']);
    });

    it('sorts dropdowns by priority within their group', () => {
      const items: ToolbarItem[] = [
        dropdown('headings', [btn('h1')], { group: 'blocks', priority: 50 }),
        btn('bold', { group: 'blocks', priority: 200 }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toEqual(['bold', 'headings']);
    });
  });

  // =========================================================================
  // Keyboard navigation
  // =========================================================================
  describe('keyboard navigation', () => {
    function createNavController(count: number): ToolbarController {
      const items = Array.from({ length: count }, (_, i) => btn(`btn${String(i)}`));
      const editor = createMockEditor(items);
      return new ToolbarController(editor, vi.fn());
    }

    describe('navigateNext', () => {
      it('moves to next button', () => {
        controller = createNavController(3);
        expect(controller.focusedIndex).toBe(0);

        const idx = controller.navigateNext();
        expect(idx).toBe(1);
        expect(controller.focusedIndex).toBe(1);
      });

      it('wraps around to first button', () => {
        controller = createNavController(3);
        controller.navigateNext(); // 1
        controller.navigateNext(); // 2

        const idx = controller.navigateNext();
        expect(idx).toBe(0);
      });

      it('returns -1 for empty toolbar', () => {
        controller = new ToolbarController(createMockEditor([]), vi.fn());
        expect(controller.navigateNext()).toBe(-1);
      });

      it('calls onChange', () => {
        const onChange = vi.fn();
        const editor = createMockEditor([btn('a'), btn('b')]);
        controller = new ToolbarController(editor, onChange);

        controller.navigateNext();
        expect(onChange).toHaveBeenCalled();
      });
    });

    describe('navigatePrev', () => {
      it('moves to previous button', () => {
        controller = createNavController(3);
        controller.navigateNext(); // 1

        const idx = controller.navigatePrev();
        expect(idx).toBe(0);
      });

      it('wraps around to last button', () => {
        controller = createNavController(3);
        expect(controller.focusedIndex).toBe(0);

        const idx = controller.navigatePrev();
        expect(idx).toBe(2);
      });

      it('returns -1 for empty toolbar', () => {
        controller = new ToolbarController(createMockEditor([]), vi.fn());
        expect(controller.navigatePrev()).toBe(-1);
      });
    });

    describe('navigateFirst', () => {
      it('moves to first button', () => {
        controller = createNavController(3);
        controller.navigateNext(); // 1
        controller.navigateNext(); // 2

        const idx = controller.navigateFirst();
        expect(idx).toBe(0);
        expect(controller.focusedIndex).toBe(0);
      });
    });

    describe('navigateLast', () => {
      it('moves to last button', () => {
        controller = createNavController(3);

        const idx = controller.navigateLast();
        expect(idx).toBe(2);
        expect(controller.focusedIndex).toBe(2);
      });

      it('returns 0 for single button toolbar', () => {
        controller = createNavController(1);
        const idx = controller.navigateLast();
        expect(idx).toBe(0);
      });

      it('returns 0 for empty toolbar', () => {
        controller = new ToolbarController(createMockEditor([]), vi.fn());
        expect(controller.navigateLast()).toBe(0);
      });
    });

    describe('setFocusedIndex', () => {
      it('sets valid index', () => {
        controller = createNavController(3);
        controller.setFocusedIndex(2);
        expect(controller.focusedIndex).toBe(2);
      });

      it('ignores negative index', () => {
        controller = createNavController(3);
        controller.setFocusedIndex(-1);
        expect(controller.focusedIndex).toBe(0);
      });

      it('ignores out-of-range index', () => {
        controller = createNavController(3);
        controller.setFocusedIndex(10);
        expect(controller.focusedIndex).toBe(0);
      });
    });

    describe('getFlatIndex', () => {
      it('returns correct index for known item', () => {
        const items: ToolbarItem[] = [
          btn('bold', { group: 'format' }),
          btn('italic', { group: 'format' }),
          btn('undo', { group: 'history' }),
        ];
        controller = new ToolbarController(createMockEditor(items), vi.fn());

        expect(controller.getFlatIndex('bold')).toBe(0);
        expect(controller.getFlatIndex('italic')).toBe(1);
        expect(controller.getFlatIndex('undo')).toBe(2);
      });

      it('returns -1 for unknown item', () => {
        controller = new ToolbarController(createMockEditor([btn('bold')]), vi.fn());
        expect(controller.getFlatIndex('unknown')).toBe(-1);
      });

      it('includes dropdowns in flat list', () => {
        const items: ToolbarItem[] = [
          btn('bold'),
          dropdown('headings', [btn('h1'), btn('h2')]),
        ];
        controller = new ToolbarController(createMockEditor(items), vi.fn());

        expect(controller.getFlatIndex('bold')).toBe(0);
        expect(controller.getFlatIndex('headings')).toBe(1);
        // Dropdown sub-items are NOT in flat list
        expect(controller.getFlatIndex('h1')).toBe(-1);
      });
    });

    describe('flatButtonCount', () => {
      it('counts top-level buttons and dropdowns', () => {
        const items: ToolbarItem[] = [
          btn('bold'),
          btn('italic'),
          dropdown('headings', [btn('h1'), btn('h2'), btn('h3')]),
        ];
        controller = new ToolbarController(createMockEditor(items), vi.fn());

        // 2 buttons + 1 dropdown = 3 flat items
        expect(controller.flatButtonCount).toBe(3);
      });

      it('is 0 for empty toolbar', () => {
        controller = new ToolbarController(createMockEditor([]), vi.fn());
        expect(controller.flatButtonCount).toBe(0);
      });
    });
  });

  // =========================================================================
  // Dropdown state
  // =========================================================================
  describe('dropdown state', () => {
    it('toggleDropdown opens a dropdown', () => {
      const onChange = vi.fn();
      controller = new ToolbarController(createMockEditor([dropdown('head', [btn('h1')])]), onChange);

      controller.toggleDropdown('head');
      expect(controller.openDropdown).toBe('head');
      expect(onChange).toHaveBeenCalled();
    });

    it('toggleDropdown closes when toggling same dropdown', () => {
      controller = new ToolbarController(createMockEditor([dropdown('head', [btn('h1')])]), vi.fn());

      controller.toggleDropdown('head');
      expect(controller.openDropdown).toBe('head');

      controller.toggleDropdown('head');
      expect(controller.openDropdown).toBe(null);
    });

    it('toggleDropdown switches to different dropdown', () => {
      const items: ToolbarItem[] = [
        dropdown('head', [btn('h1')]),
        dropdown('align', [btn('left')]),
      ];
      controller = new ToolbarController(createMockEditor(items), vi.fn());

      controller.toggleDropdown('head');
      expect(controller.openDropdown).toBe('head');

      controller.toggleDropdown('align');
      expect(controller.openDropdown).toBe('align');
    });

    it('closeDropdown closes open dropdown', () => {
      const onChange = vi.fn();
      controller = new ToolbarController(createMockEditor([dropdown('head', [btn('h1')])]), onChange);

      controller.toggleDropdown('head');
      onChange.mockClear();

      controller.closeDropdown();
      expect(controller.openDropdown).toBe(null);
      expect(onChange).toHaveBeenCalledOnce();
    });

    it('closeDropdown does nothing when no dropdown is open', () => {
      const onChange = vi.fn();
      controller = new ToolbarController(createMockEditor([btn('bold')]), onChange);

      controller.closeDropdown();
      // onChange should NOT be called since nothing changed
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Active state tracking
  // =========================================================================
  describe('active state tracking', () => {
    it('isActive returns false for unknown item', () => {
      controller = new ToolbarController(createMockEditor([]), vi.fn());
      expect(controller.isActive(btn('unknown'))).toBe(false);
    });

    it('tracks active state after subscribe', () => {
      const isActive = vi.fn().mockReturnValue(true);
      const items: ToolbarItem[] = [btn('bold', { isActive: 'bold' })];
      const editor = createMockEditor(items, {
        isActive,
        on: vi.fn(),
        off: () => { /* stub */ },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);
      controller.subscribe();

      // subscribe calls updateActiveStates which checks isActive
      expect(isActive).toHaveBeenCalled();
      expect(controller.activeMap.get('bold')).toBe(true);
    });

    it('updates active state on transaction', () => {
      let transactionHandler: (() => void) | null = null;
      let boldActive = false;
      const isActive = vi.fn().mockImplementation((name: string) => {
        if (name === 'bold') return boldActive;
        return false;
      });
      const items: ToolbarItem[] = [btn('bold', { isActive: 'bold' })];
      const editor = createMockEditor(items, {
        isActive,
        on: (_event: string, handler: (...args: unknown[]) => void) => {
          transactionHandler = handler as () => void;
        },
        off: () => { /* stub */ },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);
      controller.subscribe();

      // Initially not active (map entry may not exist, isActive handles fallback)
      expect(controller.isActive(items[0] as ToolbarButton)).toBe(false);

      // Simulate bold becoming active
      boldActive = true;
      transactionHandler!();

      expect(controller.activeMap.get('bold')).toBe(true);
      expect(onChange).toHaveBeenCalled();
    });

    it('checks active state for dropdown sub-items', () => {
      const isActive = vi.fn().mockImplementation((name: string) => name === 'heading');
      const items: ToolbarItem[] = [
        dropdown('headings', [
          btn('h1', { isActive: 'heading' }),
          btn('h2', { isActive: { name: 'heading', attributes: { level: 2 } } }),
        ]),
      ];
      const editor = createMockEditor(items, { isActive });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.activeMap.get('h1')).toBe(true);
    });

    it('does not call onChange when active state has not changed', () => {
      let transactionHandler: (() => void) | null = null;
      const isActive = vi.fn().mockReturnValue(false);
      const items: ToolbarItem[] = [btn('bold', { isActive: 'bold' })];
      const editor = createMockEditor(items, {
        isActive,
        on: (_event: string, handler: (...args: unknown[]) => void) => {
          transactionHandler = handler as () => void;
        },
        off: () => { /* stub */ },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);
      controller.subscribe();
      onChange.mockClear();

      // Trigger transaction — active state is still false
      transactionHandler!();

      // No change → onChange should not be called
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Disabled state tracking
  // =========================================================================
  describe('disabled state tracking', () => {
    it('isDisabled returns false for unknown item', () => {
      controller = new ToolbarController(createMockEditor([]), vi.fn());
      expect(controller.isDisabled(btn('unknown'))).toBe(false);
    });

    it('marks button as disabled when can() returns false', () => {
      const canToggleBold = vi.fn().mockReturnValue(false);
      const items: ToolbarItem[] = [btn('bold', { command: 'toggleBold' })];
      const editor = createMockEditor(items, {
        can: () => ({ toggleBold: canToggleBold }),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.disabledMap.get('bold')).toBe(true);
    });

    it('marks button as enabled when can() returns true', () => {
      const canToggleBold = vi.fn().mockReturnValue(true);
      const items: ToolbarItem[] = [btn('bold', { command: 'toggleBold' })];
      const editor = createMockEditor(items, {
        can: () => ({ toggleBold: canToggleBold }),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.isDisabled(items[0] as ToolbarButton)).toBe(false);
    });

    it('passes commandArgs to can() check', () => {
      const canSetHeading = vi.fn().mockReturnValue(true);
      const items: ToolbarItem[] = [
        btn('h1', { command: 'setHeading', commandArgs: [{ level: 1 }] }),
      ];
      const editor = createMockEditor(items, {
        can: () => ({ setHeading: canSetHeading }),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(canSetHeading).toHaveBeenCalledWith({ level: 1 });
    });

    it('buttons with emitEvent are never disabled', () => {
      const items: ToolbarItem[] = [
        btn('link', { command: 'setLink', emitEvent: 'openLinkPopover' }),
      ];
      const editor = createMockEditor(items, {
        can: () => ({ setLink: () => false }),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.isDisabled(items[0] as ToolbarButton)).toBe(false);
    });

    it('handles can() throwing gracefully', () => {
      const items: ToolbarItem[] = [btn('bold', { command: 'toggleBold' })];
      const editor = createMockEditor(items, {
        can: () => { throw new Error('broken'); },
      });

      controller = new ToolbarController(editor, vi.fn());
      expect(() => { controller!.subscribe(); }).not.toThrow();
    });

    it('handles buggy command dry-run throwing gracefully', () => {
      const items: ToolbarItem[] = [btn('bold', { command: 'toggleBold' })];
      const editor = createMockEditor(items, {
        can: () => ({ toggleBold: () => { throw new Error('broken'); } }),
      });

      controller = new ToolbarController(editor, vi.fn());
      expect(() => { controller!.subscribe(); }).not.toThrow();
      // Treated as enabled when can() throws
      expect(controller.isDisabled(items[0] as ToolbarButton)).toBe(false);
    });
  });

  // =========================================================================
  // executeCommand
  // =========================================================================
  describe('executeCommand', () => {
    it('calls the command and updates active states', () => {
      const toggleBold = vi.fn().mockReturnValue(true);
      const items: ToolbarItem[] = [btn('bold', { command: 'toggleBold', isActive: 'bold' })];
      const editor = createMockEditor(items, {
        commands: { toggleBold },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);

      controller.executeCommand(items[0] as ToolbarButton);
      expect(toggleBold).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Lifecycle: subscribe / destroy
  // =========================================================================
  describe('lifecycle', () => {
    it('subscribe registers transaction handler', () => {
      const on = vi.fn();
      const editor = createMockEditor([btn('bold')], { on });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(on).toHaveBeenCalledWith('transaction', expect.any(Function));
    });

    it('destroy unregisters transaction handler', () => {
      const off = vi.fn();
      const editor = createMockEditor([btn('bold')], { on: vi.fn(), off });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();
      controller.destroy();

      expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
    });

    it('destroy clears all state', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format', isActive: 'bold' }),
        btn('italic', { group: 'format' }),
      ];
      const editor = createMockEditor(items, {
        isActive: () => true,
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.groups.length).toBeGreaterThan(0);
      expect(controller.flatButtonCount).toBeGreaterThan(0);

      controller.destroy();

      expect(controller.groups).toHaveLength(0);
      expect(controller.flatButtonCount).toBe(0);
      expect(controller.activeMap.size).toBe(0);
      expect(controller.disabledMap.size).toBe(0);
    });

    it('destroy is safe to call multiple times', () => {
      const off = vi.fn();
      const editor = createMockEditor([], { on: vi.fn(), off });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();
      controller.destroy();
      controller.destroy();  // second call should not throw

      // off should only be called once
      expect(off).toHaveBeenCalledOnce();
    });

    it('destroy without subscribe does not call off', () => {
      const off = vi.fn();
      const editor = createMockEditor([], { off });

      controller = new ToolbarController(editor, vi.fn());
      controller.destroy();

      expect(off).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // toolbar: false filtering
  // =========================================================================
  describe('toolbar: false filtering', () => {
    it('excludes buttons with toolbar: false from groups', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('floatLeft', { group: 'image-float', toolbar: false }),
        btn('floatRight', { group: 'image-float', toolbar: false }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.name).toBe('format');
      expect(controller.groups[0]!.items).toHaveLength(1);
      expect(controller.groups[0]!.items[0]!.name).toBe('bold');
    });

    it('does not exclude buttons with toolbar: undefined (default)', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('italic', { group: 'format' }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups[0]!.items).toHaveLength(2);
    });

    it('toolbar: false items are not in flat button list', () => {
      const items: ToolbarItem[] = [
        btn('bold'),
        btn('hidden', { toolbar: false }),
        btn('italic'),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.flatButtonCount).toBe(2);
      expect(controller.getFlatIndex('bold')).toBe(0);
      expect(controller.getFlatIndex('italic')).toBe(1);
      expect(controller.getFlatIndex('hidden')).toBe(-1);
    });

    it('group is omitted entirely if all items have toolbar: false', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('floatNone', { group: 'image-float', toolbar: false }),
        btn('floatLeft', { group: 'image-float', toolbar: false }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.name).toBe('format');
    });

    it('toolbar: false only affects type=button, not dropdowns', () => {
      const items: ToolbarItem[] = [
        dropdown('headings', [btn('h1'), btn('h2')], { group: 'blocks' }),
        btn('hidden', { group: 'blocks', toolbar: false }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      // Dropdown is still there, hidden button is not
      expect(controller.groups[0]!.items).toHaveLength(1);
      expect(controller.groups[0]!.items[0]!.name).toBe('headings');
    });

    it('mixed toolbar true/false items within same group', () => {
      const items: ToolbarItem[] = [
        btn('image', { group: 'insert' }),
        btn('floatNone', { group: 'insert', toolbar: false }),
        btn('link', { group: 'insert' }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups[0]!.items).toHaveLength(2);
      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toContain('image');
      expect(names).toContain('link');
      expect(names).not.toContain('floatNone');
    });
  });

  // =========================================================================
  // Expanded state tracking (emitEvent buttons)
  // =========================================================================
  describe('expanded state tracking', () => {
    it('expandedMap starts empty', () => {
      controller = new ToolbarController(createMockEditor([]), vi.fn());
      expect(controller.expandedMap.size).toBe(0);
    });

    it('tracks expanded state for emitEvent buttons', () => {
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage: { link: { isOpen: true } },
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.expandedMap.get('link')).toBe(true);
    });

    it('expanded is false when storage.isOpen is false', () => {
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage: { link: { isOpen: false } },
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.expandedMap.get('link')).toBeUndefined();
    });

    it('expanded is false when storage entry does not exist', () => {
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage: {},
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(controller.expandedMap.get('link')).toBeUndefined();
    });

    it('does not track expanded state for non-emitEvent buttons', () => {
      const items: ToolbarItem[] = [
        btn('bold', { isActive: 'bold', command: 'toggleBold' }),
      ];
      const editor = createMockEditor(items, {
        storage: { bold: { isOpen: true } },
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      // Bold has no emitEvent — expanded should not be tracked
      expect(controller.expandedMap.has('bold')).toBe(false);
    });

    it('calls onChange when expanded state changes', () => {
      let transactionHandler: (() => void) | null = null;
      const storage: Record<string, unknown> = { link: { isOpen: false } };
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage,
        on: (_event: string, handler: (...args: unknown[]) => void) => {
          transactionHandler = handler as () => void;
        },
        off: () => { /* stub */ },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);
      controller.subscribe();
      onChange.mockClear();

      // Simulate the popover opening
      (storage['link'] as Record<string, unknown>)['isOpen'] = true;
      transactionHandler!();

      expect(controller.expandedMap.get('link')).toBe(true);
      expect(onChange).toHaveBeenCalled();
    });

    it('does not call onChange when expanded state has not changed', () => {
      let transactionHandler: (() => void) | null = null;
      const storage: Record<string, unknown> = { link: { isOpen: true } };
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage,
        on: (_event: string, handler: (...args: unknown[]) => void) => {
          transactionHandler = handler as () => void;
        },
        off: () => { /* stub */ },
      });
      const onChange = vi.fn();

      controller = new ToolbarController(editor, onChange);
      controller.subscribe();
      onChange.mockClear();

      // Trigger transaction — isOpen is still true
      transactionHandler!();

      // No change → onChange should not be called
      expect(onChange).not.toHaveBeenCalled();
    });

    it('destroy clears expandedMap', () => {
      const items: ToolbarItem[] = [
        btn('link', { emitEvent: 'openLinkPopover', command: 'setLink' }),
      ];
      const editor = createMockEditor(items, {
        storage: { link: { isOpen: true } },
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();
      expect(controller.expandedMap.size).toBeGreaterThan(0);

      controller.destroy();
      expect(controller.expandedMap.size).toBe(0);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('empty toolbar — no groups, no buttons', () => {
      controller = new ToolbarController(createMockEditor([]), vi.fn());

      expect(controller.groups).toHaveLength(0);
      expect(controller.flatButtonCount).toBe(0);
      expect(controller.focusedIndex).toBe(0);
    });

    it('single button toolbar', () => {
      controller = new ToolbarController(createMockEditor([btn('bold')]), vi.fn());

      expect(controller.groups).toHaveLength(1);
      expect(controller.flatButtonCount).toBe(1);

      // Navigation wraps to self
      expect(controller.navigateNext()).toBe(0);
      expect(controller.navigatePrev()).toBe(0);
    });

    it('mixed buttons and dropdowns across multiple groups', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format', priority: 200 }),
        btn('italic', { group: 'format', priority: 100 }),
        dropdown('headings', [btn('h1'), btn('h2')], { group: 'blocks' }),
        btn('undo', { group: 'history' }),
        btn('redo', { group: 'history' }),
      ];
      const editor = createMockEditor(items);

      controller = new ToolbarController(editor, vi.fn());

      expect(controller.groups).toHaveLength(3);
      expect(controller.flatButtonCount).toBe(5); // 2 buttons + 1 dropdown + 2 buttons
    });

    it('dropdown with no sub-items is still in flat list', () => {
      const items: ToolbarItem[] = [
        dropdown('empty', []),
      ];
      controller = new ToolbarController(createMockEditor(items), vi.fn());
      expect(controller.flatButtonCount).toBe(1);
    });

    it('items without isActive do not trigger active checks', () => {
      const isActive = vi.fn();
      const items: ToolbarItem[] = [btn('undo')]; // no isActive
      const editor = createMockEditor(items, { isActive, on: vi.fn(), off: vi.fn() });

      controller = new ToolbarController(editor, vi.fn());
      controller.subscribe();

      expect(isActive).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Layout mode
  // =========================================================================
  describe('layout mode', () => {
    it('resolves string items into a single group', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('italic', { group: 'format' }),
        btn('undo', { group: 'history' }),
      ];
      const layout: ToolbarLayoutEntry[] = ['bold', 'italic', 'undo'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toEqual(['bold', 'italic', 'undo']);
    });

    it('splits groups with | separators', () => {
      const items: ToolbarItem[] = [
        btn('bold'), btn('italic'), btn('undo'),
      ];
      const layout: ToolbarLayoutEntry[] = ['bold', 'italic', '|', 'undo'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(2);
      expect(controller.groups[0]!.items.map(i => i.name)).toEqual(['bold', 'italic']);
      expect(controller.groups[1]!.items.map(i => i.name)).toEqual(['undo']);
    });

    it('builds custom dropdown from layout entry', () => {
      const items: ToolbarItem[] = [
        btn('bold'), btn('italic'), btn('underline'),
      ];
      const layout: ToolbarLayoutEntry[] = [
        { dropdown: 'Format', icon: 'textB', items: ['bold', 'italic', 'underline'] },
      ];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      const dd = controller.groups[0]!.items[0]!;
      expect(dd.type).toBe('dropdown');
      expect(dd.name).toBe('layout-dd-Format');
      expect((dd as ToolbarDropdown).items.map(i => i.name)).toEqual(['bold', 'italic', 'underline']);
    });

    it('references existing dropdown by name', () => {
      const items: ToolbarItem[] = [
        dropdown('heading', [btn('h1'), btn('h2'), btn('h3')], { group: 'blocks' }),
        btn('bold', { group: 'format' }),
      ];
      const layout: ToolbarLayoutEntry[] = ['bold', '|', 'heading'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(2);
      expect(controller.groups[0]!.items[0]!.name).toBe('bold');
      const dd = controller.groups[1]!.items[0]!;
      expect(dd.type).toBe('dropdown');
      expect(dd.name).toBe('heading');
      expect((dd as ToolbarDropdown).items).toHaveLength(3);
    });

    it('silently skips unknown item names', () => {
      const items: ToolbarItem[] = [btn('bold')];
      const layout: ToolbarLayoutEntry[] = ['bold', 'nonexistent', 'alsoMissing'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.items).toHaveLength(1);
      expect(controller.groups[0]!.items[0]!.name).toBe('bold');
    });

    it('omits custom dropdown when all sub-items are unknown', () => {
      const items: ToolbarItem[] = [btn('bold')];
      const layout: ToolbarLayoutEntry[] = [
        'bold',
        { dropdown: 'Missing', icon: 'x', items: ['foo', 'bar'] },
      ];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.items).toHaveLength(1);
    });

    it('preserves layout order, ignores extension priority', () => {
      const items: ToolbarItem[] = [
        btn('low', { priority: 10 }),
        btn('high', { priority: 200 }),
        btn('mid', { priority: 100 }),
      ];
      const layout: ToolbarLayoutEntry[] = ['mid', 'low', 'high'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      const names = controller.groups[0]!.items.map(i => i.name);
      expect(names).toEqual(['mid', 'low', 'high']);
    });

    it('no layout = default grouping (backward compatible)', () => {
      const items: ToolbarItem[] = [
        btn('bold', { group: 'format' }),
        btn('undo', { group: 'history' }),
      ];
      controller = new ToolbarController(createMockEditor(items), vi.fn());

      expect(controller.groups).toHaveLength(2);
      expect(controller.groups[0]!.name).toBe('format');
      expect(controller.groups[1]!.name).toBe('history');
    });

    it('keyboard nav works with layout items', () => {
      const items: ToolbarItem[] = [btn('bold'), btn('italic'), btn('undo')];
      const layout: ToolbarLayoutEntry[] = ['bold', '|', 'undo'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.flatButtonCount).toBe(2);
      expect(controller.getFlatIndex('bold')).toBe(0);
      expect(controller.getFlatIndex('undo')).toBe(1);
      expect(controller.getFlatIndex('italic')).toBe(-1); // not in layout
    });

    it('active/disabled state works for layout-resolved items', () => {
      const isActive = vi.fn().mockImplementation((name: string) => name === 'bold');
      const canToggleBold = vi.fn().mockReturnValue(true);
      const canToggleItalic = vi.fn().mockReturnValue(false);
      const items: ToolbarItem[] = [
        btn('bold', { isActive: 'bold', command: 'toggleBold' }),
        btn('italic', { isActive: 'italic', command: 'toggleItalic' }),
      ];
      const layout: ToolbarLayoutEntry[] = ['bold', 'italic'];
      const editor = createMockEditor(items, {
        isActive,
        can: () => ({ toggleBold: canToggleBold, toggleItalic: canToggleItalic }),
        on: vi.fn(),
        off: vi.fn(),
      });

      controller = new ToolbarController(editor, vi.fn(), layout);
      controller.subscribe();

      expect(controller.activeMap.get('bold')).toBe(true);
      expect(controller.isActive(items[1] as ToolbarButton)).toBe(false);
      expect(controller.isDisabled(items[0] as ToolbarButton)).toBe(false);
      expect(controller.disabledMap.get('italic')).toBe(true);
    });

    it('resolves dropdown sub-items as standalone buttons', () => {
      const items: ToolbarItem[] = [
        dropdown('heading', [
          btn('h1', { command: 'toggleHeading', commandArgs: [{ level: 1 }] }),
          btn('h2', { command: 'toggleHeading', commandArgs: [{ level: 2 }] }),
        ]),
      ];
      // Pull h1 out as standalone, skip h2
      const layout: ToolbarLayoutEntry[] = ['h1'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.items).toHaveLength(1);
      expect(controller.groups[0]!.items[0]!.name).toBe('h1');
      expect(controller.groups[0]!.items[0]!.type).toBe('button');
    });

    it('consecutive separators produce no empty groups', () => {
      const items: ToolbarItem[] = [btn('bold'), btn('undo')];
      const layout: ToolbarLayoutEntry[] = ['bold', '|', '|', '|', 'undo'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(2);
    });

    it('leading/trailing separators are ignored', () => {
      const items: ToolbarItem[] = [btn('bold')];
      const layout: ToolbarLayoutEntry[] = ['|', 'bold', '|'];
      controller = new ToolbarController(createMockEditor(items), vi.fn(), layout);

      expect(controller.groups).toHaveLength(1);
      expect(controller.groups[0]!.items[0]!.name).toBe('bold');
    });
  });
});
