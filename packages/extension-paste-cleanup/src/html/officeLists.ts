import type { Comment, Element, ElementContent, Root, RootContent, Text } from 'hast';
import { StructureLimitError } from './parse.js';
import { declaredFont, officeLevelKey, readOfficeListRules, resolveOfficeLevel } from './officeListStyles.js';
import type { OfficeLevelDefinition, OfficeListRules } from './officeListStyles.js';

export interface OfficeListReconstructionOptions {
  maxNodes: number;
  maxDepth: number;
  /** Missing capabilities retain the original paragraph and visible marker. */
  orderedLists?: boolean;
  bulletLists?: boolean;
  nestedLists?: boolean;
  /** Marker classes the destination preserves. Absent means every class. */
  markers?: ReadonlySet<string>;
}

export interface OfficeListReconstructionResult {
  reconstructedRuns: number;
  reconstructedLists: number;
  reconstructedItems: number;
  skippedRuns: number;
}

export type OfficeListReporter = (code: 'office-list-unsupported', node: Element) => void;

interface Declaration {
  present: boolean;
  value?: string;
  /** Other declarations in source order, with lowercased names. */
  remaining?: readonly { name: string; text: string }[];
}

interface Candidate {
  paragraph: Element;
  declaration: Declaration;
  after: ElementContent[];
}

interface ListItem {
  paragraph: Element;
  marker: Element;
  level: number;
  identity: string;
  kind: 'ol' | 'ul';
  markerStyle: 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman' | 'disc' | 'circle' | 'square';
  ordinal?: number;
  after: ElementContent[];
}

interface Level {
  list: Element;
  identity: string;
  markerStyle: ListItem['markerStyle'];
  nextOrdinal: number | undefined;
  lastItem: Element;
}

const inlineWrappers = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sub', 'sup', 'mark', 'font']);
const containers = new Set(['div', 'blockquote', 'td', 'th', 'details']);
const opaque = new Set(['ul', 'ol', 'li', 'pre', 'code', 'script', 'style', 'template', 'noscript', 'textarea', 'svg', 'math']);
const markerProperties = new Set(['style', 'className', 'lang', 'dir']);
// The rebuilt list owns item indentation, so the source level geometry is not a loss.
const levelGeometry = new Set(['margin', 'margin-left', 'margin-inline-start', 'text-indent', 'mso-add-space']);
const prefixWhitespace = /^[\t\r\n ]*$/;
const listMetadata = /^l([0-9]{1,10})[\t\n\f\r ]+level([1-9])[\t\n\f\r ]+lfo([0-9]{1,10})$/;

type MarkerValue = Pick<ListItem, 'kind' | 'ordinal' | 'markerStyle'>;

interface BulletProfile { style: ListItem['markerStyle']; glyphs: readonly string[]; font?: string }
/**
 * Bullet level texts Word writes, keyed by decoded `mso-level-text`. Symbol font bullets need
 * the definition and the marker run to name the same font, because their glyphs are private
 * use or ordinary letters that mean a bullet only in that font. Unicode bullets need no font.
 */
const bulletProfiles: ReadonlyMap<string, BulletProfile> = new Map([
  ['\uF0B7', { style: 'disc', glyphs: ['\u00B7', '\uF0B7'], font: 'symbol' }],
  ['\u00B7', { style: 'disc', glyphs: ['\u00B7', '\uF0B7'], font: 'symbol' }],
  ['o', { style: 'circle', glyphs: ['o'], font: 'courier new' }],
  ['\uF0A7', { style: 'square', glyphs: ['\u00A7', '\uF0A7'], font: 'wingdings' }],
  ['\u00A7', { style: 'square', glyphs: ['\u00A7', '\uF0A7'], font: 'wingdings' }],
  ['\u2022', { style: 'disc', glyphs: ['\u2022'] }],
  ['\u25CF', { style: 'disc', glyphs: ['\u25CF'] }],
  ['\u25E6', { style: 'circle', glyphs: ['\u25E6'] }],
  ['\u25AA', { style: 'square', glyphs: ['\u25AA'] }],
]);

