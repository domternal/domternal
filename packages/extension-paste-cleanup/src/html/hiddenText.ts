import type { Element, ElementContent, Root } from 'hast';

/**
 * Word's hidden text (Format > Font > Hidden) is part of the document Word does not show or print. Word's raw
 * clipboard HTML, which Chrome and Firefox pass through, keeps each hidden run in an element it hides with
 * `display: none` and `mso-hide: all`; Safari leaves the run out of the copy. Pasted, the run would show text its
 * author hid, so in a Word source an element whose own style hides it by either signal is removed with its content,
 * a block that held nothing else goes with it, and each removed element that held text or an image is reported.
 *
 * Only a Word source is read this way. A web page hides interface parts with `display: none`, such as menus and
 * text for screen readers, and its copy keeps them as before, with `unsupported-formatting`. `visibility: hidden`
 * keeps its room on a page and is no signal of Word's, so it stays a reported formatting loss everywhere.
 */
export type HiddenTextReporter = (node: Element) => void;

// Blocks a hidden run can leave empty, which then go with it. A table cell stays, so its row keeps its shape.
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'blockquote', 'pre', 'dt', 'dd', 'caption', 'center']);
// Containers that hold nothing once their last item, row or cell went.
const containers = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);
// Content that shows without text.
const media = new Set(['img', 'hr', 'svg', 'math', 'object', 'embed', 'video', 'audio', 'canvas', 'iframe', 'input', 'select', 'textarea', 'button']);

/** Whether an element's own style hides it, as CSS reads it, a later declaration winning, or as Word reads `mso-hide: all`. */
export function hiddenByStyle(style: unknown): boolean {
  if (typeof style !== 'string') return false;
  let display = '';
  let hide = '';
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).replace(/!\s*important\s*$/i, '').trim().toLowerCase();
    if (name === 'display') display = value;
    else if (name === 'mso-hide') hide = value;
  }
  return display === 'none' || hide === 'all';
}

/** An Office list marker run, which Word writes before a list paragraph's text and cleanup turns into the list's own. */
function listMarker(node: Element): boolean {
  return typeof node.properties.style === 'string' && /(?:^|;)\s*mso-list\s*:\s*ignore\s*(?:;|$)/i.test(node.properties.style);
}

/** Whether a node shows anything: text other than white space and no-break spaces, or content that shows without text. */
function shows(node: ElementContent, markers = true): boolean {
  if (node.type === 'text') return /[^\t\n\f\r \u00a0]/.test(node.value);
  if (node.type !== 'element') return false;
  if (media.has(node.tagName)) return true;
  if (!markers && listMarker(node)) return false;
  return node.children.some(child => shows(child, markers));
}

/**
 * Remove the hidden runs of a Word source and the blocks and containers they leave empty, reporting each removed run
 * that held text or an image. Returns whether anything was removed below `parent`.
 */
export function removeWordHiddenText(parent: Root | Element, report: HiddenTextReporter): boolean {
  let removed = false;
  const children: Root['children'] = [];
  for (const child of parent.children) {
    if (child.type !== 'element') { children.push(child); continue; }
    if (hiddenByStyle(child.properties.style)) {
      removed = true;
      if (child.children.some(entry => shows(entry))) report(child);
      // A hidden cell keeps its place in the row, without its content.
      if (child.tagName === 'td' || child.tagName === 'th') { child.children = []; children.push(child); }
      continue;
    }
    if (!removeWordHiddenText(child, report)) { children.push(child); continue; }
    removed = true;
    // A block whose text was all hidden, as a hidden paragraph is, leaves no empty block; its list marker goes with it.
    if (blocks.has(child.tagName) && !child.children.some(entry => shows(entry, false))) continue;
    if (containers.has(child.tagName) && !child.children.some(entry => entry.type === 'element')) continue;
    children.push(child);
  }
  if (removed) parent.children = children;
  return removed;
}
