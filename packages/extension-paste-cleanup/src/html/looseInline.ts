import type { Element, Root, RootContent } from 'hast';

// Elements whose content ProseMirror's parse places as blocks.
const BLOCKS = new Set([
  'p', 'div', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'details', 'summary',
]);
// The white space ProseMirror's parse collapses.
const VISIBLE = /[^ \t\n\f\r]/;

function holdsBlock(node: Element): boolean {
  return node.children.some(child => child.type === 'element' && (BLOCKS.has(child.tagName) || holdsBlock(child)));
}

/** Whether the run holds a text node of white space only with visible text before and after it. */
function spaceBetweenText(run: readonly RootContent[]): boolean {
  let text = false;
  let gap = false;
  const visit = (nodes: readonly RootContent[]): boolean => nodes.some(node => {
    if (node.type === 'element') return visit(node.children);
    if (node.type !== 'text') return false;
    if (!VISIBLE.test(node.value)) {
      gap ||= text;
      return false;
    }
    text = true;
    return gap;
  });
  return visit(run);
}

/**
 * Wraps in a division each run of inline content that follows a block at the top of the pasted
 * HTML, or inside an inline element there that holds blocks, such as the Google Docs guid wrapper,
 * when a space between its words is a text node of white space only. ProseMirror parses such a
 * run straight into the top of the slice, and once a block came first there it reads that text as
 * the space between two blocks and drops it: a partly selected last paragraph written as bare
 * spans pasted "GB09 podebljanokur". In a division ProseMirror opens a paragraph for the run's
 * inline content, where the space stays. A paragraph wrapper would do the same for text, but an
 * image the destination places as a block closed it empty, with the rest of the run back at the
 * top of the slice; a division opens no block of its own, so such an image ends the paragraph
 * before it, if any, and the run goes on in a new one after it. A run before the first block
 * keeps its space and is left as written.
 */
export function wrapLooseInlineRuns(root: Root): void {
  let afterBlock = false;
  const wrapRuns = (parent: Root | Element): void => {
    const children: RootContent[] = [];
    let run: RootContent[] = [];
    const flush = (): void => {
      if (afterBlock && spaceBetweenText(run)) {
        children.push({ type: 'element', tagName: 'div', properties: {}, children: run as Element['children'] });
      } else children.push(...run);
      run = [];
    };
    for (const child of parent.children) {
      if (child.type !== 'element' || (!BLOCKS.has(child.tagName) && !holdsBlock(child))) {
        run.push(child);
        continue;
      }
      flush();
      if (BLOCKS.has(child.tagName)) afterBlock = true;
      else wrapRuns(child);
      children.push(child);
    }
    flush();
    parent.children = children;
  };
  wrapRuns(root);
}