const roman = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const romanDigits: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** A canonical Roman numeral up to 3999 in one case, never an empty or repeated-subtraction form. */
function romanOrdinal(label: string, upper: boolean): number | undefined {
  if (label === '' || label !== (upper ? label.toUpperCase() : label.toLowerCase())) return undefined;
  const lower = label.toLowerCase();
  if (!roman.test(lower)) return undefined;
  let total = 0;
  for (let index = 0; index < lower.length; index++) {
    const value = romanDigits[lower.charAt(index)] ?? 0;
    total += value < (romanDigits[lower.charAt(index + 1)] ?? 0) ? -value : value;
  }
  return total;
}

const orderedProfiles: Readonly<Partial<Record<OfficeLevelDefinition['format'], {
  style: ListItem['markerStyle'];
  ordinal: (label: string) => number | undefined;
}>>> = {
  decimal: { style: 'decimal', ordinal: label => /^[1-9][0-9]{0,4}$/.test(label) && Number(label) <= 10_000 ? Number(label) : undefined },
  'alpha-lower': { style: 'lower-alpha', ordinal: label => /^[a-z]$/.test(label) ? label.charCodeAt(0) - 96 : undefined },
  'alpha-upper': { style: 'upper-alpha', ordinal: label => /^[A-Z]$/.test(label) ? label.charCodeAt(0) - 64 : undefined },
  'roman-lower': { style: 'lower-roman', ordinal: label => romanOrdinal(label, false) },
  'roman-upper': { style: 'upper-roman', ordinal: label => romanOrdinal(label, true) },
};

/** Read one explicit declaration without interpreting strings, comments, or functions as CSS. */
function listDeclaration(input: unknown): Declaration {
  if (typeof input !== 'string') return { present: false };
  let declaration = '';
  let quote = '';
  const blocks: string[] = [];
  let malformed = false;
  let present = false;
  let value: string | undefined;
  const remaining: { name: string; text: string }[] = [];
  const consume = (): void => {
    const colon = declaration.indexOf(':');
    const name = colon >= 0 ? declaration.slice(0, colon).trim().toLowerCase() : '';
    if (name === 'mso-list') {
      const next = declaration.slice(colon + 1).trim().toLowerCase();
      if (present && value !== next) malformed = true;
      present = true;
      value = next;
    } else if (declaration.trim() !== '') remaining.push({ name, text: declaration.trim() });
    declaration = '';
  };
  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    if (char === '\\') {
      declaration += char;
      if (index + 1 < input.length) declaration += input.charAt(++index);
      else malformed = true;
    } else if (quote !== '') {
      declaration += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      declaration += char;
      quote = char;
    } else if (char === '/' && input[index + 1] === '*') {
      const end = input.indexOf('*/', index + 2);
      if (end < 0) { malformed = true; break; }
      declaration += ' ';
      index = end + 1;
    } else if (char === '(' || char === '[' || char === '{') {
      blocks.push(char === '(' ? ')' : char === '[' ? ']' : '}');
      declaration += char;
    } else if (char === ')' || char === ']' || char === '}') {
      if (blocks.pop() !== char) malformed = true;
      declaration += char;
    } else if (char === ';' && blocks.length === 0) consume();
    else declaration += char;
  }
  consume();
  return { present, ...(malformed || quote !== '' || blocks.length !== 0 || value === undefined ? {} : { value, remaining }) };
}

function candidate(node: RootContent): Candidate | undefined {
  if (node.type !== 'element' || node.tagName !== 'p') return undefined;
  const declaration = listDeclaration(node.properties.style);
  if (!declaration.present || declaration.value === 'none') return undefined;
  return { paragraph: node, declaration, after: [] };
}

function trivia(node: RootContent | undefined): node is Comment | Text {
  return node?.type === 'comment' || (node?.type === 'text' && prefixWhitespace.test(node.value));
}

