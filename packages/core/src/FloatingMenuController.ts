/**
 * FloatingMenuController - Headless, framework-agnostic state machine for the
 * block-insert floating menu.
 *
 * Mirrors the shape of ToolbarController: collects items from extensions,
 * groups them, tracks focused index for roving-tabindex keyboard navigation,
 * and executes commands. Framework wrappers (Angular, React, Vue) bind their
 * templates to this controller.
 *
 * @example
 * const controller = new FloatingMenuController(editor, () => {
 *   // onChange — re-render
 * });
 * controller.subscribe();
 * // ... controller.groups, controller.focusedIndex, controller.execute(item)
 * controller.destroy();
 */

import type { Editor } from './Editor.js';
import type { FloatingMenuItem, FloatingMenuItemsOverride } from './types/FloatingMenu.js';
import { groupFloatingMenuItems, type FloatingMenuGroup } from './utils/groupFloatingMenuItems.js';

export type { FloatingMenuGroup };

/** -1 means no item is focused (menu not entered via keyboard). */
export const FLOATING_MENU_NO_FOCUS = -1;

export class FloatingMenuController {
  /**
   * Resolves an `items` option (array | function) against the editor's
   * default floating-menu items. Exposed as static so the plugin can
   * resolve once at init without constructing a controller.
   */
  static resolveItems(
    editor: Editor,
    override?: FloatingMenuItemsOverride,
  ): FloatingMenuItem[] {
    const defaults = editor.floatingMenuItems;
    if (!override) return defaults;
    if (Array.isArray(override)) return override;
    try {
      return override(defaults, editor);
    } catch {
      return defaults;
    }
  }

  /**
   * Executes a floating-menu item's command on the editor.
   * String commands are dispatched via `editor.commands[name](...args)`;
   * function commands are called directly.
   */
  static executeItem(editor: Editor, item: FloatingMenuItem): void {
    if (typeof item.command === 'function') {
      item.command(editor);
      return;
    }
    const commands = editor.commands as unknown as Record<string, (...args: unknown[]) => boolean>;
    const cmd = commands[item.command];
    if (!cmd) return;
    if (item.commandArgs?.length) {
      cmd(...item.commandArgs);
    } else {
      cmd();
    }
  }

  private editor: Editor;
  private onChange: () => void;
  private override: FloatingMenuItemsOverride | undefined;
  private transactionHandler: (() => void) | null = null;

  private _groups: FloatingMenuGroup[] = [];
  private _flatItems: FloatingMenuItem[] = [];
  private _disabledMap = new Map<string, boolean>();
  private _focusedIndex = FLOATING_MENU_NO_FOCUS;

  constructor(editor: Editor, onChange: () => void, override?: FloatingMenuItemsOverride) {
    this.editor = editor;
    this.onChange = onChange;
    this.override = override;
    this.rebuild();
  }

  // === Getters ===

  get groups(): FloatingMenuGroup[] {
    return this._groups;
  }

  get flatItems(): FloatingMenuItem[] {
    return this._flatItems;
  }

  get disabledMap(): ReadonlyMap<string, boolean> {
    return this._disabledMap;
  }

  get focusedIndex(): number {
    return this._focusedIndex;
  }

  /** True when keyboard focus is inside the menu (at least one item focused). */
  get isEntered(): boolean {
    return this._focusedIndex >= 0;
  }

  get itemCount(): number {
    return this._flatItems.length;
  }

  // === State Methods ===

  isDisabled(item: FloatingMenuItem): boolean {
    return this._disabledMap.get(item.name) ?? false;
  }

  /**
   * Executes an item's command, then closes the menu keyboard focus.
   * Callers should refocus the editor after calling this.
   */
  execute(item: FloatingMenuItem): void {
    if (this.isDisabled(item)) return;
    FloatingMenuController.executeItem(this.editor, item);
    this._focusedIndex = FLOATING_MENU_NO_FOCUS;
    this.onChange();
  }

  /**
   * Rebuilds items from the editor. Call when the editor's extensions
   * change (rare) or on explicit refresh. Notification is delegated to
   * `updateDisabledStates` which fires `onChange` only when a disabled
   * state flipped — wrappers that need to react to pure group-structure
   * changes do so by bumping their own render signal after constructing
   * / re-using the controller (see framework wrapper usage).
   */
  rebuild(): void {
    const items = FloatingMenuController.resolveItems(this.editor, this.override);
    this._groups = this.groupItems(items);
    this._flatItems = this._groups.flatMap((g) => g.items);
    if (this._focusedIndex >= this._flatItems.length) {
      this._focusedIndex = FLOATING_MENU_NO_FOCUS;
    }
    this.updateDisabledStates();
  }

