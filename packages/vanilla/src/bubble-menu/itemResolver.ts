import type { Editor, ToolbarButton, ToolbarDropdown } from '@domternal/core';

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

export interface ItemMaps {
  itemMap: Map<string, ToolbarButton>;
  dropdownMap: Map<string, ToolbarDropdown>;
  /** Bubble defaults indexed by context name (e.g. 'text', 'codeBlock'). */
  bubbleDefaults: Map<string, BubbleMenuItem[]>;
}

/**
 * Walks `editor.toolbarItems` and indexes them by name. Dropdowns are kept
 * separately so the bubble menu can resolve them by name (e.g. text-align).
 */
export function buildItemMaps(editor: Editor): ItemMaps {
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
 */
export function resolveNames(
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
 * All `format`-group buttons sorted by priority (used by `context: true`
 * shorthand to show "all format marks for this context").
 */
export function getFormatItems(itemMap: Map<string, ToolbarButton>): ToolbarButton[] {
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
export function detectContext(
  selection: SelectionShape,
  ctxs: Record<string, string[] | true | null>,
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
export function filterBySchema(
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

/**
 * Detect whether `$pos` is inside a table cell (cell or header).
 */
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
