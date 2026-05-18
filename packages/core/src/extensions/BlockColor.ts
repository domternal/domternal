/**
 * Tints whole blocks via `bgColor` / `textColor` attributes rendered as
 * `data-bg-color` / `data-text-color`. Theme's `_block-colors.scss` maps
 * names to CSS custom properties with light/dark variants. `null` clears
 * the attribute; unknown palette names are rejected by commands.
 */
import { Extension } from '../Extension.js';
import type { Command, CommandSpec } from '../types/Commands.js';
import type { EditorState, Transaction } from '@domternal/pm/state';

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
 * `'default'` is implicit - represented by `null` (no data attribute).
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
 * is intentionally excluded - `<pre><code>` already has its own background
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

/**
 * Strip any inline `textStyle` marks inside [from, to] that carry the inline
 * counterpart of a block-level color attribute. Mutates the transaction in
 * place. This makes "last action wins": applying a block color erases
 * conflicting inline colors so the new block tint isn't visually hidden by
 * old span overrides.
 *
 * `which` may be 'text', 'bg', or 'both' - 'both' handles the unset case
 * in a single pass so the two strip operations don't step on each other's
 * replaced mark instances.
 *
 * Exported so `BlockContextMenu` (which writes node attrs directly via
 * `setNodeMarkup` instead of going through `setBlockBgColor` /
 * `setBlockTextColor`) shares the same conflict-stripping behavior.
 */
export function stripInlineColorConflicts(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
  which: 'text' | 'bg' | 'both',
): void {
  const textStyleType = state.schema.marks['textStyle'];
  if (!textStyleType) return;
  const inlineKeys: string[] = [];
  if (which === 'text' || which === 'both') inlineKeys.push('color', 'colorToken');
  if (which === 'bg' || which === 'both') inlineKeys.push('backgroundColor', 'backgroundColorToken');
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const existing = node.marks.find((m) => m.type === textStyleType);
    if (!existing) return false;
    const hasConflict = inlineKeys.some((k) => existing.attrs[k] !== null && existing.attrs[k] !== undefined);
    if (!hasConflict) return false;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    const newAttrs: Record<string, unknown> = { ...existing.attrs };
    for (const k of inlineKeys) newAttrs[k] = null;
    const stillUsed = Object.values(newAttrs).some((v) => v !== null && v !== undefined);
    tr.removeMark(start, end, existing);
    if (stillUsed) tr.addMark(start, end, textStyleType.create(newAttrs));
    return false;
  });
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
          // Palette guard - `null` always allowed (clears the attr).
          if (color !== null && !palette.includes(color)) return false;
          const pos = findTargetPos(state);
          if (pos === null) return false;
          const node = state.doc.nodeAt(pos);
          if (!node) return false;
          if (dispatch) {
            const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: color });
            stripInlineColorConflicts(tr, state, pos, pos + node.nodeSize, attr === 'textColor' ? 'text' : 'bg');
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
            stripInlineColorConflicts(tr, state, pos, pos + node.nodeSize, 'both');
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
