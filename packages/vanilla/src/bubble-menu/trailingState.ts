import type { Editor } from '@domternal/core';
import type { SelectionShape } from './itemResolver.js';

/**
 * Live state for the bubble-menu trailing buttons.
 *
 * Mirrors Angular's `syncTrailingButtonsState` output. Computed per editor
 * transaction and coalesced into a single object so each transaction
 * triggers at most one re-render.
 */
export interface BubbleMenuTrailingState {
  /** True when current selection is a NodeSelection (image, HR, ...). Trailing buttons hide in that case. */
  isNodeSelection: boolean;
  /** True when the `notionColorPicker` extension is loaded on this editor (cached once per editor). */
  showColorPickerButton: boolean;
  /** True when the `blockContextMenu` extension is loaded on this editor (cached once per editor). */
  showBlockMenuButton: boolean;
  /** True when the selection spans more than one top-level block (multi-block "..." disable). */
  blockMenuButtonDisabled: boolean;
  /** CSS color value for the "A" trigger glyph (e.g. `var(--dm-block-text-yellow)`), or null. */
  currentTextColorVar: string | null;
  /** CSS color value for the "A" trigger underline, or null. */
  currentBgColorVar: string | null;
  /** True when any token-based text or background color is applied at the cursor. */
  hasAnyColor: boolean;
}

export const INITIAL_TRAILING_STATE: BubbleMenuTrailingState = {
  isNodeSelection: false,
  showColorPickerButton: false,
  showBlockMenuButton: false,
  blockMenuButtonDisabled: false,
  currentTextColorVar: null,
  currentBgColorVar: null,
  hasAnyColor: false,
};

interface SyncOptions {
  hasNotionColorPicker: boolean;
  hasBlockContextMenu: boolean;
}

/**
 * Compute trailing-button state for the current editor selection.
 *
 * - `isNodeSelection`: hides trailing buttons during NodeSelection (image, HR)
 * - `blockMenuButtonDisabled`: multi-block disable via `$from.before(1) !== $to.before(1)`
 * - `currentTextColorVar` / `currentBgColorVar` / `hasAnyColor`: read the
 *   `textStyle` mark at cursor and project token names to CSS-var refs that
 *   the theme resolves at paint time.
 */
export function computeTrailingState(
  editor: Editor,
  opts: SyncOptions,
): BubbleMenuTrailingState {
  const sel = editor.state.selection as unknown as SelectionShape;
  const isNode = !!sel.node;

  // Multi-block disable for the "..." trigger
  let blockMenuDisabled = false;
  if (opts.hasBlockContextMenu) {
    const { $from, $to } = editor.state.selection;
    if ($from.depth < 1 || $to.depth < 1) {
      blockMenuDisabled = true;
    } else {
      blockMenuDisabled = $from.before(1) !== $to.before(1);
    }
  }

  // Color preview for the "A" trigger
  let textVar: string | null = null;
  let bgVar: string | null = null;
  let hasAny = false;
  if (opts.hasNotionColorPicker) {
    const mark = editor.state.selection.$from
      .marks()
      .find((m) => m.type.name === 'textStyle');
    const attrs = (mark?.attrs ?? {}) as {
      colorToken?: string | null;
      backgroundColorToken?: string | null;
    };
    const tToken = attrs.colorToken ?? null;
    const bToken = attrs.backgroundColorToken ?? null;
    textVar = tToken ? `var(--dm-block-text-${tToken})` : null;
    bgVar = bToken ? `var(--dm-block-bg-${bToken})` : null;
    hasAny = tToken !== null || bToken !== null;
  }

  return {
    isNodeSelection: isNode,
    showColorPickerButton: opts.hasNotionColorPicker,
    showBlockMenuButton: opts.hasBlockContextMenu,
    blockMenuButtonDisabled: blockMenuDisabled,
    currentTextColorVar: textVar,
    currentBgColorVar: bgVar,
    hasAnyColor: hasAny,
  };
}
