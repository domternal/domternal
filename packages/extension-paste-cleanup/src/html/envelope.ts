import type { Element, ElementContent, Root } from 'hast';

/**
 * Clipboard envelope elements carry document metadata, stylesheets and Office settings,
 * never visible content. Browsers and Office applications add them to routine copies,
 * so their removal is not a loss and produces no diagnostic.
 */
export const envelopeTags: ReadonlySet<string> = new Set(['head', 'title', 'meta', 'link', 'base', 'style', 'xml']);

/**
 * Office namespace wrappers whose children are ordinary document content: paragraph marks
 * (`o:p`), content controls (`w:*`) and smart tags (`st1:*`). Unwrapping them loses nothing.
 * VML drawings (`v:*`) and Office math (`m:*`) are not transparent and stay reported.
 */
export function transparentOfficeWrapper(tagName: string): boolean {
  return /^(?:o|w|st\d{1,2}):[a-z]/.test(tagName);
}

const markBlocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div']);

/** The text of a node and whether it holds anything but text, such as a line break or an image. */
function blockContent(node: Element): { text: string; other: boolean } {
  let text = '';
  let other = false;
  const pending: ElementContent[] = [...node.children];
  for (let child = pending.shift(); child !== undefined; child = pending.shift()) {
    if (child.type === 'text') text += child.value;
    else if (child.type === 'element') {
      if (child.tagName === 'br' || child.tagName === 'img') other = true;
      else pending.unshift(...child.children);
    }
  }
  return { text, other };
}

/** The paragraph marks of a block: its `o:p` descendants that hold one no-break space and nothing else. */
function placeholderMarks(node: Element): Element[] {
  const marks: Element[] = [];
  const pending: ElementContent[] = [...node.children];
  for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
    if (child.type !== 'element') continue;
    const only = child.children.length === 1 ? child.children[0] : undefined;
    if (child.tagName === 'o:p' && only?.type === 'text' && only.value === ' ') marks.push(child);
    else pending.push(...child.children);
  }
  return marks;
}

/**
 * Word writes an empty paragraph as a paragraph mark holding one no-break space, `<o:p>&nbsp;</o:p>`,
 * so a browser gives it a line's height. The space is no text of the document: kept, the paragraph
 * pasted as one holding a space, which hides a placeholder and starts typed text after it. A block
 * whose only text is that space becomes empty; a space Word wrote as text, outside the mark, beside
 * other text or a line break, stays.
 */
export function emptyParagraphMarks(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (markBlocks.has(child.tagName) && !child.children.some(entry => entry.type === 'element' && markBlocks.has(entry.tagName))) {
        const marks = placeholderMarks(child);
        const content = marks.length === 1 ? blockContent(child) : undefined;
        if (content !== undefined && !content.other && content.text.replace(/[\t\n\f\r ]/g, '') === ' ') {
          for (const mark of marks) mark.children = [];
          continue;
        }
      }
      pending.push(child);
    }
  }
}

/** Whether an element is the line break Chrome and Safari end a copy with: `<br class="Apple-interchange-newline">`. */
function interchangeNewline(node: Element): boolean {
  const className = node.properties.className;
  return node.tagName === 'br' && Array.isArray(className) && className.includes('Apple-interchange-newline');
}

/**
 * Chrome and Safari end a copy whose selection ends at a paragraph's end with a line break of the class
 * `Apple-interchange-newline`, after the copied content: it marks where the selection ended, no line of the content.
 * The editor's paste ignores a break that ends the copy, so the cleaned HTML no longer ends with one either; a break
 * anywhere else, or one without the class, stays.
 */
export function dropInterchangeNewline(tree: Root): void {
  for (let index = tree.children.length - 1; index >= 0; index--) {
    const child = tree.children[index];
    if (child === undefined || child.type === 'comment' || (child.type === 'text' && !/[^\t\n\f\r ]/.test(child.value))) continue;
    if (child.type === 'element' && interchangeNewline(child)) tree.children.splice(index, 1);
    return;
  }
}