/** The visible marker text without surrounding spacing, or undefined for anything but plain marker spans. */
function markerLabel(marker: Element): string | undefined {
  let text = '';
  let visited = 0;
  const pending: RootContent[] = [marker];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (++visited > 32) return undefined;
    if (node.type === 'text') {
      text += node.value;
      if (text.length > 64) return undefined;
    } else if (node.type === 'element') {
      if (node.tagName !== 'span' || Object.keys(node.properties).some(key => !markerProperties.has(key))) return undefined;
      if (node !== marker && listDeclaration(node.properties.style).present) return undefined;
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child !== undefined) pending.push(child);
      }
    } else return undefined;
  }
  return text.replace(/^[\t\n\r \u00a0]+|[\t\n\r \u00a0]+$/gu, '');
}

/** Without Word level metadata only decimal numbers and Unicode bullets are admitted, as before. */
function legacyMarker(label: string): MarkerValue | undefined {
  if (!/^(?:[1-9][0-9]{0,4}[.)]|[•·◦▪●])$/u.test(label)) return undefined;
  if (/^[•·◦▪●]$/u.test(label)) {
    // Preserve the admitted marker class, without claiming its original font or geometry.
    return { kind: 'ul', markerStyle: label === '◦' ? 'circle' : label === '▪' ? 'square' : 'disc' };
  }
  const ordinal = Number(label.slice(0, -1));
  return ordinal <= 10_000 ? { kind: 'ol', ordinal, markerStyle: 'decimal' } : undefined;
}

/**
 * Resolve a marker against its Word level definition. The visible label must be exactly what
 * the definition produces for this level, and a symbol font bullet also needs its marker run
 * font. Legal, multilevel, prefixed and other formats stay unsupported.
 */
function profileMarker(label: string, level: number, definition: OfficeLevelDefinition, runFont: string | null | undefined): MarkerValue | undefined {
  if (definition.legal) return undefined;
  if (definition.format === 'bullet') {
    const profile = bulletProfiles.get(definition.text ?? '');
    if (!profile?.glyphs.includes(label)) return undefined;
    if (profile.font !== undefined && (definition.font !== profile.font || runFont !== profile.font)) return undefined;
    return { kind: 'ul', markerStyle: profile.style };
  }
  const ordered = orderedProfiles[definition.format];
  if (ordered === undefined) return undefined;
  const text = definition.text;
  const punctuation = text === undefined || text === `%${String(level)}.` ? '.' : text === `%${String(level)})` ? ')' : undefined;
  if (punctuation === undefined || !label.endsWith(punctuation)) return undefined;
  const ordinal = ordered.ordinal(label.slice(0, -1));
  return ordinal === undefined ? undefined : { kind: 'ol', ordinal, markerStyle: ordered.style };
}

function readItem(entry: Candidate, rules: OfficeListRules): ListItem | undefined {
  const metadata = listMetadata.exec(entry.declaration.value ?? '');
  const identity = metadata?.[1];
  const level = metadata?.[2];
  const instance = metadata?.[3];
  if (identity === undefined || level === undefined || instance === undefined) return undefined;
  let prefix = true;
  let marker: Element | undefined;
  let markerFont: string | null | undefined;
  // Each entry carries the nearest font declared on its ancestors, so the marker gets its run font.
  const paragraphFont = declaredFont(entry.paragraph.properties.style);
  const pending: { node: RootContent; font: string | null | undefined }[] = [...entry.paragraph.children].reverse()
    .map(node => ({ node, font: paragraphFont }));
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const node = current.node;
    if (node.type === 'comment') continue;
    if (node.type === 'text') {
      if (!prefixWhitespace.test(node.value)) prefix = false;
      continue;
    }
    if (node.type !== 'element') { prefix = false; continue; }
    // Fonts after the marker cannot affect it, so only the prefix reads them.
    const own = marker === undefined ? declaredFont(node.properties.style) : undefined;
    const font = own === undefined ? current.font : own;
    const declaration = listDeclaration(node.properties.style);
    if (declaration.present) {
      if (declaration.value !== 'ignore' || marker !== undefined || !prefix) return undefined;
      marker = node;
      markerFont = font;
      prefix = false;
      continue;
    }
    if (!inlineWrappers.has(node.tagName)) prefix = false;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) pending.push({ node: child, font });
    }
  }
  if (marker === undefined) return undefined;
  const label = markerLabel(marker);
  if (label === undefined) return undefined;
  const definition = resolveOfficeLevel(rules, identity, Number(level), instance);
  const value = definition === undefined ? legacyMarker(label)
    : definition === null ? undefined : profileMarker(label, Number(level), definition, markerFont);
  if (value === undefined) return undefined;
  return {
    paragraph: entry.paragraph, marker, level: Number(level),
    identity: `${identity}:${instance}`, after: entry.after, ...value,
  };
}

