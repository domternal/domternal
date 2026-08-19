/**
 * The bubble menu's item pipeline: what the editor registered, what the
 * selection is, and what the consumer asked for, resolved into the finished
 * list a menu renders.
 *
 * It lives in core because four surfaces need it and each of them is only a
 * renderer. Vanilla, React, Vue and Angular each carried their own copy of
 * every function below, four transcriptions of one algorithm kept in step by
 * hand. They did not stay in step: the separator cleanup that this module now
 * ends with had to be written four times to fix one defect, which is the
 * clearest argument that the algorithm was never theirs to hold.
 *
 * ProseMirror shapes are duck-typed here rather than imported. A selection or
 * a schema can arrive from a different copy of prosemirror-state, and
 * `instanceof` across two copies is false for objects that are otherwise
 * identical; reading the fields is the check that survives it.
 */
import type { Editor } from '../Editor.js';
import type { BubbleMenuOptions } from '../extensions/BubbleMenu.js';
import type { ToolbarButton, ToolbarDropdown } from '../types/Toolbar.js';
import { collapseSeparators } from './collapseSeparators.js';

// --- Duck-typed ProseMirror shapes (avoids instanceof across bundles) ---

export interface ResolvedPosShape {
  parent: { type: { name: string; spec: { marks?: string } } };
  depth: number;
  node: (depth: number) => { type: { name: string } };
}

export interface SelectionShape {
  empty: boolean;
  $from: ResolvedPosShape;
  $to: ResolvedPosShape;
  node?: { type: { name: string } };
}

interface SchemaShape {
  nodes: Record<string, { allowsMarkType: (mt: unknown) => boolean }>;
  marks: Record<string, unknown>;
}

export interface BubbleMenuSeparator {
  type: 'separator';
  name: string;
}

export type BubbleMenuItem = ToolbarButton | ToolbarDropdown | BubbleMenuSeparator;

/**
 * What a consumer may say about one context: an explicit name list, `true`
 * for every formatting mark the schema allows there, or `null` for no menu.
 */
export type BubbleContexts = Record<string, string[] | true | null>;

export interface BubbleItemMaps {
  itemMap: Map<string, ToolbarButton>;
  dropdownMap: Map<string, ToolbarDropdown>;
  /** Bubble defaults indexed by context name (e.g. 'text', 'codeBlock'). */
  bubbleDefaults: Map<string, BubbleMenuItem[]>;
}

/**
 * Walks `editor.toolbarItems` and indexes them by name. Dropdowns are kept
 * separately so the bubble menu can resolve them by name (e.g. text-align).
 *
 * A dropdown's children are indexed as buttons as well, which is what lets a
 * consumer name one alignment directly instead of the whole dropdown.
 */
export function buildBubbleItemMaps(editor: Editor): BubbleItemMaps {
  const itemMap = new Map<string, ToolbarButton>();
  const dropdownMap = new Map<string, ToolbarDropdown>();

  for (const item of editor.toolbarItems) {
    if (item.type === 'button') {
      itemMap.set(item.name, item);
    } else if (item.type === 'dropdown') {
      dropdownMap.set(item.name, item);
      for (const sub of item.items) {
        itemMap.set(sub.name, sub);
      }
    }
  }

  return {
    itemMap,
    dropdownMap,
    bubbleDefaults: buildBubbleDefaults(editor),
  };
}

/**
 * Build bubble-menu defaults keyed by `bubbleMenu` context name. Items are
 * sorted by priority (higher first) within each context, with separators
 * inserted between consecutive different `group` runs.
 *
 * These lists cannot strand a separator, because one is written only when an
 * item is already behind it and another is about to follow.
 */
