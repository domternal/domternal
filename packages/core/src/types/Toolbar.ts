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
export type IconSet = Record<string, string>;

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
   * - array: OR-check — active if ANY entry matches (useful for attributes on multiple node types)
   * - undefined: button has no active state (e.g. undo/redo)
   */
  isActive?:
    | string
    | { name: string; attributes?: Record<string, unknown> }
    | (string | { name: string; attributes?: Record<string, unknown> })[];

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

  /** Inline CSS style string applied to the button element (e.g. for font preview) */
  style?: string;

  /**
   * Custom function to check active state.
   * Use for extensions that track state in plugin storage rather than node/mark state.
   * Takes precedence over `isActive` when defined.
   */
  isActiveFn?: (editor: { readonly storage: Record<string, unknown> }) => boolean;

  /** Event name to emit on the editor when clicked. If set, the UI emits this event instead of executing the command. */
  emitEvent?: string;

  /** Color value (hex) for color-swatch rendering in grid-layout dropdowns. */
  color?: string;

  /** Show in the main toolbar. @default true. Set false for bubble-menu-only items. */
  toolbar?: boolean;
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

  /** Panel layout: 'list' (default vertical) or 'grid' (color-swatch grid). */
  layout?: 'list' | 'grid';

  /** Number of columns in grid layout. @default 10 */
  gridColumns?: number;

  /** How to display items in the dropdown panel: icon + text (default), text only, or icon only. */
  displayMode?: 'icon-text' | 'text' | 'icon';
}

/**
 * A visual separator between toolbar groups.
 * Typically inserted automatically when group names change.
 */
export interface ToolbarSeparator {
  type: 'separator';

  /** Unique identifier (needed so all ToolbarItem variants share a `name` field) */
  name?: string;

  /** Group name (used for ordering) */
  group?: string;

  /** Sort order within group. @default 100 */
  priority?: number;
}

/** Any toolbar item */
export type ToolbarItem = ToolbarButton | ToolbarDropdown | ToolbarSeparator;

// =============================================================================
// Layout
// =============================================================================

/**
 * A custom dropdown defined in a toolbar layout.
 *
 * @example
 * { dropdown: 'Format', icon: 'textB', items: ['bold', 'italic', 'underline'] }
 */
export interface ToolbarLayoutDropdown {
  /** Label for the dropdown trigger */
  dropdown: string;
  /** Icon key for the dropdown trigger */
  icon: string;
  /** Item names to include as sub-items */
  items: string[];
  /** How to display items in the dropdown panel: icon + text (default), text only, or icon only. */
  displayMode?: 'icon-text' | 'text' | 'icon';
}

/**
 * A single entry in a toolbar layout array.
 *
 * - `string` — item name (e.g. `'bold'`) or separator (`'|'`)
 * - `ToolbarLayoutDropdown` — custom dropdown grouping
 */
export type ToolbarLayoutEntry = string | ToolbarLayoutDropdown;
