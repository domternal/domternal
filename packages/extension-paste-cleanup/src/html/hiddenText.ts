import type { Element, ElementContent, Root } from 'hast';
import { forEachStyleRule } from './officeListStyles.js';

/**
 * Word's hidden text (Format > Font > Hidden) is part of the document Word does not show or print. Word's raw
 * clipboard HTML, which Chrome and Firefox pass through, writes each hidden run with two declarations, `display:
 * none`, which hides it in a browser, and `mso-hide: all`, Word's own, which hides it in Office; a hidden character
 * or paragraph style writes both into its class rule in the copy's stylesheet. Safari leaves the run out of the copy.
 * Pasted, the run would show text its author hid, so in a Word source an element both hide is removed with its
 * content, and each removed element that held text or an image is reported.
 *
 * The rule, as CSS reads it: the element's `display` is `none` and its `mso-hide` is `all`, from its style attribute
 * or a class rule of the copy's stylesheet with a simple selector (`span.HiddenChar`, `.Hidden`), the declaration
 * that wins by importance, then the style attribute over a rule, a more specific rule and the later one. Either alone
 * is no hidden text of Word's: `display: none` with `mso-hide: screen` is Word's web hidden text, such as a table of
 * contents' leaders and page numbers, which Word shows on the page, and a web page hides menus and text for screen
 * readers with `display: none` alone. Both keep their text with `unsupported-formatting`, as before, and so does
 * `visibility: hidden`, which keeps its room on a page and is no signal of Word's.
 *
 * What the removal leaves: a paragraph, heading or list item that held nothing else goes with it when its paragraph
 * mark (Word's `<o:p>`) is hidden too or absent, and stays empty, as Word shows it, when its mark is visible. A table
 * cell or column keeps its place without its content, so the table keeps its shape. It runs after Office lists are
 * rebuilt, so a hidden item leaves one list, numbered as if the item were not there, and before styles and images
 * are read, so the hidden ones are neither reported nor prepared.
 */
export type HiddenTextReporter = (node: Element) => void;

/** One declaration as CSS reads it: its name and value lowercased and trimmed, and its text as written. */
interface Declaration { name: string; value: string; important: boolean; text: string }

/** A class rule's hiding declarations, with what decides between rules: its specificity and its place in the stylesheet. */
interface ClassRule { tag: string | undefined; specificity: number; order: number; declarations: Declaration[] }

/** The hidden text of one Word copy, read from its tree and stylesheet. */
export interface WordHiddenText {
  /** Whether an element is hidden text: both CSS and Word hide it. */
  hidden(element: Element): boolean;
  /** Whether nothing of an element would show once its hidden text is removed, so the removal takes it whole. */
  conceals(element: Element): boolean;
  /** Remove the hidden text below the root, reporting each removed element that held text or an image. Returns whether one did. */
  remove(report: HiddenTextReporter): boolean;
}

// Blocks a hidden run can leave empty, which then go with it unless their paragraph mark shows.
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'blockquote', 'pre', 'dt', 'dd', 'caption', 'center']);
// Containers that hold nothing once their last item, row or cell went.
const containers = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);
// A table cell or column keeps its place, so the table keeps its shape.
const places = new Set(['td', 'th', 'col']);
// Content that shows without text.
const media = new Set(['img', 'hr', 'svg', 'math', 'object', 'embed', 'video', 'audio', 'canvas', 'iframe', 'input', 'select', 'textarea', 'button']);
const hiding = new Set(['display', 'mso-hide']);
const PARAGRAPH_MARK = 'o:p';
const maxDeclarations = 256;
const maxRules = 1024;
const cssSpace = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const declarationName = /^-{0,2}[a-z_][a-z0-9_-]*$/;
const important = /^([\s\S]*?)[\t\n\f\r ]*![\t\n\f\r ]*important$/i;
// A selector of one element type and one class, or of one class, as Word writes its style rules.
const simpleSelector = /^([a-z][a-z0-9]*)?\.(-?[_a-z][\w-]*)$/i;
const mentionsHiding = /display|mso-hide/i;

