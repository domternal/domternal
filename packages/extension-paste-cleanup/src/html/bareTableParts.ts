import type { ElementContent, Root, RootContent } from 'hast';
import { envelopeTags } from './envelope.js';

// What a table holds directly, and the rows, cells and columns that go in it.
const TABLE_CONTENT = new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot']);
const PARTS = new Set([...TABLE_CONTENT, 'col', 'tr', 'td', 'th']);

// Comments, white space and clipboard envelope elements, such as the meta element Chrome writes first.
const blank = (node: RootContent): boolean => node.type === 'comment' || node.type === 'doctype'
  || (node.type === 'text' && !/[^\t\n\f\r ]/.test(node.value)) || (node.type === 'element' && envelopeTags.has(node.tagName));

/**
 * Whether the pasted HTML starts with a table part outside a table, such as bare rows or cells.
 * The HTML parser keeps such parts at the top of a fragment, or drops what follows a bare
 * column, but the sanitizer keeps a row, cell or section only in a table, so the cells' texts
 * ran together. Such HTML is parsed again as a table's content, as a browser and ProseMirror's
 * own clipboard parse read it, and {@link wrapTableContent} puts the result in the table.
 */
export function startsWithTablePart(tree: Root): boolean {
  const first = tree.children.find(node => !blank(node));
  return first?.type === 'element' && PARTS.has(first.tagName);
}

/**
 * Puts the sections, caption and column groups that start a fragment parsed as a table's
 * content in a table. What the parser placed after them, such as a paragraph after bare rows,
 * stays after the table.
 */
export function wrapTableContent(tree: Root): Root {
  const { children } = tree;
  const start = children.findIndex(node => !blank(node));
  let end = start;
  for (const [index, node] of children.entries()) {
    if (index < start) continue;
    if (node.type === 'element' && TABLE_CONTENT.has(node.tagName)) end = index + 1;
    else if (!blank(node)) break;
  }
  if (end > start) {
    const content = children.slice(start, end).filter((node): node is ElementContent => node.type !== 'doctype');
    children.splice(start, end - start, { type: 'element', tagName: 'table', properties: {}, children: content });
  }
  return tree;
}
