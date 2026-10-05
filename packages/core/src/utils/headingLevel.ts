/**
 * Heading levels: the vocabulary every configuration shares (whole numbers
 * from 1 to 6) and the rule that places a level a configuration lacks.
 */
import { DOMParser } from '@domternal/pm/model';
import type { NodeType, Schema, TagParseRule } from '@domternal/pm/model';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import type { AttributeSpec } from '../types/AttributeSpec.js';
import { registerAttributeNormalizer } from './normalizedAttributes.js';

/** Whether the value is a heading level: a whole number from 1 to 6. */
export function isHeadingLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

/** The levels read from each option list, with the entries they were read from. */
const configured = new WeakMap<readonly unknown[], { entries: readonly unknown[]; levels: readonly number[] }>();

/**
 * Checks the Heading `levels` option, a non-empty list of heading levels in any
 * order, and returns the levels it offers: each level once, at its first
 * position, so the first stays the default. The option itself is never changed.
 */
export function configuredHeadingLevels(levels: unknown): readonly number[] {
  // Rendering asks once per heading. A list read before with the same entries was
  // valid then and is valid now, so only a new or changed list is checked again.
  const list = Array.isArray(levels) ? levels as readonly unknown[] : undefined;
  const cached = list === undefined ? undefined : configured.get(list);
  // An application may change its option list in place; the copy notices.
  if (list !== undefined && cached?.entries.length === list.length
    && cached.entries.every((entry, index) => entry === list[index])) return cached.levels;
  if (!Array.isArray(levels) || levels.length === 0 || ![...levels as unknown[]].every(isHeadingLevel)) {
    throw new ExtensionConfigurationError('Heading: levels must be a non-empty list of whole numbers from 1 to 6');
  }
  const option = levels as readonly number[];
  const unique = Object.freeze([...new Set(option)]);
  configured.set(option, { entries: [...option], levels: unique });
  return unique;
}

/**
 * The configured level that keeps a heading's place in the outline: the
 * nearest level of equal or lower importance, otherwise the deepest configured
 * level. A heading is never promoted while a deeper level exists, and the
 * order of outline levels is kept. PasteCleanup applies the same rule to
 * pasted headings with its own copy, since its HTML entry must not import Core.
 */
export function nearestHeadingLevel(level: number, levels: readonly number[]): number {
  let deeper: number | undefined;
  let deepest = levels[0] ?? 1;
  for (const candidate of levels) {
    if (candidate >= level && (deeper === undefined || candidate < deeper)) deeper = candidate;
    if (candidate > deepest) deepest = candidate;
  }
  return deeper ?? deepest;
}

/**
 * The parse rule priority of a heading tag the levels lack: below 1, so every
 * rule at priority 1 or above wins, and higher the nearer the level it takes
 * is by the rule above, so among nodes built from Heading the one whose levels
 * hold the nearest deeper level wins, otherwise the nearest shallower one.
 */
export function unconfiguredTagPriority(level: number, levels: readonly number[]): number {
  const taken = nearestHeadingLevel(level, levels);
  const distance = taken > level ? taken - level : 10 + level - taken;
  return (100 - distance) / 100;
}

