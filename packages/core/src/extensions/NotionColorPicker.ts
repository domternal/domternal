/**
 * NotionColorPicker Extension
 *
 * Provides toolbar registration for a Notion-style inline color picker that
 * drives the `colorToken` / `backgroundColorToken` attributes on the textStyle
 * mark (added by TextColor and Highlight).
 *
 * Owns:
 * - The shared named-token palette (default: 9 Notion-style colors).
 * - A bubble-menu-only toolbar item (`notionColor`) that emits a custom
 *   `notionColorOpen` event when clicked. Framework wrappers listen for the
 *   event and render the actual picker panel.
 *
 * The panel renders the full palette every time it opens; no MRU/recent
 * tracking is kept because all 18 swatches (9 text + 9 bg) fit in one view.
 *
 * @example
 * ```ts
 * import { TextStyle, TextColor, Highlight, NotionColorPicker } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     TextStyle,
 *     TextColor,
 *     Highlight,
 *     NotionColorPicker,
 *   ],
 * });
 * ```
 */
import { Extension } from '../Extension.js';
import type { ToolbarItem } from '../types/Toolbar.js';

/**
 * Default named tokens. Match the BlockColor palette + theme tokens
 * (`--dm-block-text-<token>`, `--dm-block-bg-<token>`) so light and dark
 * themes render the right hex without any extra CSS work.
 */
export const DEFAULT_NOTION_COLOR_PALETTE: readonly string[] = Object.freeze([
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]);

export interface NotionColorPickerOptions {
  /**
   * Named tokens shown in the picker. Each token must have matching
   * `--dm-block-text-<token>` and `--dm-block-bg-<token>` CSS variables in
   * the active theme; tokens with no theme support render as transparent
   * swatches.
   * @default DEFAULT_NOTION_COLOR_PALETTE
   */
  palette: readonly string[];
}

export interface NotionColorPickerStorage {
  /** Whether the picker panel is currently open. UI sets this. */
  isOpen: boolean;
}

export const NotionColorPicker = Extension.create<
  NotionColorPickerOptions,
  NotionColorPickerStorage
>({
  name: 'notionColorPicker',

  // The picker writes textStyle.colorToken / textStyle.backgroundColorToken,
  // so TextStyle must be present. TextColor and Highlight are recommended
  // (they own those attribute schemas) but not strictly required: a host app
  // could supply its own attribute providers if it really wants to.
  dependencies: ['textStyle'],

  addOptions() {
    return {
      palette: DEFAULT_NOTION_COLOR_PALETTE,
    };
  },

  addStorage() {
    return {
      isOpen: false,
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'notionColor',
        // emitEvent takes priority over `command` at click time. The `command`
        // field is required by the ToolbarButton schema, so we point it at a
        // harmless built-in that fires only if a host disables the popover UI.
        command: 'focus',
        // The "A with an underline" glyph is the closest match in our icon
        // set; the framework wrapper can repaint the underline to reflect
        // the current selection's color.
        icon: 'textAUnderline',
        label: 'Text and background color',
        emitEvent: 'notionColorOpen',
        group: 'textStyle',
        priority: 250,
        // Bubble-menu-only: the legacy hex pickers (TextColor / Highlight)
        // stay in the main toolbar; this token-based picker is a Notion-mode
        // affordance surfaced beside the text-format buttons in the bubble.
        toolbar: false,
      },
    ];
  },
});
