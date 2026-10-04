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

const LISTS = new Set(['ul', 'ol']);
/** Docs indents each list level by half an inch. */
const LEVEL_INDENT_PT = 36;

/** An item's aria-level, the list level Docs shows it at, from 1. */
function ariaLevel(item: Element): number | undefined {
  const level = Number(item.properties.ariaLevel);
  return Number.isSafeInteger(level) && level >= 1 && level <= 9 ? level : undefined;
}

/** The items of a list Docs wrote, each with its depth in the copy: its lists nest directly in their parent lists. */
function listItems(list: Element, depth: number, items: { item: Element; depth: number }[]): void {
  for (const child of list.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'li') {
      items.push({ item: child, depth });
      for (const nested of child.children) if (nested.type === 'element' && LISTS.has(nested.tagName)) listItems(nested, depth + 1, items);
    } else if (LISTS.has(child.tagName)) listItems(child, depth + 1, items);
  }
}

/** A style without its left margin when that is the given indent, or undefined when it has none or another one, or CSS may read it otherwise. */
function withoutIndent(style: unknown, points: number): string | undefined {
  const declarations = plainDeclarations(style);
  if (declarations === undefined) return undefined;
  const margins = declarations.filter(([name]) => name === 'margin-left');
  if (margins.length !== 1 || margins[0]?.[1].toLowerCase() !== `${String(points)}pt`) return undefined;
  return declarations.filter(([name]) => name !== 'margin-left').map(([name, value]) => `${name}:${value}`).join(';');
}

/**
 * A selection that starts below the first level of a list: Docs writes the copied levels as nested lists from
 * the first one it holds, and each item with the level Docs shows it at, `aria-level`, and a left margin of half
 * an inch for every level above the copy. The editor would paste the items that many levels too high, each with
 * an indentation it reports. When every item of a list stands the same number of levels below its depth in the
 * copy, with exactly that margin, the list is nested that many levels deep, each level above it opening with one
 * empty item, as a Word selection that starts in a nested item opens the levels above it; the margin, which the
 * nesting now draws, goes. The levels above take the list's own kind without a marker, which the copy does not name.
 */
export function googleDocsListLevels(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    node.children = node.children.map(child => {
      if (child.type !== 'element') return child;
      if (!LISTS.has(child.tagName)) { if (child.tagName !== 'li') pending.push(child); return child; }
      const items: { item: Element; depth: number }[] = [];
      listItems(child, 1, items);
      const offsets = new Set(items.map(({ item, depth }) => { const level = ariaLevel(item); return level === undefined ? 0 : level - depth; }));
      const [offset] = offsets;
      if (offsets.size !== 1 || offset === undefined || offset < 1) return child;
      const styles = items.map(({ item }) => withoutIndent(item.properties.style, LEVEL_INDENT_PT * offset));
      if (styles.some(style => style === undefined)) return child;
      items.forEach(({ item }, index) => {
        const style = styles[index];
        if (style === '' || style === undefined) delete item.properties.style; else item.properties.style = style;
      });
      let nested: Element = child;
      for (let level = 0; level < offset; level++) {
        nested = { type: 'element', tagName: child.tagName, properties: {}, children: [{ type: 'element', tagName: 'li', properties: {}, children: [nested] }] };
      }
      return nested;
    });
  }
}

/** A style without the named declarations; undefined when CSS may read it otherwise. */
function withoutDeclarations(style: unknown, names: readonly string[]): string | undefined {
  const declarations = plainDeclarations(style);
  return declarations?.filter(([name]) => !names.includes(name)).map(([name, value]) => `${name}:${value}`).join(';');
}

const setStyle = (element: Element, style: string | undefined): void => {
  if (style === undefined) return;
  if (style === '') delete element.properties.style; else element.properties.style = style;
};

/** A checklist item as Docs writes it: an ARIA checkbox with its state, its marker none. */
function checklistItem(node: ElementContent): node is Element {
  return node.type === 'element' && node.tagName === 'li' && node.properties.role === 'checkbox'
    && (node.properties.ariaChecked === 'true' || node.properties.ariaChecked === 'false');
}

/** The picture Docs draws a checklist item's box with, which names itself a checkbox. */
function checkboxPicture(node: ElementContent): boolean {
  const description = node.type === 'element' && node.tagName === 'img' ? node.properties.ariaRoleDescription : undefined;
  return (Array.isArray(description) ? description.join(' ') : typeof description === 'string' ? description : '').toLowerCase() === 'checkbox';
}

/**
 * Docs writes a checklist as a list whose items are ARIA checkboxes with their checked state, each drawing its
 * box as a picture of a checkbox and laying its paragraph beside it. Pasted as written, it became bullet items
 * without a marker, each with a black checkbox picture and its text in a paragraph after it. A list whose every
 * item is such a checkbox becomes the editor's task list, each item checked as Docs shows it: the pictures, the
 * marker and the paragraphs' row layout are how Docs draws the boxes, which the task items draw themselves. The
 * strikethrough Docs gives a checked item's text is in its export too, so it stays.
 */
export function googleDocsChecklists(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type !== 'element' || node.tagName !== 'ul') continue;
    // Its items, beside the lists Docs nests directly in a list.
    const elements = node.children.filter(child => child.type === 'element');
    const items = elements.filter(child => child.tagName === 'li');
    if (items.length === 0 || !items.every(checklistItem) || elements.some(child => child.tagName !== 'li' && !LISTS.has(child.tagName))) continue;
    node.properties.dataType = 'taskList';
    setStyle(node, withoutDeclarations(node.properties.style, ['list-style-type']));
    for (const item of items) {
      item.properties.dataType = 'taskItem';
      item.properties['dataChecked'] = item.properties.ariaChecked;
      delete item.properties.role;
      delete item.properties.ariaChecked;
      setStyle(item, withoutDeclarations(item.properties.style, ['list-style-type']));
      item.children = item.children.filter(child => !checkboxPicture(child));
      for (const child of item.children) {
        if (child.type === 'element' && child.tagName === 'p') setStyle(child, withoutDeclarations(child.properties.style, ['display', 'vertical-align']));
      }
    }
  }
}
