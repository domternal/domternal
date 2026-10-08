import type { Element, ElementContent, Root, RootContent, Text } from 'hast';
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

/** White space ProseMirror's parse collapses outside `pre`. */
const COLLAPSED = /[\t\n\f\r ]/;

/**
 * The texts of inline content whose white space ProseMirror's parse reads otherwise without a value that keeps spaces,
 * as it reads the content as one paragraph: a tab or a line break, a space beside other white space, a line break or an
 * image, and a space at the start or the end of the content. A space between words, at the edge of a run, is none.
 */
function textsNeedingSpaces(content: readonly RootContent[]): Set<Text> {
  const texts: { node: Text; from: number; to: number }[] = [];
  let whole = '';
  const collect = (nodes: readonly RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') { texts.push({ node, from: whole.length, to: whole.length + node.value.length }); whole += node.value; }
      // A line break, and an image, which a destination can place as a block that ends the paragraph before it.
      else if (node.type === 'element') { if (node.tagName === 'br' || node.tagName === 'img') whole += '\n'; else collect(node.children); }
    }
  };
  collect(content);
  const needing = new Set<Text>();
  for (const { node, from, to } of texts) {
    for (let at = from; at < to; at++) {
      const character = whole.charAt(at);
      if (!COLLAPSED.test(character)) continue;
      if (character !== ' ' || at === 0 || at === whole.length - 1 || COLLAPSED.test(whole.charAt(at - 1)) || COLLAPSED.test(whole.charAt(at + 1))) {
        needing.add(node);
        break;
      }
    }
  }
  return needing;
}

/** Remove a white space that only keeps spaces from each element whose texts read alike without it; a span left without attributes is emptied. */
function dropUnneeded(element: Element, needing: ReadonlySet<Text>, emptied: Set<Element>): void {
  const needs = (node: Element): boolean => node.children.some(child => (child.type === 'text' ? needing.has(child) : child.type === 'element' && needs(child)));
  if (WRAPPING.has(declaredWhiteSpace(element) ?? '') && !needs(element)) {
    setWhiteSpace(element, undefined);
    if (element.tagName === 'span' && Object.keys(element.properties).length === 0) emptied.add(element);
  }
  for (const child of element.children) if (child.type === 'element') dropUnneeded(child, needing, emptied);
}

/**
 * Inline content outside any block, at the top of the copy or in an inline element there that holds blocks, has no
 * block to hold the white space of its runs: Google Docs writes a selection inside one paragraph as its runs alone,
 * as it writes an image copied alone. ProseMirror's parse gathers such content into one paragraph, so the content is
 * read as one text, and a run drops a white space that only keeps spaces where its texts read alike without it: the
 * space at the edge of a run is a space between words, unless it starts or ends the content or meets other white space.
 */
function settleLooseRuns(parent: Root | Element, emptied: Set<Element>): void {
  let content: RootContent[] = [];
  const flush = (): void => {
    const needing = textsNeedingSpaces(content);
    for (const node of content) if (node.type === 'element') dropUnneeded(node, needing, emptied);
    content = [];
  };
  for (const child of parent.children) {
    if (child.type === 'comment') continue;
    if (child.type === 'text' || (child.type === 'element' && !BLOCK_CONTENT.has(child.tagName) && !holdsBlocks(child))) { content.push(child); continue; }
    flush();
    // An inline element that holds blocks, such as a source's wrapper around them, holds loose content of its own.
    if (child.type === 'element' && !BLOCK_CONTENT.has(child.tagName)) settleLooseRuns(child, emptied);
  }
  flush();
}

/**
 * A source that writes `white-space: pre-wrap` on every run, as Google Docs does, left each run a span whose only style
 * is that white space, which the editor's text style reads as a mark without a value: every pasted Google Docs run
 * carried an empty text style. A block whose every text stands under one such value takes it, so the runs inside need it
 * no longer; a run whose texts read alike without it, with no run of spaces, edge space, tab or line break, drops it. The
 * spaces ProseMirror's parse keeps and the HTML draws stay the same, and a span left without any attribute is unwrapped.
 * Runs outside any block are read together, as the paragraph the editor gathers them into. Verified own copies of the
 * editor never come here.
 */
export function settleWhiteSpace(root: Root): void {
  const emptied = new Set<Element>();
  settleLooseRuns(root, emptied);
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
