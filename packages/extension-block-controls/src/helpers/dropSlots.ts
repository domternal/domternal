import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/** Indent per nesting level (px), used as the X guide for the deepest nest option. */
export const DROP_SLOT_INDENT_PX = 24;

/**
 * One visible drop row: a top-level block, or the LABEL row of a list/task item
 * (its content row, excluding nested children which are their own rows). Emitted
 * in document order, which equals visual top-to-bottom for normal flow content.
 */
export interface DropRow {
  /** Position right BEFORE the block/item node (nodeAt convention). */
  pos: number;
  /** `pos + node.nodeSize` (end of the whole subtree, including nested children). */
  end: number;
  node: Node;
  /** A list/task item (vs a plain top-level block). */
  isItem: boolean;
  /** List-nesting level: 0 = top-level block, 1 = top-level list item, 2 = nested once, ... */
  level: number;
  /** Client-coord rect of the ROW (the label row for items, the block rect otherwise). */
  top: number;
  bottom: number;
  /** Client-coord left edge of the row (the item's marker left, used as the indent guide). */
  left: number;
  /** Client-coord right edge of the row's content column (drives indicator width). */
  right: number;
}

/**
 * Collect every drop row in document order. List items contribute their LABEL
 * row (parent item and nested children are distinct rows); nested wrappers are
 * recursed into. Rows whose DOM is missing are skipped. With `nestedEnabled =
 * false` (top-level-only mode) list wrappers stay one row and aren't descended.
 */