function withoutMarker(parent: Element, marker: Element): Element {
  let changed = false;
  const children: ElementContent[] = [];
  for (const child of parent.children) {
    if (child === marker) { changed = true; continue; }
    if (child.type !== 'element') { children.push(child); continue; }
    const next = withoutMarker(child, marker);
    if (next !== child) changed = true;
    children.push(next);
  }
  return changed ? { ...parent, children } : parent;
}

function reconstructRun(items: ListItem[]): { lists: Element[]; count: number } {
  const lists: Element[] = [];
  const stack: Level[] = [];
  let count = 0;
  for (const item of items) {
    stack.length = Math.min(stack.length, item.level);
    let current = stack[item.level - 1];
    if (current?.list.tagName !== item.kind || current.identity !== item.identity || current.markerStyle !== item.markerStyle
      || (item.kind === 'ol' && current.nextOrdinal !== item.ordinal)) {
      const list: Element = { type: 'element', tagName: item.kind, properties: {
        ...(item.ordinal === undefined ? {} : { start: item.ordinal }), style: `list-style-type:${item.markerStyle}`,
      }, children: [] };
      if (item.level === 1) lists.push(list);
      else {
        const parent = stack[item.level - 2];
        if (parent === undefined) throw new Error('Missing validated Office list parent');
        parent.lastItem.children.push(list);
      }
      current = { list, identity: item.identity, markerStyle: item.markerStyle, lastItem: list, nextOrdinal: undefined };
      stack[item.level - 1] = current;
      count++;
    }
    const paragraph = withoutMarker(item.paragraph, item.marker);
    const properties = { ...paragraph.properties };
    const remaining = listDeclaration(properties.style).remaining;
    if (remaining !== undefined) {
      const style = remaining.filter(entry => !levelGeometry.has(entry.name)).map(entry => entry.text).join(';');
      if (style === '') delete properties.style;
      else properties.style = style;
    }
    const listItem: Element = {
      type: 'element', tagName: 'li', properties: {},
      children: [{ ...paragraph, properties }, ...item.after],
    };
    current.list.children.push(listItem);
    current.lastItem = listItem;
    current.nextOrdinal = item.ordinal === undefined ? undefined : item.ordinal + 1;
  }
  return { lists, count };
}

function assertBounds(tree: Root, options: OfficeListReconstructionOptions): void {
  let nodes = 0;
  const pending = tree.children.map(node => ({ node, depth: 1 }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { node, depth } = entry;
    if (++nodes > options.maxNodes || depth > options.maxDepth) throw new StructureLimitError();
    if (node.type === 'element') {
      for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
    }
  }
}

/** Level keys that list paragraphs reference, so the stylesheet reader records nothing else. */
function referencedLevels(tree: Root): Set<string> {
  const keys = new Set<string>();
  const pending: RootContent[] = [...tree.children];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type !== 'element' || opaque.has(node.tagName)) continue;
    const style = node.properties.style;
    if (node.tagName === 'p' && typeof style === 'string' && style.toLowerCase().includes('mso-list')) {
      const metadata = listMetadata.exec(listDeclaration(style).value ?? '');
      if (metadata?.[1] !== undefined && metadata[2] !== undefined) {
        keys.add(officeLevelKey(metadata[1], metadata[2]));
        keys.add(officeLevelKey(metadata[1], metadata[2], metadata[3]));
      }
    }
    pending.push(...node.children);
  }
  return keys;
}

