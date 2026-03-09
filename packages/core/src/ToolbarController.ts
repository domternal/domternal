/**
 * ToolbarController — Headless, framework-agnostic toolbar state machine
 *
 * Manages toolbar item collection, grouping, active state tracking,
 * dropdown state, and keyboard navigation. Framework wrappers (Angular,
 * React, Vue) bind their templates to this controller.
 *
 * @example
 * const controller = new ToolbarController(editor, () => {
 *   // Called on every state change — trigger framework re-render
 * });
 * controller.subscribe();
 * // ... use controller.groups, controller.activeMap, etc.
 * controller.destroy();
 */

import type { ToolbarItem, ToolbarButton, ToolbarDropdown, ToolbarLayoutEntry } from './types/Toolbar.js';

/**
 * Editor interface for ToolbarController.
 * Minimal surface to avoid circular dependency on Editor class.
 */
export interface ToolbarControllerEditor {
  readonly toolbarItems: ToolbarItem[];
  readonly storage: Record<string, unknown>;
  isActive(
    nameOrAttributes: string | { name: string; attributes?: Record<string, unknown> },
    attributes?: Record<string, unknown>
  ): boolean;
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
  can(): Record<string, (...args: unknown[]) => boolean>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * A group of toolbar items with the same group name.
 */
export interface ToolbarGroup {
  name: string;
  items: ToolbarItem[];
}

/**
 * Flattened button reference for keyboard navigation.
 */
interface FlatButton {
  item: ToolbarButton | ToolbarDropdown;
  groupIndex: number;
  itemIndex: number;
}

/** Minimal editor shape for static helpers (avoids strict ToolbarControllerEditor compatibility issues) */
interface ToolbarItemEditor {
  readonly storage: Record<string, unknown>;
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
  isActive(
    nameOrAttributes: string | { name: string; attributes?: Record<string, unknown> },
    attributes?: Record<string, unknown>
  ): boolean;
}

export class ToolbarController {
  /**
   * Resolves the active state of a toolbar button against the editor.
   * Shared between ToolbarController and framework components (e.g. bubble-menu).
   */
  static resolveActive(editor: ToolbarItemEditor, item: ToolbarButton): boolean {
    if (item.isActiveFn) return item.isActiveFn(editor);
    if (!item.isActive) return false;
    if (typeof item.isActive === 'string') return editor.isActive(item.isActive);
    if (Array.isArray(item.isActive)) {
      return item.isActive.some(c =>
        typeof c === 'string' ? editor.isActive(c) : editor.isActive(c.name, c.attributes));
    }
    return editor.isActive(item.isActive.name, item.isActive.attributes);
  }

  /**
   * Executes a toolbar button's command on the editor.
   * Shared between ToolbarController and framework components (e.g. bubble-menu).
   */
  static executeItem(editor: ToolbarItemEditor, item: ToolbarButton): void {
    const cmd = editor.commands[item.command];
    if (cmd) {
      if (item.commandArgs?.length) {
        cmd(...item.commandArgs);
      } else {
        cmd();
      }
    }
  }

  private editor: ToolbarControllerEditor;
  private onChange: () => void;
  private _layout: ToolbarLayoutEntry[] | null;
  private transactionHandler: (() => void) | null = null;

  /** Grouped and sorted toolbar items */
  private _groups: ToolbarGroup[] = [];

  /** Active state for each button (keyed by item.name) */
  private _activeMap = new Map<string, boolean>();

  /** Disabled state for each button (keyed by item.name) */
  private _disabledMap = new Map<string, boolean>();

  /** Expanded state for emitEvent buttons — true when their panel is open */
  private _expandedMap = new Map<string, boolean>();

  /** Currently open dropdown name (null = none) */
  private _openDropdown: string | null = null;

  /** Focused button index for roving tabindex (-1 = none) */
  private _focusedIndex = 0;

  /** Flat list of top-level buttons/dropdowns for keyboard nav */
  private _flatButtons: FlatButton[] = [];

  constructor(editor: ToolbarControllerEditor, onChange: () => void, layout?: ToolbarLayoutEntry[]) {
    this.editor = editor;
    this.onChange = onChange;
    this._layout = layout ?? null;
    this.rebuild();
  }

  // === Getters ===

  get groups(): ToolbarGroup[] {
    return this._groups;
  }

  get activeMap(): ReadonlyMap<string, boolean> {
    return this._activeMap;
  }

  get disabledMap(): ReadonlyMap<string, boolean> {
    return this._disabledMap;
  }

  get expandedMap(): ReadonlyMap<string, boolean> {
    return this._expandedMap;
  }

  get openDropdown(): string | null {
    return this._openDropdown;
  }

  get focusedIndex(): number {
    return this._focusedIndex;
  }

  get flatButtonCount(): number {
    return this._flatButtons.length;
  }

  // === State Methods ===

  /**
   * Checks if a toolbar button is currently active.
   */
  isActive(item: ToolbarButton): boolean {
    return this._activeMap.get(item.name) ?? false;
  }

