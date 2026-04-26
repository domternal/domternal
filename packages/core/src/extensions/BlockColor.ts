/**
 * BlockColor Extension
 *
 * Adds `bgColor` and `textColor` attributes to block-level nodes so the
 * whole block can be tinted (Notion-style), not just the selected text.
 * Colors render as `data-bg-color="<name>"` / `data-text-color="<name>"`
 * attributes on the block's outer DOM node; the `@domternal/theme`
 * stylesheet (`_block-colors.scss`) maps those names to CSS custom
 * properties with light- and dark-mode variants.
 *
 * @example
 * ```ts
 * import { BlockColor } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     BlockColor,
 *   ],
 * });
 *
 * editor.commands.setBlockBgColor('yellow');
 * editor.commands.setBlockTextColor('gray');
 * editor.commands.unsetBlockColors();
 * ```
 *
 * Contract with `_block-colors.scss`:
 * - Palette names become data-attribute values.
 * - `null` clears the attribute so the block reverts to default styling.
 * - Unknown palette entries are rejected by commands (no-op, returns false).
 */
import { Extension } from '../Extension.js';
import type { Command, CommandSpec } from '../types/Commands.js';
import type { EditorState } from '@domternal/pm/state';

declare module '../types/Commands.js' {
  interface RawCommands {
    setBlockBgColor: CommandSpec<[color: string | null]>;
    setBlockTextColor: CommandSpec<[color: string | null]>;
    unsetBlockColors: CommandSpec;
  }
}

/**
 * Notion's public palette. Names are semantic (not tied to specific hex);
 * the stylesheet owns the actual colors so themes can customize them.
 * `'default'` is implicit — represented by `null` (no data attribute).
 */
export const DEFAULT_BLOCK_COLORS: string[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

/**
 * Default set of block types that receive the color attributes. `codeBlock`
 * is intentionally excluded — `<pre><code>` already has its own background
 * that would conflict visually. Similarly, details-content blocks have
 * their own affordance. Callers can extend via `types` option.
 */
export const DEFAULT_BLOCK_COLOR_TYPES: string[] = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
];

export interface BlockColorOptions {
  /**
   * Node types that receive `bgColor` / `textColor` attributes.
   * @default DEFAULT_BLOCK_COLOR_TYPES
   */
  types: string[];
  /**
   * Palette used by the `setBlockBgColor` command. Commands reject values
   * outside this list (no-op + false return) so host apps can curate
   * what's selectable.
   * @default DEFAULT_BLOCK_COLORS
   */
  bgColors: string[];
  /**
   * Palette used by the `setBlockTextColor` command.
   * @default DEFAULT_BLOCK_COLORS
   */
  textColors: string[];
}

export const BlockColor = Extension.create<BlockColorOptions>({
  name: 'blockColor',

  addOptions() {
    return {
      types: DEFAULT_BLOCK_COLOR_TYPES,
      bgColors: DEFAULT_BLOCK_COLORS,
      textColors: DEFAULT_BLOCK_COLORS,
    };
  },

  // Defensive fallback: an empty `bgColors`/`textColors` array would render
  // a broken Colors UI (section title with only the null-reset swatch).
  // Replace empties with the default palette so users who pass `{}` as an
  // override still get a working picker. Runs AFTER `addOptions()` merges
  // user config with defaults, so this only fires for explicit empty arrays.
  onBeforeCreate() {
    if (this.options.bgColors.length === 0) this.options.bgColors = DEFAULT_BLOCK_COLORS;
    if (this.options.textColors.length === 0) this.options.textColors = DEFAULT_BLOCK_COLORS;
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          bgColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-bg-color'),
            renderHTML: (attributes: Record<string, unknown>) => {
              const v = attributes['bgColor'] as string | null;
              if (!v) return null;
              return { 'data-bg-color': v };
            },
          },
          textColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-text-color'),
            renderHTML: (attributes: Record<string, unknown>) => {
              const v = attributes['textColor'] as string | null;
              if (!v) return null;
              return { 'data-text-color': v };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const types = this.options.types;
    const bgColors = this.options.bgColors;
    const textColors = this.options.textColors;

    /**
     * Walks up from the selection to the first ancestor whose node type is
     * in the configured `types` list. Returns the position of that
     * ancestor, or null if the selection isn't inside one.
     */
    function findTargetPos(state: EditorState): number | null {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (types.includes(node.type.name)) {
          // depth 0 is the document itself; `before(0)` isn't defined.
          return depth === 0 ? 0 : $from.before(depth);
        }
      }
      return null;
    }

    function setAttr(attr: 'bgColor' | 'textColor', palette: string[]) {
      return (color: string | null): Command =>
        ({ state, dispatch }) => {
          // Palette guard — `null` always allowed (clears the attr).
          if (color !== null && !palette.includes(color)) return false;
          const pos = findTargetPos(state);
          if (pos === null) return false;
          const node = state.doc.nodeAt(pos);
          if (!node) return false;
          if (dispatch) {
            const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: color });
            dispatch(tr);
          }
          return true;
        };
    }

    return {
      setBlockBgColor: setAttr('bgColor', bgColors),
      setBlockTextColor: setAttr('textColor', textColors),
      unsetBlockColors:
        (): Command =>
        ({ state, dispatch }) => {
          const pos = findTargetPos(state);
          if (pos === null) return false;
          const node = state.doc.nodeAt(pos);
          if (!node) return false;
          if (dispatch) {
            const tr = state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              bgColor: null,
              textColor: null,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
