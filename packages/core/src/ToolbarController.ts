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

import type { ToolbarItem, ToolbarButton, ToolbarDropdown } from './types/Toolbar.js';

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

export class ToolbarController {
  private editor: ToolbarControllerEditor;
  private onChange: () => void;
  private transactionHandler: (() => void) | null = null;

  /** Grouped and sorted toolbar items */
  private _groups: ToolbarGroup[] = [];

  /** Active state for each button (keyed by item.name) */
  private _activeMap = new Map<string, boolean>();

  /** Disabled state for each button (keyed by item.name) */
  private _disabledMap = new Map<string, boolean>();

  /** Currently open dropdown name (null = none) */
  private _openDropdown: string | null = null;

  /** Focused button index for roving tabindex (-1 = none) */
  private _focusedIndex = 0;

  /** Flat list of top-level buttons/dropdowns for keyboard nav */
  private _flatButtons: FlatButton[] = [];

  constructor(editor: ToolbarControllerEditor, onChange: () => void) {
    this.editor = editor;
    this.onChange = onChange;
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
    const cmd = this.editor.commands[item.command];
    if (cmd) {
      if (item.commandArgs && item.commandArgs.length > 0) {
        cmd(...item.commandArgs);
      } else {
        cmd();
      }
    }
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
    this._flatButtons = [];
  }

  // === Internal ===

  /**
   * Rebuilds groups and flat button list from editor.toolbarItems.
   */
  private rebuild(): void {
    const items = this.editor.toolbarItems;
    this._groups = this.groupItems(items);
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
        const pa = ('priority' in a && a.priority) ? a.priority : 100;
        const pb = ('priority' in b && b.priority) ? b.priority : 100;
        return pb - pa;
      });
      groups.push({ name, items: groupItems });
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
        } else if (item.type === 'dropdown') {
          for (const sub of item.items) {
            if (this.checkButtonActive(sub)) changed = true;
            if (this.checkButtonDisabled(sub, canProxy)) changed = true;
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

    // Buttons with emitEvent are never disabled — they emit an event, not a command
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
    let nowActive: boolean;

    if (item.isActiveFn) {
      nowActive = item.isActiveFn(this.editor);
    } else if (Array.isArray(item.isActive)) {
      nowActive = item.isActive.some((check) => {
        if (typeof check === 'string') return this.editor.isActive(check);
        return this.editor.isActive(check.name, check.attributes);
      });
    } else if (typeof item.isActive === 'string') {
      nowActive = this.editor.isActive(item.isActive);
    } else {
      nowActive = this.editor.isActive(item.isActive!.name, item.isActive!.attributes);
    }

    if (wasActive !== nowActive) {
      this._activeMap.set(item.name, nowActive);
      return true;
    }

    return false;
  }
}