  // === Keyboard Navigation (roving tabindex) ===

  /** Enter keyboard focus on the menu (first item). Called by the plugin's keymap. */
  enterMenu(): number {
    if (this._flatItems.length === 0) {
      this._focusedIndex = FLOATING_MENU_NO_FOCUS;
      return this._focusedIndex;
    }
    this._focusedIndex = 0;
    this.onChange();
    return this._focusedIndex;
  }

  /** Leave keyboard focus (Escape). Refocus of the editor is the caller's job. */
  leaveMenu(): void {
    if (this._focusedIndex === FLOATING_MENU_NO_FOCUS) return;
    this._focusedIndex = FLOATING_MENU_NO_FOCUS;
    this.onChange();
  }

  /** ArrowDown — wrap to first at end. */
  next(): number {
    if (this._flatItems.length === 0) return FLOATING_MENU_NO_FOCUS;
    const cur = this._focusedIndex < 0 ? -1 : this._focusedIndex;
    this._focusedIndex = (cur + 1) % this._flatItems.length;
    this.onChange();
    return this._focusedIndex;
  }

  /** ArrowUp — wrap to last at start. */
  prev(): number {
    if (this._flatItems.length === 0) return FLOATING_MENU_NO_FOCUS;
    const len = this._flatItems.length;
    const cur = this._focusedIndex < 0 ? len : this._focusedIndex;
    this._focusedIndex = (cur - 1 + len) % len;
    this.onChange();
    return this._focusedIndex;
  }

  first(): number {
    if (this._flatItems.length === 0) return FLOATING_MENU_NO_FOCUS;
    this._focusedIndex = 0;
    this.onChange();
    return this._focusedIndex;
  }

  last(): number {
    if (this._flatItems.length === 0) return FLOATING_MENU_NO_FOCUS;
    this._focusedIndex = this._flatItems.length - 1;
    this.onChange();
    return this._focusedIndex;
  }

  /** Set focused index directly (e.g. on pointer hover). */
  setFocusedIndex(index: number): void {
    if (index < 0 || index >= this._flatItems.length) return;
    if (this._focusedIndex === index) return;
    this._focusedIndex = index;
    this.onChange();
  }

  /** Get focused item (or null). */
  focusedItem(): FloatingMenuItem | null {
    return this._flatItems[this._focusedIndex] ?? null;
  }

  /** Get flat index of item by name (for wrappers binding roving tabindex). */
  getFlatIndex(name: string): number {
    return this._flatItems.findIndex((i) => i.name === name);
  }

  // === Lifecycle ===

  /** Subscribes to editor transactions for disabled-state tracking. */
  subscribe(): void {
    this.transactionHandler = () => {
      this.updateDisabledStates();
    };
    this.editor.on('transaction', this.transactionHandler);
  }

  /** Unsubscribes and clears internal state. */
  destroy(): void {
    if (this.transactionHandler) {
      this.editor.off('transaction', this.transactionHandler);
      this.transactionHandler = null;
    }
    this._groups = [];
    this._flatItems = [];
    this._disabledMap.clear();
    this._focusedIndex = FLOATING_MENU_NO_FOCUS;
  }

  // === Internal ===

  /**
   * Groups items by `group` preserving insertion order, then sorts by
   * priority (higher first) within each group. Delegates to the shared
   * utility so `SlashCommand`'s renderer and this controller always
   * produce identical ordering.
   */
  private groupItems(items: FloatingMenuItem[]): FloatingMenuGroup[] {
    return groupFloatingMenuItems(items);
  }

  /**
   * Updates disabled state for each item. Uses custom predicate when
   * provided; otherwise tries a dry-run against `editor.can()[command]`.
   * Only notifies on change to avoid noisy re-renders.
   */
  private updateDisabledStates(): void {
    let changed = false;
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try {
      canProxy = this.editor.can() as unknown as Record<string, (...args: unknown[]) => boolean>;
    } catch {
      canProxy = null;
    }

    for (const item of this._flatItems) {
      const was = this._disabledMap.get(item.name) ?? false;
      let now = false;

      if (item.isDisabled) {
        try {
          now = item.isDisabled(this.editor);
        } catch {
          now = false;
        }
      } else if (typeof item.command === 'string' && canProxy) {
        try {
          const canCmd = canProxy[item.command];
          if (canCmd) {
            now = item.commandArgs?.length
              ? !canCmd(...item.commandArgs)
              : !canCmd();
          }
        } catch {
          now = false;
        }
      }

      if (was !== now) {
        this._disabledMap.set(item.name, now);
        changed = true;
      }
    }

    if (changed) this.onChange();
  }
}