/** Word puts its list definitions in the clipboard document's stylesheet, a root element of the fragment. */
function stylesheetTexts(tree: Root): string[] {
  const texts: string[] = [];
  for (const node of tree.children) {
    if (node.type !== 'element' || node.tagName !== 'style') continue;
    for (const child of node.children) if (child.type === 'text') texts.push(child.value);
  }
  return texts;
}

/**
 * Reconstruct only explicit Office list paragraphs whose visible markers are supported.
 * Word level definitions from the clipboard stylesheet and the marker run font identify
 * profiles that the visible glyph alone cannot. Plan all replacements before committing so
 * unsupported runs and limit errors preserve input. Sanitation and destination insertion
 * remain the caller's responsibility.
 */
export function reconstructOfficeLists(
  tree: Root,
  options: OfficeListReconstructionOptions,
  report: OfficeListReporter,
): OfficeListReconstructionResult {
  const result: OfficeListReconstructionResult = {
    reconstructedRuns: 0, reconstructedLists: 0, reconstructedItems: 0, skippedRuns: 0,
  };
  const skipped: Element[] = [];
  const rules = readOfficeListRules(stylesheetTexts(tree), referencedLevels(tree));
  const representable = (item: ListItem): boolean => !(item.kind === 'ol' && options.orderedLists === false)
    && !(item.kind === 'ul' && options.bulletLists === false)
    && options.markers?.has(item.markerStyle) !== false
    && !(item.level > 1 && options.nestedLists === false);
  function rewrite(parent: Element): ElementContent[];
  function rewrite(parent: Root): RootContent[];
  function rewrite(parent: Root | Element): RootContent[] {
    const children: RootContent[] = [];
    const supportsRuns = parent.type === 'root' || containers.has(parent.tagName);
    for (let index = 0; index < parent.children.length;) {
      const child = parent.children[index];
      if (child === undefined) break;
      const first = supportsRuns ? candidate(child) : undefined;
      if (first === undefined) {
        if (child.type === 'element' && !opaque.has(child.tagName)) children.push({ ...child, children: rewrite(child) });
        else children.push(child);
        index++;
        continue;
      }
      const entries = [first];
      const original: RootContent[] = [child];
      let end = index + 1;
      while (end < parent.children.length) {
        let nextIndex = end;
        while (nextIndex < parent.children.length && trivia(parent.children[nextIndex])) nextIndex++;
        const nextChild = parent.children[nextIndex];
        const next = nextChild === undefined ? undefined : candidate(nextChild);
        if (next === undefined) break;
        const between = parent.children.slice(end, nextIndex).filter(trivia);
        const previous = entries[entries.length - 1];
        if (previous !== undefined) previous.after = between;
        original.push(...between, next.paragraph);
        entries.push(next);
        end = nextIndex + 1;
      }
      const items: ListItem[] = [];
      let problem: Element | undefined;
      let previousLevel = 0;
      for (const entry of entries) {
        const item = readItem(entry, rules);
        if (item === undefined || item.level > previousLevel + 1 || !representable(item)) {
          problem = entry.paragraph;
          break;
        }
        items.push(item);
        previousLevel = item.level;
      }
      if (problem !== undefined) {
        children.push(...original);
        skipped.push(problem);
        result.skippedRuns++;
      } else {
        const reconstructed = reconstructRun(items);
        children.push(...reconstructed.lists);
        result.reconstructedRuns++;
        result.reconstructedLists += reconstructed.count;
        result.reconstructedItems += items.length;
      }
      index = end;
    }
    return children;
  }
  const children = rewrite(tree);
  assertBounds({ ...tree, children }, options);
  tree.children = children;
  for (const node of skipped) report('office-list-unsupported', node);
  return result;
}
