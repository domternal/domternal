/**
 * Toolbar configuration types
 *
 * These types define toolbar items that extensions can register
 * via the `addToolbarItems()` hook. Framework wrappers (Angular, React, Vue)
 * read these items and render the toolbar UI.
 */

// =============================================================================
// Icon Sets
// =============================================================================

/**
 * Maps icon names to SVG strings.
 *
 * @example
 * const icons: IconSet = {
 *   textB: '<svg>...</svg>',
 *   textItalic: '<svg>...</svg>',
 * };
 */
export interface IconSet {
  [key: string]: string;
}

/**
 * Dual icon set with two weights (e.g. regular + fill for light/dark themes).
 *
 * @example
 * import { defaultIcons } from '@domternal/core';
 * // defaultIcons.regular['textB'] → regular weight SVG
 * // defaultIcons.fill['textB']    → fill weight SVG
 */
export interface DualIconSet {
  regular: IconSet;
  fill: IconSet;
}

// =============================================================================
// Toolbar Items
// =============================================================================

/**
 * A toolbar button that executes a command.
 *
 * @example
 * {
 *   type: 'button',
 *   name: 'bold',
 *   command: 'toggleBold',
 *   isActive: 'bold',
 *   icon: 'textB',
 *   label: 'Bold',
 *   shortcut: 'Mod-b',
 *   group: 'format',
 *   priority: 100,
 * }
 */
export interface ToolbarButton {
  type: 'button';

  /** Unique identifier for this toolbar item */
  name: string;

  /** Command name to execute (key of editor.commands) */
  command: string;

  /** Arguments to pass to the command */
  commandArgs?: unknown[];

  /**
   * How to check if this button is active.
   * - string: extension name passed to `editor.isActive(name)`
   * - object: `{ name, attributes }` passed to `editor.isActive(name, attributes)`
   * - undefined: button has no active state (e.g. undo/redo)
   */
  isActive?: string | { name: string; attributes?: Record<string, unknown> };

  /** Icon key (resolved against IconSet) */
  icon: string;

  /** Tooltip text and aria-label */
  label: string;

  /** Keyboard shortcut for display (e.g. "Mod-b") */
  shortcut?: string;

  /** Group name for visual grouping (separators between groups) */
  group?: string;

  /** Sort order within group (higher = first). @default 100 */
  priority?: number;
}

/**
 * A dropdown toolbar item containing multiple buttons.
 *
 * @example
 * {
 *   type: 'dropdown',
 *   name: 'heading',
 *   icon: 'textH',
 *   label: 'Heading',
 *   group: 'blocks',
 *   items: [
 *     { type: 'button', name: 'h1', command: 'toggleHeading', ... },
 *     { type: 'button', name: 'h2', command: 'toggleHeading', ... },
 *   ],
 * }
 */
export interface ToolbarDropdown {
  type: 'dropdown';

  /** Unique identifier for this toolbar item */
  name: string;

  /** Icon key for the dropdown trigger button */
  icon: string;

  /** Tooltip text and aria-label */
  label: string;

  /** Buttons shown in the dropdown panel */
  items: ToolbarButton[];

  /** Group name for visual grouping */
  group?: string;

  /** Sort order within group (higher = first). @default 100 */
  priority?: number;
}

/**
 * A visual separator between toolbar groups.
 * Typically inserted automatically when group names change.
 */
export interface ToolbarSeparator {
  type: 'separator';

  /** Group name (used for ordering) */
  group?: string;

  /** Sort order within group. @default 100 */
  priority?: number;
}

/** Any toolbar item */
export type ToolbarItem = ToolbarButton | ToolbarDropdown | ToolbarSeparator;