function buildBubbleDefaults(editor: Editor): Map<string, BubbleMenuItem[]> {
  const byCtx = new Map<string, ToolbarButton[]>();

  const addItem = (btn: ToolbarButton): void => {
    const ctx = (btn as unknown as Record<string, unknown>)['bubbleMenu'] as string | undefined;
    if (!ctx) return;
    let arr = byCtx.get(ctx);
    if (!arr) {
      arr = [];
      byCtx.set(ctx, arr);
    }
    arr.push(btn);
  };

  for (const item of editor.toolbarItems) {
    if (item.type === 'button') addItem(item);
    else if (item.type === 'dropdown') {
      for (const sub of item.items) addItem(sub);
    }
  }

  const result = new Map<string, BubbleMenuItem[]>();
  for (const [ctx, ctxItems] of byCtx) {
    ctxItems.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
    const list: BubbleMenuItem[] = [];
    let lastGroup: string | undefined;
    let sepIdx = 0;
    for (const item of ctxItems) {
      if (lastGroup !== undefined && item.group !== lastGroup) {
        list.push({ type: 'separator', name: `bsep-${String(sepIdx++)}` });
      }
      list.push(item);
      lastGroup = item.group;
    }
    result.set(ctx, list);
  }

  return result;
}

/**
 * Resolve a name array to BubbleMenuItems via the item/dropdown maps.
 * Dropdowns take priority over buttons sharing the same name. Pipe `|`
 * tokens become separator entries.
 *
 * A name the editor does not carry is skipped, which is what lets one list
 * serve every build: a default naming `ai` shows it where the Pro extension
 * is installed and says nothing where it is not. The separator beside such a
 * name is not skipped with it, because a `|` always resolves; that is what
 * `collapseSeparators` is for, and why it has to run after this rather than
 * inside it.
 */
export function resolveBubbleNames(
  names: string[],
  itemMap: Map<string, ToolbarButton>,
  dropdownMap: Map<string, ToolbarDropdown>,
): BubbleMenuItem[] {
  const result: BubbleMenuItem[] = [];
  let sepIdx = 0;
  for (const name of names) {
    if (name === '|') {
      result.push({ type: 'separator', name: `sep-${String(sepIdx++)}` });
      continue;
    }
    const dropdown = dropdownMap.get(name);
    if (dropdown) {
      result.push(dropdown);
      continue;
    }
    const item = itemMap.get(name);
    if (item) result.push(item);
  }
  return result;
}

/**
 * All `format`-group buttons sorted by priority (used by the `true` shorthand
 * to show "all format marks for this context").
 */
export function getBubbleFormatItems(itemMap: Map<string, ToolbarButton>): ToolbarButton[] {
  return Array.from(itemMap.values())
    .filter((item) => item.group === 'format')
    .sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
}

/**
 * Determine the active bubble-menu context based on the selection. Returns
 * `null` when no context matches (menu should not show).
 *
 * Resolution order:
 * 1. CellSelection (`$anchorCell`) - no menu inside table cell selections
 * 2. NodeSelection (image, HR, etc.) - return the node's type name
 * 3. Empty selection - no context (caret-only)
 * 4. Inside a table cell - return 'table' (when from/to share a cell)
 * 5. `$from.parent.type.name` if listed in contexts
 * 6. 'text' if the parent allows marks
 */
export function detectBubbleContext(
  selection: SelectionShape,
  ctxs: BubbleContexts,
): string | null {
  if ('$anchorCell' in selection) return null;
  if (selection.node) return selection.node.type.name;
  if (selection.empty) return null;

  const fromCell = findCellNode(selection.$from);
  if (fromCell) {
    const toCell = findCellNode(selection.$to);
    if (toCell && fromCell !== toCell) return null;
    return 'table';
  }

  const fromName = selection.$from.parent.type.name;
  if (fromName in ctxs) return fromName;
  if ('text' in ctxs && selection.$from.parent.type.spec.marks !== '') return 'text';
  const toName = selection.$to.parent.type.name;
  if (toName in ctxs) return toName;
  if ('text' in ctxs && selection.$to.parent.type.spec.marks !== '') return 'text';
  return null;
}

/**
 * Filter items by what the schema actually allows in the given context.
 * E.g. inside a `codeBlock` node, marks like Bold/Italic aren't permitted.
 *
 * Pass-through for 'text' and 'table' contexts (schema check would be
 * lossy there because marks are allowed but some items still apply).
 */
export function filterBubbleItemsBySchema(
  editor: Editor,
  contextName: string,
  schemaItems: ToolbarButton[],
): ToolbarButton[] {
  if (contextName === 'text' || contextName === 'table') return schemaItems;
  const schema = (editor.state as unknown as { schema?: SchemaShape }).schema;
  if (!schema) return schemaItems;
  const nodeType = schema.nodes[contextName];
  if (!nodeType) return schemaItems;
  return schemaItems.filter((item) => {
    const markName = typeof item.isActive === 'string' ? item.isActive : null;
    if (!markName) return true;
    const markType = schema.marks[markName];
    if (!markType) return true;
    return nodeType.allowsMarkType(markType);
  });
}