export function collectRows(view: EditorView, nestedEnabled = true): DropRow[] {
  const rows: DropRow[] = [];
  const doc = view.state.doc;

  const pushItem = (itemPos: number, item: Node, level: number): void => {
    const itemDom = view.nodeDOM(itemPos);
    const labelDom = view.nodeDOM(itemPos + 1); // child 0 = label paragraph
    const rectEl = labelDom instanceof HTMLElement ? labelDom : itemDom;
    if (!(rectEl instanceof HTMLElement) || !(itemDom instanceof HTMLElement)) return;
    const labelRect = rectEl.getBoundingClientRect();
    const itemRect = itemDom.getBoundingClientRect();
    rows.push({
      pos: itemPos,
      end: itemPos + item.nodeSize,
      node: item,
      isItem: true,
      level,
      top: labelRect.top,
      bottom: labelRect.bottom,
      left: itemRect.left,
      right: itemRect.right,
    });
    // Recurse into nested list wrappers among the item's children.
    let childPos = itemPos + 1;
    for (let j = 0; j < item.childCount; j++) {
      const child = item.child(j);
      if (LIST_WRAPPER_TYPES.has(child.type.name)) walkWrapper(childPos, child, level + 1);
      childPos += child.nodeSize;
    }
  };

  function walkWrapper(wrapperPos: number, wrapper: Node, level: number): void {
    let itemPos = wrapperPos + 1;
    for (let i = 0; i < wrapper.childCount; i++) {
      const item = wrapper.child(i);
      if (LIST_ITEM_TYPES.has(item.type.name)) pushItem(itemPos, item, level);
      itemPos += item.nodeSize;
    }
  }

  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (nestedEnabled && LIST_WRAPPER_TYPES.has(node.type.name)) {
      walkWrapper(pos, node, 1);
    } else {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        const r = dom.getBoundingClientRect();
        rows.push({ pos, end: pos + node.nodeSize, node, isItem: false, level: 0, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
    }
    pos += node.nodeSize;
  }
  return rows;
}

/** How to perform the insertion for a chosen slot option. */
export type DropSlotInsert =
  /** Insert AT an absolute position (between siblings / top-level). */
  | { kind: 'sibling'; pos: number }
  /** Insert as a child of `targetItemPos` (in `wrapperPos`) at `childIndex` (>= 1; 0 is the label). */
  | { kind: 'nested'; wrapperPos: number; targetItemPos: number; childIndex: number };

/** One depth option at a gap, shallow (small level) to deep (large level). */
export interface DropSlotOption {
  level: number;
  /** Client-X where the line starts AND the X threshold to select this option (they coincide). */
  lineLeft: number;
  /** Indicator line width (px). */
  lineWidth: number;
  insert: DropSlotInsert;
}

export interface DropSlot {
  /** Client-Y of the indicator line (the gap boundary). */
  gapY: number;
  /** The chosen option (by cursor X). */
  option: DropSlotOption;
  /** All options at this gap, shallow to deep. */
  options: DropSlotOption[];
  /** Upper/lower row positions bounding the gap (null at doc edges); for hysteresis. */
  upperPos: number | null;
  lowerPos: number | null;
}

/** Last dragover's resolved gap + depth, for the stickiness dead-bands. */
export interface DropSlotIncumbent {
  upperPos: number | null;
  lowerPos: number | null;
  level: number | null;
}

/** Find the row whose rect contains `clientY`, else the nearest by vertical distance. */
function nearestRow(rows: DropRow[], clientY: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (clientY >= r.top && clientY <= r.bottom) return i;
    const d = clientY < r.top ? r.top - clientY : clientY - r.bottom;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function siblingOption(row: DropRow, insertPos: number, level: number): DropSlotOption {
  return {
    level,
    lineLeft: row.left,
    lineWidth: Math.max(0, row.right - row.left),
    insert: { kind: 'sibling', pos: insertPos },
  };
}

/**
 * Options for inserting AFTER `upper` (which ends at this gap): a sibling after
 * it at its level, then one per ancestor that is a LAST child (drag-left
 * outdent), all sharing the gap's Y since a last-child's bottom edge coincides
 * with its ancestor's. Stops at the top-level list item (no full escape out of
 * lists). Plain top-level blocks yield a single option.
 */
function closeChain(view: EditorView, upper: DropRow): DropSlotOption[] {
  const doc = view.state.doc;
  if (!upper.isItem) return [siblingOption(upper, upper.end, 0)];

  const opts: DropSlotOption[] = [];
  const $: ResolvedPos = doc.resolve(upper.pos + 1); // inside the item; node($.depth) === item
  let depth = $.depth;
  let level = upper.level;
  while (depth >= 1) {
    const item = $.node(depth);
    if (!LIST_ITEM_TYPES.has(item.type.name)) break;
    const itemPos = $.before(depth);
    const dom = view.nodeDOM(itemPos);
    const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
    const left = rect ? rect.left : upper.left;
    const right = rect ? rect.right : upper.right;
    opts.push({
      level,
      lineLeft: left,
      lineWidth: Math.max(0, right - left),
      insert: { kind: 'sibling', pos: itemPos + item.nodeSize },
    });
    // Outdent only while this item is the LAST child of its wrapper and that
    // wrapper is itself inside a parent list item.
    if ($.index(depth - 1) !== $.node(depth - 1).childCount - 1) break;
    if (depth - 2 < 0 || !LIST_ITEM_TYPES.has($.node(depth - 2).type.name)) break;
    depth -= 2;
    level -= 1;
  }
  return opts;
}

/** The deepest option: nest the dragged block INTO `item` at `childIndex`. */
function nestOption(view: EditorView, item: DropRow, childIndex: number, indentStep: number): DropSlotOption | null {
  const doc = view.state.doc;
  const $item = doc.resolve(item.pos);
  if (!LIST_WRAPPER_TYPES.has($item.parent.type.name)) return null;
  const wrapperPos = $item.before();
  const lineLeft = item.left + indentStep;
  return {
    level: item.level + 1,
    lineLeft,
    lineWidth: Math.max(0, item.right - lineLeft),
    insert: { kind: 'nested', wrapperPos, targetItemPos: item.pos, childIndex },
  };
}

/** Child index for appending as `item`'s LAST child (one past its block children). */
function lastChildIndex(view: EditorView, item: DropRow): number {
  const node = view.state.doc.nodeAt(item.pos);
  return node ? node.childCount : 1;
}

/**
 * Client-X column + type of the list WRAPPER that `insertPos` falls inside.
 * A block that SPLITS the list lands at the wrapper's parent content column;
 * since a wrapper's box starts at its container's content-left, the wrapper's
 * own rect IS that column. Null when `insertPos` isn't directly in a wrapper.
 */
function wrapperColumn(view: EditorView, insertPos: number): { left: number; width: number; type: string } | null {
  const $p = view.state.doc.resolve(insertPos);
  if (!LIST_WRAPPER_TYPES.has($p.parent.type.name)) return null;
  const dom = view.nodeDOM($p.before());
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  return { left: r.left, width: Math.max(0, r.right - r.left), type: $p.parent.type.name };
}

/** Dedup options sharing the same resolved insertion target; keep the shallowest. */
function dedupeOptions(options: (DropSlotOption | null)[]): DropSlotOption[] {
  const seen = new Set<string>();
  const out: DropSlotOption[] = [];
  for (const o of options.filter((x): x is DropSlotOption => x !== null).sort((a, b) => a.level - b.level)) {
    const i = o.insert;
    const key = i.kind === 'sibling'
      ? `s:${String(i.pos)}`
      : `n:${String(i.targetItemPos)}:${String(i.childIndex)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

export interface ResolveDropSlotArgs {
  view: EditorView;
  clientX: number;
  clientY: number;
  /** Precomputed rows (collected once per dragover); falls back to `collectRows`. */
  rows?: DropRow[];
  /** Pixels of indent for the deepest (nest-into-item) option. */
  indentStep?: number;
  /** Whether to descend into lists (resolve individual items vs whole lists). */
  nestedEnabled?: boolean;
  /** Whether the deepest "nest into the item" option is offered (nestThreshold > 0). */
  offerNest?: boolean;
  /**
   * The dragged source's list WRAPPER type, driving sibling-column geometry:
   *   - `undefined`: keep the list-item column for every sibling (stateless callers).
   *   - `null` (non-list block): every in-list sibling draws at the list's PARENT
   *     column, since the block splits the list and lifts out.
   *   - `'bulletList'` / `'orderedList'` / `'taskList'`: a sibling over a list of the
   *     SAME kind JOINS (keeps the item column); a different kind (e.g. an ordered
   *     item over a bullet list) SPLITS and draws at the parent column. Matches
   *     `moveBlock`, which keeps a list item's own kind across a cross-kind drop.
   */
  sourceWrapperName?: string | null;
  /** Previous dragover's gap + depth, for the stickiness dead-bands. */
  incumbent?: DropSlotIncumbent | null;
  /** Y dead-band (px) around a row's mid so the gap doesn't flip on a wobble; 0 disables. */
  bandY?: number;
  /** X dead-band (px) around a depth guide so the level doesn't flicker; 0 disables. */
  bandX?: number;
}

/**
 * Gap-first drop resolver. Cursor Y picks the nearest gap between rows; cursor X
 * picks the depth among the options available at that gap (nest deeper rightward,
 * outdent leftward, but only where a shallower boundary really coincides). The
 * indicator always sits at the gap near the cursor, never jumping to a distant
 * list edge. Returns `null` for an empty document.
 */
export function resolveDropSlot(args: ResolveDropSlotArgs): DropSlot | null {
  const { view, clientX, clientY } = args;
  const indentStep = args.indentStep ?? DROP_SLOT_INDENT_PX;
  const nestedEnabled = args.nestedEnabled ?? true;
  const offerNest = (args.offerNest ?? true) && nestedEnabled;
  const incumbent = args.incumbent ?? null;
  const bandY = args.bandY ?? 0;
  const bandX = args.bandX ?? 0;
  const sourceWrapperName = args.sourceWrapperName;
  const rows = args.rows ?? collectRows(view, nestedEnabled);
  if (rows.length === 0) return null;

  const idx = nearestRow(rows, clientY);
  if (idx < 0) return null;
  const row = rows[idx];
  if (!row) return null;

  // Y dead-band: near the row's mid (before/after flip point) hold the
  // incumbent side so a wobble can't swap the resolved gap.
  const rowMid = (row.top + row.bottom) / 2;
  let after = clientY >= rowMid;
  if (bandY > 0 && incumbent && Math.abs(clientY - rowMid) <= bandY) {
    if (incumbent.upperPos === row.pos) after = true;
    else if (incumbent.lowerPos === row.pos) after = false;
  }
  const upper = after ? row : rows[idx - 1] ?? null;
  const lower = after ? rows[idx + 1] ?? null : row;
  const gapY = upper?.bottom ?? lower?.top ?? row.bottom;

  let options: DropSlotOption[];
  if (upper && lower && lower.pos < upper.end) {
    // `lower` is inside `upper`'s subtree: the gap sits between the upper item's
    // label and its first nested child. `upper` doesn't close here, so the
    // shallowest option is a sibling before `lower` (stays nested); deeper nests
    // into `lower`. No outdent offered here.
    options = dedupeOptions([
      siblingOption(lower, lower.pos, lower.level),
      lower.isItem && offerNest ? nestOption(view, lower, 1, indentStep) : null,
    ]);
  } else {
    options = dedupeOptions([
      ...(upper ? closeChain(view, upper) : []),
      lower ? siblingOption(lower, lower.pos, lower.level) : null,
      upper?.isItem && offerNest ? nestOption(view, upper, lastChildIndex(view, upper), indentStep) : null,
    ]);
  }
  if (options.length === 0) return null;

  // A sibling drop that SPLITS the list lifts the block out, so its line + X
  // guide sit at the wrapper's PARENT column, not the bullet-indented item
  // column. A sibling that JOINS (same list kind) keeps the item column.
  // Insert position is unchanged (`moveBlock` does the split); nest is untouched.
  if (sourceWrapperName !== undefined) {
    options = options.map((o) => {
      if (o.insert.kind !== 'sibling') return o;
      const col = wrapperColumn(view, o.insert.pos);
      if (!col) return o;
      const joins = sourceWrapperName !== null && sourceWrapperName === col.type;
      return joins ? o : { ...o, lineLeft: col.left, lineWidth: col.width };
    });
  }

  // Pick the deepest option whose indent guide X has reached; floor at the
  // shallowest when X is left of every guide (the common gutter drag).
  const byGuide = [...options].sort((a, b) => a.lineLeft - b.lineLeft);
  let chosen = byGuide[0];
  if (!chosen) return null;
  for (const o of byGuide) {
    if (clientX >= o.lineLeft) chosen = o;
  }

  // X dead-band: hold the incumbent level within `bandX` of the guide boundary
  // to the freshly chosen level, so depth doesn't flicker.
  if (bandX > 0 && incumbent && incumbent.level !== null) {
    const inc = byGuide.find((o) => o.level === incumbent.level);
    if (inc && inc !== chosen && Math.abs(chosen.level - inc.level) === 1) {
      const deeper = chosen.lineLeft >= inc.lineLeft ? chosen : inc;
      if (Math.abs(clientX - deeper.lineLeft) <= bandX) chosen = inc;
    }
  }

  return { gapY, option: chosen, options: byGuide, upperPos: upper?.pos ?? null, lowerPos: lower?.pos ?? null };
}
