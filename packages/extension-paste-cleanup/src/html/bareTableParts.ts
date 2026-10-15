import type { Element, ElementContent, Nodes, Root, RootContent } from 'hast';
import { envelopeTags } from './envelope.js';
import { parseBoundedHTML } from './parse.js';
import type { MarkupObserver } from './markup.js';
import type { PasteHTMLLimits } from './types.js';

const TABLE_CONTENT = new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot']);
const PARTS = new Set([...TABLE_CONTENT, 'col', 'tr', 'td', 'th']);
const blank = (node: RootContent): boolean => node.type === 'comment' || node.type === 'doctype'
  || (node.type === 'text' && !/[^\t\n\f\r ]/.test(node.value)) || (node.type === 'element' && envelopeTags.has(node.tagName));
const element = (tagName: string, children: ElementContent[] = []): Element => ({ type: 'element', tagName, properties: {}, children });
const firstPart = (tree: Root): Element | undefined => {
  const first = tree.children.find(node => !blank(node));
  return first?.type === 'element' && PARTS.has(first.tagName) ? first : undefined;
};

/** Root clipboard comments only: strings in text, attributes or raw text are not boundaries. */
function clipboardRange(tree: Root): [number, number] | undefined {
  const start = tree.children.filter(node => node.type === 'comment' && node.value === 'StartFragment');
  const end = tree.children.filter(node => node.type === 'comment' && node.value === 'EndFragment');
  if (start.length !== 1 || end.length !== 1) return undefined;
  const from = start[0]?.position?.end.offset;
  const to = end[0]?.position?.start.offset;
  return from !== undefined && to !== undefined && from < to ? [from, to] : undefined;
}

type Removed = readonly [number, number];

/** Keep diagnostics in the caller's original source after reparsing a selected fragment. */
function restorePositions(tree: Root, original: string, base: number, removed: readonly Removed[]): void {
  if (base === 0 && removed.length === 0) return;
  const lines = [0];
  for (let index = 0; index < original.length; index++) if (original[index] === '\n') lines.push(index + 1);
  let removedLength = 0;
  const cuts = removed.map(([from, to]) => {
    const at = from - removedLength;
    removedLength += to - from;
    return { at, skipped: removedLength };
  });
  const offset = (value: number, start: boolean): number => {
    let left = 0;
    let right = cuts.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const at = cuts[middle]?.at ?? 0;
      if (at < value || (start && at === value)) left = middle + 1; else right = middle;
    }
    return base + value + (cuts[left - 1]?.skipped ?? 0);
  };
  const point = (value: number): { line: number; column: number; offset: number } => {
    let left = 0;
    let right = lines.length;
    while (left + 1 < right) {
      const middle = (left + right) >>> 1;
      if ((lines[middle] ?? 0) <= value) left = middle; else right = middle;
    }
    return { line: left + 1, column: value - (lines[left] ?? 0) + 1, offset: value };
  };
  const pending: Nodes[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    const position = node.position;
    if (position?.start.offset !== undefined && position.end.offset !== undefined) {
      node.position = { start: point(offset(position.start.offset, true)), end: point(offset(position.end.offset, false)) };
    }
    if ('children' in node) pending.push(...node.children);
  }
}

/**
 * A table-context parse fosters intervening text outside an implicit tbody. Its authored rows
 * and that text retain offsets, so restore their source order before wrapping separate groups.
 * Explicit sections remain intact and ordinary complete tables are never flattened here.
 */
function restoreImplicitParts(tree: Root): void {
  tree.children = tree.children.flatMap(node => node.type === 'element' && node.position === undefined
    && (node.tagName === 'tbody' || node.tagName === 'colgroup') ? node.children : [node]);
  const offset = (node: RootContent): number => {
    while (node.position === undefined && node.type === 'element' && node.children[0] !== undefined) node = node.children[0];
    return node.position?.start.offset ?? 0;
  };
  tree.children = tree.children.map(node => ({ node, at: offset(node) }))
    .sort((left, right) => left.at - right.at).map(entry => entry.node);
}

