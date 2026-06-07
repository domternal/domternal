import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * One rung of the drop "depth ladder" for a vertical gap. The cursor's
 * horizontal position picks a rung, Notion-style: drag right to nest deeper,
 * left to outdent toward the top-level list.
 */
export interface DropDepthRung {
  /** List-nesting level: 1 = top-level list, 2 = nested once, ... `L+1` = child of the resolved item. */
  level: number;
  /** `'child'` = nest inside the resolved item; `'sibling'` = insert after `afterPos` at this level. */
  kind: 'child' | 'sibling';
  /** The list item this rung targets (the resolved item for child; an ancestor for sibling). */
  itemPos: number;
  /** Position to insert AFTER for `'sibling'` (end of the ancestor item at this level). */
  afterPos: number;
}

export interface ResolveDropDepthArgs {
  view: EditorView;
  /** Position right BEFORE the resolved deepest list item (nodeAt convention). */
  itemPos: number;
  /** Cursor client X. */
  clientX: number;
  /** Pixels of indent for the deepest (child) rung past the resolved item's left. */
  indentStep: number;
  /** Level chosen on the previous dragover, for the level dead-band. */
  incumbentLevel?: number | null;
  /** Dead-band (px) around a level boundary; `0` disables. */
  band?: number;
}

interface AncestorRung {
  level: number;
  itemPos: number;
  /** Position after the ancestor item's subtree (where a sibling at its level lands). */
  afterPos: number;
  /** Client-coord left edge of the ancestor item's box (the level's indent guide). */
  left: number;
}

/**
 * Build the list-item ancestor chain of the item at `itemPos`, innermost
 * FIRST. Each entry's `level` is its list-nesting level (1 = top-level list
 * item) and `afterPos` is the position just past that item. Returns `null`
 * if any ancestor lacks a DOM rect (resolution then degrades to a fixed level).
 */
function listItemAncestors(view: EditorView, itemPos: number): AncestorRung[] | null {
  const $inside: ResolvedPos = view.state.doc.resolve(itemPos + 1);
  const rungs: AncestorRung[] = [];
  let level = 0;
  for (let d = 1; d <= $inside.depth; d++) {
    const node: Node = $inside.node(d);
    if (!LIST_ITEM_TYPES.has(node.type.name)) continue;
    level += 1;
    const pos = $inside.before(d);
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    rungs.push({ level, itemPos: pos, afterPos: $inside.after(d), left: dom.getBoundingClientRect().left });
  }
  return rungs.reverse(); // innermost first
}

/**
 * Resolve which depth rung the cursor's X picks for a drop at the resolved
 * item. Levels span `1 .. L+1` (`L` = the item's list level): `L+1` nests as a
 * child (drag right); shallower levels are siblings at shallower ancestors
 * (drag left), floored at the top-level list, using each ancestor's rendered
 * left edge as its indent guide. `band > 0` keeps `incumbentLevel` sticky
 * within `band` px of a boundary. Returns `null` with no ancestor or rect.
 */
export function resolveDropDepth(args: ResolveDropDepthArgs): DropDepthRung | null {
  const { view, itemPos, clientX, indentStep, incumbentLevel = null, band = 0 } = args;
  const ancestors = listItemAncestors(view, itemPos);
  if (!ancestors || ancestors.length === 0) return null;
  const innermost = ancestors[0];
  if (!innermost) return null;
  const childLevel = innermost.level + 1;
  const childBoundary = innermost.left + indentStep; // X at/after which we nest as a child

  // Child when X is one indent past the item's left; otherwise the deepest
  // ancestor whose indent guide the cursor has reached (innermost-first, so
  // left edges decrease), floored at the top-level list.
  let level: number;
  if (clientX >= childBoundary) {
    level = childLevel;
  } else {
    const reached = ancestors.find((a) => clientX >= a.left);
    level = reached ? reached.level : 1;
  }

  // Level dead-band: keep the incumbent when the cursor sits within `band` px
  // of the boundary X between the incumbent level and the freshly chosen one.
  if (
    band > 0 &&
    incumbentLevel !== null &&
    incumbentLevel >= 1 &&
    incumbentLevel <= childLevel &&
    Math.abs(level - incumbentLevel) === 1
  ) {
    const upper = Math.max(level, incumbentLevel);
    // Boundary into `upper`: the deeper rung's left edge (child uses childBoundary).
    const boundaryX = upper === childLevel
      ? childBoundary
      : ancestors.find((a) => a.level === upper)?.left ?? Number.NaN;
    if (Number.isFinite(boundaryX) && Math.abs(clientX - boundaryX) <= band) level = incumbentLevel;
  }

  if (level >= childLevel) {
    return { level: childLevel, kind: 'child', itemPos, afterPos: innermost.afterPos };
  }
  const rung = ancestors.find((a) => a.level === level) ?? ancestors[ancestors.length - 1];
  if (!rung) return null;
  return { level: rung.level, kind: 'sibling', itemPos: rung.itemPos, afterPos: rung.afterPos };
}

/** True when the item at `itemPos` has a shallower list-item ancestor (i.e. it can outdent). */
export function hasShallowerListAncestor(doc: Node, itemPos: number): boolean {
  const $inside = doc.resolve(itemPos + 1);
  let count = 0;
  for (let d = 1; d <= $inside.depth; d++) {
    if (LIST_ITEM_TYPES.has($inside.node(d).type.name)) count += 1;
    if (count >= 2) return true;
  }
  return false;
}