/**
 * The declarations of a declaration list as CSS reads them: a semicolon inside a string or a bracket separates
 * nothing, a comment is no text, `!important` marks its declaration, and a declaration without a valid name or
 * colon, or with a string a line break ends, is dropped while the others stay. Bounded to the first 256.
 */
export function readDeclarations(text: string): Declaration[] {
  const found: Declaration[] = [];
  let current = '';
  let quote = '';
  let invalid = false;
  const closing: string[] = [];
  const flush = (): void => {
    const piece = current;
    const broken = invalid;
    current = ''; invalid = false;
    if (broken || found.length >= maxDeclarations) return;
    const colon = piece.indexOf(':');
    if (colon < 0) return;
    const name = piece.slice(0, colon).replace(cssSpace, '').toLowerCase();
    if (!declarationName.test(name)) return;
    const raw = piece.slice(colon + 1).replace(cssSpace, '');
    const marked = important.exec(raw);
    found.push({ name, value: (marked?.[1] ?? raw).replace(cssSpace, '').toLowerCase(), important: marked !== null, text: piece.replace(cssSpace, '') });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === '\\') { current += char + text.charAt(index + 1); index++; continue; }
    if (quote !== '') {
      if (char === quote) quote = '';
      // A line break ends a string unclosed: CSS drops its declaration.
      else if (char === '\n' || char === '\r' || char === '\f') { quote = ''; invalid = true; }
      current += char;
      continue;
    }
    if (char === '/' && text.charAt(index + 1) === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 1;
      current += ' ';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[' || char === '{') closing.push(char === '(' ? ')' : char === '[' ? ']' : '}');
    else if ((char === ')' || char === ']' || char === '}') && closing.at(-1) === char) closing.pop();
    else if (char === ';' && closing.length === 0) { flush(); continue; }
    current += char;
  }
  if (quote !== '') invalid = true;
  flush();
  return found;
}

/** The class rules of a copy's stylesheets that declare `display` or `mso-hide`, by class name. */
function classRules(tree: Root): Map<string, ClassRule[]> {
  const rules = new Map<string, ClassRule[]>();
  let order = 0;
  for (const node of tree.children) {
    if (node.type !== 'element' || node.tagName !== 'style') continue;
    for (const child of node.children) {
      if (child.type !== 'text' || !mentionsHiding.test(child.value)) continue;
      const css = child.value;
      forEachStyleRule(css, (start, open, end) => {
        const body = css.slice(open + 1, end);
        if (order >= maxRules || !mentionsHiding.test(body)) return;
        const prelude = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(cssSpace, '');
        if (prelude.startsWith('@')) return;
        const declarations = readDeclarations(body).filter(entry => hiding.has(entry.name));
        if (declarations.length === 0) return;
        for (const selector of prelude.split(',')) {
          const match = simpleSelector.exec(selector.replace(cssSpace, ''));
          const name = match?.[2];
          if (match === null || name === undefined) continue;
          const tag = match[1]?.toLowerCase();
          rules.set(name, [...rules.get(name) ?? [], { tag, specificity: tag === undefined ? 0 : 1, order: order++, declarations }]);
        }
      });
    }
  }
  return rules;
}

/** Compare two ranks entry by entry; the first that differs decides. */
function compareRanks(left: readonly number[], right: readonly number[]): number {
  for (const [index, entry] of left.entries()) {
    const difference = entry - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
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

/** Whether an element holds a paragraph mark. */
function holdsMark(node: ElementContent): boolean {
  return node.type === 'element' && (node.tagName === PARAGRAPH_MARK || node.children.some(holdsMark));
}

/** Read the hidden text of a Word copy: its stylesheet's hiding rules, and the elements both CSS and Word hide. */
export function wordHiddenText(tree: Root): WordHiddenText {
  const rules = classRules(tree);
  const hidden = (element: Element): boolean => {
    const candidates: { declaration: Declaration; rank: number[] }[] = [];
    const { className, style } = element.properties;
    if (rules.size > 0 && Array.isArray(className)) {
      for (const name of className) {
        for (const rule of typeof name === 'string' ? rules.get(name) ?? [] : []) {
          if (rule.tag !== undefined && rule.tag !== element.tagName) continue;
          for (const declaration of rule.declarations) candidates.push({ declaration, rank: [declaration.important ? 1 : 0, 0, rule.specificity, rule.order] });
        }
      }
    }
    if (typeof style === 'string' && mentionsHiding.test(style)) {
      for (const [index, declaration] of readDeclarations(style).entries()) {
        if (hiding.has(declaration.name)) candidates.push({ declaration, rank: [declaration.important ? 1 : 0, 1, 0, index] });
      }
    }
    // The declaration that wins: importance first, then the style attribute over a rule, specificity, and order.
    const value = (name: string): string | undefined => {
      let winner: { declaration: Declaration; rank: number[] } | undefined;
      for (const candidate of candidates) {
        if (candidate.declaration.name === name && (winner === undefined || compareRanks(candidate.rank, winner.rank) >= 0)) winner = candidate;
      }
      return winner?.declaration.value;
    };
    return candidates.length >= 2 && value('display') === 'none' && value('mso-hide') === 'all';
  };
  // What would show of a node once its hidden text is gone, and whether a paragraph mark would stay.
  const visible = (node: ElementContent): boolean => {
    if (node.type === 'text') return /[^\t\n\f\r \u00a0]/.test(node.value);
    if (node.type !== 'element' || hidden(node)) return false;
    return media.has(node.tagName) || (!listMarker(node) && node.children.some(visible));
  };
  const visibleMark = (node: ElementContent): boolean => node.type === 'element' && !hidden(node)
    && (node.tagName === PARAGRAPH_MARK || node.children.some(visibleMark));
  const holdsHidden = (node: ElementContent): boolean => node.type === 'element' && (hidden(node) || node.children.some(holdsHidden));
  let reported = false;
  const strip = (parent: Root | Element, report: HiddenTextReporter): boolean => {
    let removed = false;
    const children: Root['children'] = [];
    for (const child of parent.children) {
      if (child.type !== 'element') { children.push(child); continue; }
      if (hidden(child)) {
        removed = true;
        if (child.children.some(entry => shows(entry))) { report(child); reported = true; }
        if (places.has(child.tagName)) { child.children = []; withoutHiding(child); children.push(child); }
        continue;
      }
      if (!strip(child, report)) { children.push(child); continue; }
      removed = true;
      if (blocks.has(child.tagName) && !child.children.some(entry => shows(entry, false))) {
        // A block whose text was all hidden goes, its list marker with it, unless its paragraph mark shows: Word
        // then shows an empty line, as Word's own empty paragraph pastes.
        if (!holdsMark(child)) continue;
        emptyMarks(child);
      }
      if (containers.has(child.tagName) && !child.children.some(entry => entry.type === 'element')) continue;
      children.push(child);
    }
    if (removed) parent.children = children;
    return removed;
  };
  return {
    hidden,
    conceals: element => hidden(element) || (holdsHidden(element) && !element.children.some(visible) && !element.children.some(visibleMark)),
    remove(report) {
      reported = false;
      strip(tree, report);
      return reported;
    },
  };
}

/** A kept cell's or column's style without the declarations that hid it, so it reports no formatting it did not lose. */
function withoutHiding(element: Element): void {
  const { style } = element.properties;
  if (typeof style !== 'string') return;
  const kept = readDeclarations(style).filter(entry => !hiding.has(entry.name)).map(entry => entry.text);
  if (kept.length === 0) delete element.properties.style;
  else element.properties.style = kept.join(';');
}

/** Empty the paragraph marks of a block that shows nothing, as cleanup empties Word's own empty paragraph. */
function emptyMarks(node: Element): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === PARAGRAPH_MARK) child.children = [];
    else emptyMarks(child);
  }
}
