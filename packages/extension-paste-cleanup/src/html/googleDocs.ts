import type { Element, ElementContent, Root } from 'hast';
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

// Elements the editor's parse places as blocks, beside which a line break holds no line of text.
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'div', 'table', 'blockquote', 'pre', 'hr', 'details']);

/** The elements Google Docs wraps a copy in: a bold of normal weight whose id names the copy. */
function copyWrappers(tree: Root): Element[] {
  const wrappers: Element[] = [];
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (typeof child.properties.id === 'string' && child.properties.id.startsWith('docs-internal-guid-')) wrappers.push(child);
      else pending.push(child);
    }
  }
  return wrappers;
}

/** Whether the nearest content from an index on, past white space and other breaks, is a block or the wrapper's edge. */
function besideBlock(children: readonly ElementContent[], index: number, step: 1 | -1): boolean {
  for (let at = index; at >= 0 && at < children.length; at += step) {
    const node = children[at];
    if (node === undefined || node.type === 'comment' || (node.type === 'text' && !/[^\t\n\f\r ]/.test(node.value))) continue;
    if (node.type === 'element' && node.tagName === 'br') continue;
    return node.type === 'element' && BLOCKS.has(node.tagName);
  }
  return true;
}

/**
 * Docs writes an empty paragraph as a bare line break between the blocks of a copy: two empty paragraphs as two
 * breaks, the one it keeps before each table and the one that ends a document after its last table as one. The
 * editor would make one paragraph of a run of them, two lines tall for two. Each such break becomes the empty
 * paragraph it stands for. A break inside a paragraph or beside inline content stays a line break, and so does
 * the break Chrome adds after the copy, outside the wrapper, which the editor's parse ignores.
 */
export function googleDocsEmptyParagraphs(tree: Root): void {
  for (const wrapper of copyWrappers(tree)) {
    const children = wrapper.children;
    wrapper.children = children.map((child, index): ElementContent => (child.type === 'element' && child.tagName === 'br'
      && besideBlock(children, index - 1, -1) && besideBlock(children, index + 1, 1)
      ? { type: 'element', tagName: 'p', properties: {}, children: [] } : child));
  }
}

/** Whether an element holds images, only inside the runs Docs wraps them in, and white space. */
function holdsOnlyImages(node: Element): boolean {
  let images = 0;
  const only = (children: readonly ElementContent[]): boolean => children.every(child => {
    if (child.type === 'comment') return true;
    if (child.type === 'text') return !/[^\t\n\f\r ]/.test(child.value);
    if (child.tagName === 'img') { images++; return true; }
    return child.tagName === 'span' && only(child.children);
  });
  return only(node.children) && images > 0;
}

/** Whether a style aligns its block's content other than to the start, which in line images take. */
function aligned(style: unknown): boolean {
  let align: string | undefined;
  for (const [name, value] of plainDeclarations(style) ?? []) if (name === 'text-align') align = value.toLowerCase();
  return align !== undefined && !['left', 'start', 'justify'].includes(align);
}

/**
 * Docs places an in line image in a paragraph of its own. An editor whose images are blocks closed that
 * paragraph empty before the image, so every image pasted with an empty paragraph above it, in a table cell
 * too. A paragraph that holds only images becomes a division, which opens no block of its own: a block image
 * stands in the paragraph's place, and an in line image, or the alt text left in place of a removed one, gets a
 * paragraph of the editor's parse. A paragraph aligned to the center or the end keeps that alignment for in
 * line images, so it stays a paragraph.
 */
export function googleDocsImageParagraphs(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.tagName === 'p' && holdsOnlyImages(child) && !aligned(child.properties.style)) child.tagName = 'div';
      else pending.push(child);
    }
  }
}
