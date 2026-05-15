/**
 * FloatingMenu configuration types
 *
 * Types for block-insert items contributed by extensions via the
 * `addFloatingMenuItems()` hook. Framework wrappers read these items
 * and render a WAI-ARIA menu shown on empty paragraphs.
 */

import type { Editor } from '../Editor.js';

/**
 * A single entry in the floating menu.
 *
 * Unlike `ToolbarButton`, floating-menu items represent one-shot insert
 * actions (no toggle / active state), carry an optional `description` for
 * Notion-style two-line rendering, and expose `keywords` for future
 * slash-command filtering.
 *
 * @example
 * {
 *   name: 'heading-1',
 *   label: 'Heading 1',
 *   description: 'Big section heading',
 *   icon: 'textHOne',
 *   group: 'Basic',
 *   shortcut: '# ',
 *   command: 'toggleHeading',
 *   commandArgs: [{ level: 1 }],
 * }
 */
export interface FloatingMenuItem {
  /** Unique identifier (used as React key, aria id, and dedup key when merging). */
  name: string;

  /** Primary label shown to the user. */
  label: string;

  /** Optional secondary line shown under the label. */
  description?: string;

  /** Icon key resolved against the editor's IconSet. Optional. */
  icon?: string;

  /**
   * Group heading. Items with the same group render under a shared
   * `<div role="group" aria-label={group}>` section.
   * @default '' (no group heading)
   */
  group?: string;

  /** Sort order within group (higher first). @default 100 */
  priority?: number;

  /** Keywords for future slash-command fuzzy filtering. */
  keywords?: string[];

  /** Visible keyboard-shortcut hint (e.g. `# `, `Mod-Alt-1`). */
  shortcut?: string;

  /**
   * Command to execute on activation.
   *
   * - String: key of `editor.commands`; invoked with `commandArgs`.
   * - Function: arbitrary callback receiving the editor. Use when the
   *   action is not a registered command (e.g. opening a popover).
   */
  command: string | ((editor: Editor) => void);

  /** Arguments for string commands. Ignored when `command` is a function. */
  commandArgs?: unknown[];

  /**
   * Custom disabled predicate. When omitted, the controller dry-runs the
   * command via `editor.can()` (string commands only) to detect availability.
   */
  isDisabled?: (editor: Editor) => boolean;

  /**
   * Node-type names that, when present as ancestors of the cursor, cause
   * the slash menu to hide this item. Useful for list/task-list entries:
   * e.g. `['bulletList']` removes "Bulleted list" from the menu while the
   * cursor is already inside a bullet list, so picking it doesn't lift
   * the user out of the list unexpectedly.
   */
  hideWhenInside?: string[];
}

/**
 * Override form accepted by `FloatingMenu.configure({ items })`.
 *
 * - Array: replaces the collected defaults entirely.
 * - Function: transforms the defaults (filter / reorder / extend).
 */
export type FloatingMenuItemsOverride =
  | FloatingMenuItem[]
  | ((defaults: FloatingMenuItem[], editor: Editor) => FloatingMenuItem[]);
