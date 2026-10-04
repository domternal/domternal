import type { Element, ElementContent, Root, RootContent } from 'hast';
import { plainDeclarations } from './styles.js';

// Blocks that hold runs of text: a white space declared on one of them reaches every run inside it.
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'div', 'blockquote']);
// Elements the editor's parse places as blocks: a span around one of them is no run to unwrap.
const BLOCK_CONTENT = new Set([...BLOCKS, 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'pre', 'hr', 'details', 'summary']);
// White space values that keep spaces, as ProseMirror's parse reads any value containing `pre`, and that CSS draws like
// `normal` for a text without a run of spaces, a space at its edge, a tab or a line break. `pre` also keeps a line from
// wrapping, so a run with it keeps it unless a block around it says the same.
const WRAPPING = new Set(['pre-wrap', 'pre-line']);
const keepsSpaces = (value: string | undefined): boolean => value?.includes('pre') === true;

/** The white space an element declares, lowercased; undefined without one or for a style CSS may read otherwise. */
function declaredWhiteSpace(element: Element): string | undefined {
  let value: string | undefined;
  for (const [name, written] of plainDeclarations(element.properties.style) ?? []) if (name === 'white-space') value = written.toLowerCase();
  return value;
}

function setWhiteSpace(element: Element, value: string | undefined): void {
  const declarations = (plainDeclarations(element.properties.style) ?? []).filter(([name]) => name !== 'white-space');
  if (value !== undefined) declarations.push(['white-space', value]);
  const style = declarations.map(([name, written]) => `${name}:${written}`).join(';');
  if (style === '') delete element.properties.style; else element.properties.style = style;
}

/** Whether ProseMirror's parse reads a text alike with and without a white space that keeps spaces, and CSS draws it alike. */
const settled = (text: string): boolean => !/[\t\n\f\r]| {2}|^ | $/.test(text);

/** The one value every text inside an element stands under when it keeps spaces; undefined when the texts differ or one does not. */
function runsValue(element: Element, inherited: string | undefined): string | undefined {
  const values = new Set<string | undefined>();
  const visit = (node: Element, current: string | undefined): void => {
    for (const child of node.children) {
      if (child.type === 'text') { if (child.value !== '') values.add(current); }
      else if (child.type === 'element') visit(child, declaredWhiteSpace(child) ?? current);
    }
  };
  visit(element, inherited);
  const [value] = values;
  return values.size === 1 && keepsSpaces(value) ? value : undefined;
}

/** Whether every text inside an element reads alike with and without a white space that keeps spaces. */
function settledTexts(element: Element): boolean {
  return element.children.every(child => child.type === 'text' ? settled(child.value) : child.type !== 'element' || settledTexts(child));
}

const holdsBlocks = (element: Element): boolean =>
  element.children.some(child => child.type === 'element' && (BLOCK_CONTENT.has(child.tagName) || holdsBlocks(child)));

/**
 * A source that writes `white-space: pre-wrap` on every run, as Google Docs does, left each run a span whose only style
 * is that white space, which the editor's text style reads as a mark without a value: every pasted Google Docs run
 * carried an empty text style. A block whose every text stands under one such value takes it, so the runs inside need it
 * no longer; a run whose texts read alike without it, with no run of spaces, edge space, tab or line break, drops it. The
 * spaces ProseMirror's parse keeps and the HTML draws stay the same, and a span left without any attribute is unwrapped.
 * Verified own copies of the editor never come here.
 */
export function settleWhiteSpace(root: Root): void {
  const emptied = new Set<Element>();
  const visit = (parent: Root | Element, inherited: string | undefined): void => {
    for (const child of parent.children) {
      if (child.type !== 'element') continue;
      let own = declaredWhiteSpace(child);
      const current = own ?? inherited;
      if (BLOCKS.has(child.tagName)) {
        // The block that holds the runs themselves, not a list item or a division around the blocks that do, takes the
        // value when a text needs it, or when the value around the block keeps spaces otherwise, as Docs' list items do.
        const value = holdsBlocks(child) ? undefined : runsValue(child, current);
        if (value !== undefined && value !== current && (keepsSpaces(current) || !settledTexts(child))) { setWhiteSpace(child, value); own = value; }
      } else if (own !== undefined && (own === inherited || (WRAPPING.has(own) && !keepsSpaces(inherited) && settledTexts(child)))) {
        // The value around it already, or one its texts read alike without.
        setWhiteSpace(child, undefined);
        if (child.tagName === 'span' && Object.keys(child.properties).length === 0 && !holdsBlocks(child)) emptied.add(child);
        own = undefined;
      }
      visit(child, own ?? inherited);
    }
  };
  visit(root, undefined);
  if (emptied.size === 0) return;
  const unwrap = (parent: Root | Element): void => {
    const children = parent.children.flatMap((child): RootContent[] => {
      if (child.type !== 'element') return [child];
      unwrap(child);
      return emptied.has(child) ? child.children : [child];
    });
    // An element's children and the children of a span unwrapped in it are its content.
    if (parent.type === 'root') parent.children = children; else parent.children = children as ElementContent[];
  };
  unwrap(root);
}