  /**
   * Checks if a toolbar button is currently disabled (command cannot execute).
   */
  isDisabled(item: ToolbarButton): boolean {
    return this._disabledMap.get(item.name) ?? false;
  }

  /**
   * Executes a toolbar button's command.
   */
  executeCommand(item: ToolbarButton): void {
    ToolbarController.executeItem(this.editor, item);
    this.updateActiveStates();
  }

  /**
   * Toggles a dropdown open/closed.
   */
  toggleDropdown(name: string): void {
    this._openDropdown = this._openDropdown === name ? null : name;
    this.onChange();
  }

  /**
   * Closes any open dropdown.
   */
  closeDropdown(): void {
    if (this._openDropdown !== null) {
      this._openDropdown = null;
      this.onChange();
    }
  }

  // === Keyboard Navigation ===

  /**
   * Move focus to the next button (ArrowRight).
   */
  navigateNext(): number {
    if (this._flatButtons.length === 0) return -1;
    this._focusedIndex = (this._focusedIndex + 1) % this._flatButtons.length;
    this.onChange();
    return this._focusedIndex;
  }

  /**
   * Move focus to the previous button (ArrowLeft).
   */
  navigatePrev(): number {
    if (this._flatButtons.length === 0) return -1;
    this._focusedIndex =
      (this._focusedIndex - 1 + this._flatButtons.length) % this._flatButtons.length;
    this.onChange();
    return this._focusedIndex;
  }

  /**
   * Move focus to the first button (Home).
   */
  navigateFirst(): number {
    this._focusedIndex = 0;
    this.onChange();
    return this._focusedIndex;
  }

  /**
   * Move focus to the last button (End).
   */
  navigateLast(): number {
    this._focusedIndex = Math.max(0, this._flatButtons.length - 1);
    this.onChange();
    return this._focusedIndex;
  }

  /**
   * Set focused index directly (e.g. on mouse enter).
   */
  setFocusedIndex(index: number): void {
    if (index >= 0 && index < this._flatButtons.length) {
      this._focusedIndex = index;
    }
  }

  /**
   * Get the flat index of a top-level item by name.
   */
  getFlatIndex(name: string): number {
    return this._flatButtons.findIndex((fb) => fb.item.name === name);
  }

  // === Lifecycle ===

  /**
   * Subscribes to editor transaction events for active state tracking.
   */
  subscribe(): void {
    this.transactionHandler = () => {
      this.updateActiveStates();
    };
    this.editor.on('transaction', this.transactionHandler);
    this.updateActiveStates();
  }

  /**
   * Unsubscribes from editor events and cleans up.
   */
  destroy(): void {
    if (this.transactionHandler) {
      this.editor.off('transaction', this.transactionHandler);
      this.transactionHandler = null;
    }
    this._groups = [];
    this._activeMap.clear();
    this._disabledMap.clear();
    this._expandedMap.clear();
    this._flatButtons = [];
  }

  // === Internal ===

  /**
   * Rebuilds groups and flat button list from editor.toolbarItems.
   * When a layout is provided, uses layout-based resolution instead of default grouping.
   */
  private rebuild(): void {
    const items = this.editor.toolbarItems;
    this._groups = this._layout
      ? this.resolveLayout(items, this._layout)
      : this.groupItems(items);
    this._flatButtons = this.buildFlatList();
    this._focusedIndex = 0;
  }

  /**
   * Groups items by their `group` property, preserving extension order within groups.
   * Items without a group go into a default '' group.
   * Within each group, items are sorted by priority (higher first).
   */
  private groupItems(items: ToolbarItem[]): ToolbarGroup[] {
    const groupMap = new Map<string, ToolbarItem[]>();
    const groupOrder: string[] = [];

    for (const item of items) {
      // Skip items marked as bubble-menu-only
      if (item.type === 'button' && item.toolbar === false) continue;
      const groupName = ('group' in item && item.group) ? item.group : '';
      let list = groupMap.get(groupName);
      if (!list) {
        list = [];
        groupMap.set(groupName, list);
        groupOrder.push(groupName);
      }
      list.push(item);
    }

    // Sort items within each group by priority (higher first)
    const groups: ToolbarGroup[] = [];
    for (const name of groupOrder) {
      const groupItems = groupMap.get(name) ?? [];
      groupItems.sort((a, b) => {
        const pa = a.priority ?? 100;
        const pb = b.priority ?? 100;
        return pb - pa;
      });
      groups.push({ name, items: groupItems });
    }

    return groups;
  }

