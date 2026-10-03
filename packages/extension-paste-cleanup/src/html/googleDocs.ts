import type { Element, Root } from 'hast';
import { plainDeclarations } from './styles.js';

/*
 * The shapes Google Docs web writes to the clipboard, read from native captures in Google Chrome on macOS
 * (e2e/native-office-capture/fixtures/gdocs-*-chrome), applied to a copy whose source detection names Google Docs.
 */

/** Docs draws a line spacing as a CSS line height of 1.2 times it: 1.15 is written 1.38, single 1.2 and 1.5 1.7999999999999998. */
const LINE_FACTOR = 1.2;
/** The spacing of Docs' Normal text and headings, 1.15, and of a table cell's paragraphs, single. */
const TEXT_SPACING = 1.15;
const CELL_SPACING = 1;
const CELLS = new Set(['td', 'th']);

/** A style with its line height replaced by the given ratio, or without one; undefined for a style CSS may read otherwise. */
function withLineHeight(style: unknown, ratio: (written: number) => number | undefined): string | undefined {
  const declarations = plainDeclarations(style);
  if (declarations === undefined) return undefined;
  let changed = false;
  const kept: string[] = [];
  for (const [name, value] of declarations) {
    const written = name === 'line-height' && /^\d{1,4}(?:\.\d{1,20})?$/.test(value) ? Number(value) : undefined;
    if (written === undefined) { kept.push(`${name}:${value}`); continue; }
    changed = true;
    const spacing = ratio(written);
    if (spacing !== undefined) kept.push(`line-height:${String(spacing)}`);
  }
  return changed ? kept.join(';') : undefined;
}

/**
 * Read each block's line height as the Docs spacing it stands for, the ratio LineHeight stores and renders,
 * as Word's 150 % is its 1.5: 1.7999999999999998 is 1.5. The default spacing of its place, 1.15 for text,
 * headings and list items and single in a table cell, is the document's own rather than formatting, as the
 * export's document defaults and table style say, so it is dropped like Word's Normal spacing.
 */
export function googleDocsLineHeights(tree: Root): void {
  const pending: { node: Root | Element; cell: boolean }[] = [{ node: tree, cell: false }];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    for (const child of entry.node.children) {
      if (child.type !== 'element') continue;
      const cell = entry.cell || CELLS.has(child.tagName);
      const style = withLineHeight(child.properties.style, written => {
        const spacing = Math.round(written / LINE_FACTOR * 100) / 100;
        return spacing > 0 && spacing !== (cell ? CELL_SPACING : TEXT_SPACING) ? spacing : undefined;
      });
      if (style !== undefined) {
        if (style === '') delete child.properties.style; else child.properties.style = style;
      }
      pending.push({ node: child, cell });
    }
  }
}