// Elements whose text ProseMirror's parser never reads.
const UNREAD = new Set(['HEAD', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE']);

// Text ProseMirror's parser reads between blocks: anything but the white space it collapses, so a
// no-break space counts.
const READ_TEXT = /[^ \t\r\n\f]/;

// Without a schema, the elements a Domternal schema parses as nodes count by name. PasteCleanup's
// copy of this rule counts the same ones in a cleaned fragment.
const NODE_ELEMENTS = new Set(['BLOCKQUOTE', 'BR', 'DETAILS', 'HR', 'IMG', 'OL', 'P', 'PRE', 'TABLE', 'UL']);

/** The schema a heading is parsed into, and its heading node type. */
export interface HeadingParseContext {
  readonly schema: Schema;
  readonly heading: NodeType;
}

/**
 * The tag rule a schema's parser applies to an element: the first that matches in priority
 * order, apart from rule contexts.
 */
function matchedRule(schema: Schema, element: Element): TagParseRule | undefined {
  for (const rule of DOMParser.fromSchema(schema).rules) {
    if (!('tag' in rule)) continue;
    const { tag, getAttrs } = rule as TagParseRule;
    let matches: boolean;
    try {
      matches = element.matches(tag);
    } catch {
      continue;
    }
    if (matches && (getAttrs === undefined || getAttrs(element as HTMLElement) !== false)) return rule as TagParseRule;
  }
  return undefined;
}

/**
 * The node type a schema's parse rules give an element; null when no node rule matches, so the
 * element's content joins the enclosing node.
 */
function parsedNodeType(schema: Schema, element: Element): NodeType | null {
  const rule = matchedRule(schema, element);
  if (rule === undefined) return null;
  const { node, skip, closeParent, ignore } = rule;
  // A rule that skips, closes the parent or ignores the element makes no node of it.
  if (node === undefined || ignore === true || closeParent === true || skip === true) return null;
  return schema.nodes[node] ?? null;
}

/**
 * Whether a node before a heading puts content into its list item, so the heading no longer
 * starts the item: text the parser reads, a no-break space too, or an element a parse rule makes
 * a node of, such as a line break, an image, a horizontal rule or a paragraph, even the empty
 * `<p></p>` getHTML writes for an empty label. Inline content opens the item's paragraph, and a
 * block moves the heading after it. Any other element, such as a wrapper or a mark, counts by
 * what it holds. Without the parse context, the elements alone decide.
 */
function holdsContent(node: ChildNode, context: HeadingParseContext | undefined): boolean {
  if (node.nodeType === 3) return READ_TEXT.test(node.nodeValue ?? '');
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  const name = element.tagName.toUpperCase();
  const rule = context === undefined ? undefined : matchedRule(context.schema, element);
  if (rule === undefined) {
    if (UNREAD.has(name)) return false;
    if (context === undefined && NODE_ELEMENTS.has(name)) return true;
  } else if (rule.ignore === true) {
    // The parser still opens a paragraph for a line break a rule ignores.
    return name === 'BR';
  } else if (rule.skip !== true && (rule.node !== undefined || rule.closeParent === true)) {
    return true;
  }
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    if (holdsContent(child, context)) return true;
  }
  return false;
}

/**
 * The list item whose content before a heading is being read. Reading it matches the rules of
 * each heading element before that heading, which asks this rule again; see headingCannotStand.
 */
let reading: Element | undefined;

/** Whether the node an element parses as can start with a heading; true when no node parses it. */
function startsWithHeading(context: HeadingParseContext, element: Element): boolean {
  const type = parsedNodeType(context.schema, element);
  if (type === null) return true;
  return type.contentMatch.matchType(context.heading) !== null;
}

/**
 * Whether a heading element sits where a heading cannot stand: in a summary or
 * a preformatted block, whose content is inline, or at the start of its list
 * item, whose first block must be a paragraph, with nothing before it that the
 * item would hold. ProseMirror would move a heading out of each, splitting the
 * list or emptying the summary, so every heading tag there parses as that
 * block's text, as 1.2 parsed the tags the levels lacked.
 *
 * With the parse context, only the nodes the schema holds count: without a
 * list item, details summary or code block node, or with one that can start
 * with a heading, such as a list item whose content is `block+`, the element
 * is no such place and the heading stands, as in 1.2. Without it, as for a
 * spec built outside the ExtensionManager, the elements alone decide.
 */
export function headingCannotStand(element: HTMLElement, context?: HeadingParseContext): boolean {
  const inline = element.parentElement?.closest('summary, pre');
  if (inline && (context === undefined || !startsWithHeading(context, inline))) return true;
  // A table cell, blockquote or details inside the item holds blocks of its own.
  const item = element.parentElement?.closest('li, td, th, blockquote, details');
  if (item?.tagName.toUpperCase() !== 'LI') return false;
  if (context !== undefined && startsWithHeading(context, item)) return false;
  // An earlier heading of the item being read counts by what it holds, so it is
  // answered as text. Had it stood, content before it would have let it, and the
  // reading finds that content too. So the reading never nests within one item,
  // however many headings it holds.
  if (item === reading) return true;
  const outer = reading;
  reading = item;
  try {
    for (let node: ChildNode | null = element; node !== null && node !== item; node = node.parentNode as ChildNode | null) {
      for (let before = node.previousSibling; before !== null; before = before.previousSibling) {
        if (holdsContent(before, context)) return false;
      }
    }
  } finally {
    reading = outer;
  }
  return true;
}

/** A decimal number written as a string, such as a level stored as "5". */
const decimal = /^\s*[+-]?\d+(?:\.\d+)?\s*$/;

/**
 * The configured level a stored value renders and loads as. A decimal string
 * counts as its number, so "5" keeps its place in the outline. Another finite
 * number is rounded up, toward less importance, into the range 1 to 6 first.
 * Any other value takes the first configured level, the default.
 */
export function resolveHeadingLevel(value: unknown, levels: readonly number[]): number {
  // A heading level in the list is the nearest level to itself.
  if (isHeadingLevel(value) && levels.includes(value)) return value;
  const level = typeof value === 'string' && decimal.test(value) ? Number(value) : value;
  if (typeof level !== 'number' || !Number.isFinite(level)) return levels[0] ?? 1;
  return nearestHeadingLevel(Math.min(6, Math.max(1, Math.ceil(level))), levels);
}

/**
 * The default and validation of the heading `level` attribute. Validation
 * accepts the whole vocabulary, not only the configured levels, so a document
 * written with other levels, such as by a collaborator configured with more,
 * still loads everywhere: in Node.fromJSON, Node.check and Step.fromJSON.
 * The editor's JSON entry points move a level these `levels` lack to the
 * nearest configured one and report it; rendering does the same without
 * changing the document.
 */
export function headingLevelAttribute(levels: readonly number[]): Pick<AttributeSpec, 'default' | 'validate'> {
  const invalid = (value: unknown): boolean => !isHeadingLevel(value);
  const validate = (value: unknown): void => {
    if (invalid(value)) throw new RangeError('Invalid heading level');
  };
  registerAttributeNormalizer(validate, {
    code: 'unsupported-heading-level',
    invalid,
    unsupported: value => invalid(value) || !levels.includes(value as number),
    replacement: value => resolveHeadingLevel(value, levels),
  });
  // Content and commands without a level get the first configured one.
  return { default: levels[0], validate };
}