  /**
   * Resolves a layout array into ToolbarGroups by looking up registered items by name.
   * Separators ('|') split items into visual groups.
   * String entries resolve to existing buttons or dropdowns.
   * ToolbarLayoutDropdown entries build custom dropdowns from named sub-items.
   */
  private resolveLayout(items: ToolbarItem[], layout: ToolbarLayoutEntry[]): ToolbarGroup[] {
    // Build lookup maps from registered toolbar items
    const buttonMap = new Map<string, ToolbarButton>();
    const dropdownMap = new Map<string, ToolbarDropdown>();

    for (const item of items) {
      if (item.type === 'button') {
        buttonMap.set(item.name, item);
      } else if (item.type === 'dropdown') {
        dropdownMap.set(item.name, item);
        for (const sub of item.items) {
          buttonMap.set(sub.name, sub);
        }
      }
    }

    // Walk layout entries, building groups split by '|'
    const groups: ToolbarGroup[] = [];
    let current: ToolbarItem[] = [];
    let groupIdx = 0;

    for (const entry of layout) {
      if (entry === '|') {
        if (current.length > 0) {
          groups.push({ name: `layout-${String(groupIdx++)}`, items: current });
          current = [];
        }
        continue;
      }

      if (typeof entry === 'string') {
        const dd = dropdownMap.get(entry);
        if (dd) {
          current.push(dd);
        } else {
          const btn = buttonMap.get(entry);
          if (btn) current.push(btn);
        }
        continue;
      }

      // ToolbarLayoutDropdown — build a custom dropdown from named sub-items
      const subItems: ToolbarButton[] = [];
      for (const subName of entry.items) {
        const btn = buttonMap.get(subName);
        if (btn) subItems.push(btn);
      }
      if (subItems.length > 0) {
        const dd: ToolbarDropdown = {
          type: 'dropdown',
          name: `layout-dd-${entry.dropdown}`,
          icon: entry.icon,
          label: entry.dropdown,
          items: subItems,
        };
        if (entry.displayMode) dd.displayMode = entry.displayMode;
        current.push(dd);
      }
    }

    if (current.length > 0) {
      groups.push({ name: `layout-${String(groupIdx)}`, items: current });
    }

    return groups;
  }

  /**
   * Builds a flat list of top-level buttons/dropdowns for keyboard navigation.
   */
  private buildFlatList(): FlatButton[] {
    const flat: FlatButton[] = [];
    this._groups.forEach((group, gi) => {
      group.items.forEach((item, ii) => {
        if (item.type === 'button' || item.type === 'dropdown') {
          flat.push({ item, groupIndex: gi, itemIndex: ii });
        }
      });
    });
    return flat;
  }

  /**
   * Updates active state map by checking editor.isActive() for each button.
   */
  private updateActiveStates(): void {
    let changed = false;

    // Cache can() proxy once per cycle — avoids creating a new Proxy per button
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try {
      canProxy = this.editor.can();
    } catch {
      // can() may throw if editor is in an invalid state
    }

    for (const group of this._groups) {
      for (const item of group.items) {
        if (item.type === 'button') {
          if (this.checkButtonActive(item)) changed = true;
          if (this.checkButtonDisabled(item, canProxy)) changed = true;
          if (this.checkButtonExpanded(item)) changed = true;
        } else if (item.type === 'dropdown') {
          for (const sub of item.items) {
            if (this.checkButtonActive(sub)) changed = true;
            if (this.checkButtonDisabled(sub, canProxy)) changed = true;
          }
          // Dropdown trigger is disabled when ALL sub-items are disabled
          const allDisabled = item.items.length > 0
            && item.items.every(sub => this._disabledMap.get(sub.name));
          const wasDropdownDisabled = this._disabledMap.get(item.name) ?? false;
          if (wasDropdownDisabled !== allDisabled) {
            this._disabledMap.set(item.name, allDisabled);
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.onChange();
    }
  }

  private checkButtonDisabled(
    item: ToolbarButton,
    canProxy: Record<string, (...args: unknown[]) => boolean> | null,
  ): boolean {
    const wasDisabled = this._disabledMap.get(item.name) ?? false;
    let nowDisabled = false;

    // Buttons with emitEvent are never disabled — they emit an event, not a command.
    // They still participate in active-state checks (checkButtonActive) because
    // active state reflects document state (e.g. link button shows active on links).
    if (!item.emitEvent) {
      try {
        if (canProxy) {
          const canCmd = canProxy[item.command];
          if (canCmd) {
            nowDisabled = item.commandArgs?.length
              ? !canCmd(...item.commandArgs)
              : !canCmd();
          }
        }
      } catch {
        // Command dry-run may throw (e.g. buggy extension) — treat as enabled
      }
    }

    if (wasDisabled !== nowDisabled) {
      this._disabledMap.set(item.name, nowDisabled);
      return true;
    }

    return false;
  }

  private checkButtonActive(item: ToolbarButton): boolean {
    if (!item.isActive && !item.isActiveFn) return false;

    const wasActive = this._activeMap.get(item.name) ?? false;
    const nowActive = ToolbarController.resolveActive(this.editor, item);

    if (wasActive !== nowActive) {
      this._activeMap.set(item.name, nowActive);
      return true;
    }

    return false;
  }

  private checkButtonExpanded(item: ToolbarButton): boolean {
    if (!item.emitEvent) return false;

    const wasExpanded = this._expandedMap.get(item.name) ?? false;
    const ext = this.editor.storage[item.name] as Record<string, unknown> | undefined;
    const nowExpanded = ext?.['isOpen'] === true;

    if (wasExpanded !== nowExpanded) {
      this._expandedMap.set(item.name, nowExpanded);
      return true;
    }

    return false;
  }
}