/** Wrap each uninterrupted group of authored parts, preserving text between rows as text. */
function wrapTableContent(tree: Root, supportsTables: () => boolean): Root {
  const output: RootContent[] = [];
  let tables: boolean | undefined;
  let parts: ElementContent[] = [];
  const flush = (): void => {
    if (parts.length === 0) return;
    // Columns without rows, cells, sections or a caption have no visible clipboard content.
    if (!parts.some(node => node.type === 'element' && !['col', 'colgroup'].includes(node.tagName))) {
      output.push(...parts.filter(node => node.type !== 'element'));
    } else if (!(tables ??= supportsTables())) output.push(...parts);
    else {
      const table = element('table');
      let group: Element | undefined;
      let row: Element | undefined;
      for (const node of parts) {
        if (node.type !== 'element') { (row?.children ?? group?.children ?? table.children).push(node); continue; }
        if (TABLE_CONTENT.has(node.tagName)) { table.children.push(node); group = undefined; row = undefined; continue; }
        if (node.tagName === 'col') {
          if (group?.tagName !== 'colgroup') { group = element('colgroup'); table.children.push(group); }
          group.children.push(node); row = undefined; continue;
        }
        if (group?.tagName !== 'tbody') { group = element('tbody'); table.children.push(group); }
        if (node.tagName === 'tr') { group.children.push(node); row = undefined; }
        else {
          if (row === undefined) { row = element('tr'); group.children.push(row); }
          row.children.push(node);
        }
      }
      output.push(table);
    }
    parts = [];
  };
  for (const node of tree.children) {
    if (node.type === 'element' && PARTS.has(node.tagName)) parts.push(node);
    else if (parts.length > 0 && blank(node) && node.type !== 'doctype') parts.push(node);
    else { flush(); output.push(node); }
  }
  flush();
  tree.children = output;
  return tree;
}

/**
 * Recover the selected bare rows/cells in a Windows clipboard envelope, keep authored fragment
 * order, and discard orphan columns before ProseMirror mistakes them for a table-only clipboard.
 * At most two recovery parses share one allocation budget, in addition to the original parse.
 */
export function recoverTableParts(
  html: string, tree: Root, limits: PasteHTMLLimits, observer: MarkupObserver, tables: () => boolean,
): Root {
  const allowance = { allocations: 0 };
  let source = html;
  let base = 0;
  const range = clipboardRange(tree);
  if (range === undefined && !tree.children.some(node => node.type === 'element' && PARTS.has(node.tagName))) return tree;
  if (firstPart(tree) === undefined && range !== undefined && /<(?:tr|td|th|thead|tbody|tfoot|caption|colgroup|col)[\s/>]/i.test(html.slice(...range))) {
    const selected = html.slice(...range);
    const candidate = parseBoundedHTML(selected, limits, undefined, observer, allowance);
    if (firstPart(candidate) !== undefined) { tree = candidate; source = selected; base = range[0]; }
  }
  const removed: Removed[] = [];
  if (firstPart(tree)?.tagName === 'col') {
    tree = parseBoundedHTML(source, limits, 'table', observer, allowance);
    restoreImplicitParts(tree);
  } else {
    // In the default fragment context a root col switches the parser to column-group mode and
    // can discard following text. Remove only authored root col tags, then read the same input.
    for (const node of tree.children) {
      if (node.type !== 'element' || node.tagName !== 'col') continue;
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) removed.push([from, to]);
    }
    if (removed.length > 0) {
      let previous = 0;
      const pieces: string[] = [];
      for (const [from, to] of removed) { pieces.push(source.slice(previous, from)); previous = to; }
      pieces.push(source.slice(previous));
      tree = parseBoundedHTML(pieces.join(''), limits, undefined, observer, allowance);
    }
  }
  restorePositions(tree, html, base, removed);
  return wrapTableContent(tree, tables);
}