/** Detect whether `$pos` is inside a table cell (cell or header). */
export function isInsideTableCell($pos: ResolvedPosShape): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return true;
  }
  return false;
}

function findCellNode(pos: ResolvedPosShape): { type: { name: string } } | null {
  for (let d = pos.depth; d > 0; d--) {
    const node = pos.node(d);
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') return node;
  }
  return null;
}

export interface ResolveBubbleMenuItemsOptions {
  editor: Editor;
  maps: BubbleItemMaps;
  /** The consumer's `contexts`, or undefined for the fixed-list path. */
  contexts?: BubbleContexts | undefined;
  /**
   * The list to show when `contexts` is absent and the selection is not a
   * node the editor registered a default for. Already resolved, because it
   * never changes with the selection.
   */
  fallbackItems: BubbleMenuItem[];
}

/**
 * The whole decision, in one place: which list this selection gets, filtered
 * by what the schema allows, with the orphaned separators removed.
 *
 * The cleanup is the last step rather than a step inside name resolution
 * because filtering removes items too: a selection inside a node type that
 * refuses a mark strands a separator exactly the way a missing extension
 * does, and only decides it per transaction.
 */
export function resolveBubbleMenuItems(
  options: ResolveBubbleMenuItemsOptions,
): BubbleMenuItem[] {
  return collapseSeparators(pickBubbleMenuItems(options));
}

function pickBubbleMenuItems({
  editor,
  maps,
  contexts,
  fallbackItems,
}: ResolveBubbleMenuItemsOptions): BubbleMenuItem[] {
  const selection = editor.state.selection as unknown as SelectionShape;

  if (contexts) {
    const ctx = detectBubbleContext(selection, contexts);
    if (!ctx) return [];

    if (ctx in contexts) {
      const val = contexts[ctx];
      if (val === null || (Array.isArray(val) && val.length === 0)) return [];
      if (val === true) {
        return filterBubbleItemsBySchema(editor, ctx, getBubbleFormatItems(maps.itemMap));
      }
      if (Array.isArray(val)) {
        const resolved = resolveBubbleNames(val, maps.itemMap, maps.dropdownMap);
        const buttons = resolved.filter(
          (item): item is ToolbarButton => item.type !== 'separator',
        );
        const allowed = new Set(
          filterBubbleItemsBySchema(editor, ctx, buttons).map((item) => item.name),
        );
        return resolved.filter(
          (item) => item.type === 'separator' || allowed.has(item.name),
        );
      }
    }
    return maps.bubbleDefaults.get(ctx) ?? [];
  }

  // No contexts: a node selection the editor registered items for, else the
  // fixed list.
  if (selection.node && maps.bubbleDefaults.has(selection.node.type.name)) {
    return maps.bubbleDefaults.get(selection.node.type.name) ?? [];
  }
  return fallbackItems;
}

/**
 * The default `shouldShow`, which has to agree with the resolution above:
 * a menu that opens on a selection resolving to nothing is an empty box, and
 * one that stays shut on a selection with items is a feature nobody can
 * reach.
 */
export function createBubbleShouldShow(
  maps: BubbleItemMaps,
  contexts?: BubbleContexts,
): BubbleMenuOptions['shouldShow'] {
  if (contexts) {
    return ({ state }): boolean => {
      const selection = state.selection as unknown as SelectionShape;
      const ctx = detectBubbleContext(selection, contexts);
      if (!ctx) return false;
      if (ctx in contexts) {
        const val = contexts[ctx];
        if (val === null) return false;
        return val === true || (Array.isArray(val) && val.length > 0);
      }
      return maps.bubbleDefaults.has(ctx);
    };
  }

  return ({ state }): boolean => {
    const selection = state.selection as unknown as SelectionShape;
    if (selection.empty) return false;
    if (selection.node) return maps.bubbleDefaults.has(selection.node.type.name);
    if (isInsideTableCell(selection.$from)) return false;
    return (
      selection.$from.parent.type.spec.marks !== '' ||
      selection.$to.parent.type.spec.marks !== ''
    );
  };
}
