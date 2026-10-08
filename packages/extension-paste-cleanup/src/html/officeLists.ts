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
  /** Runs with at least one reconstructed item. */
  reconstructedRuns: number;
  reconstructedLists: number;
  reconstructedItems: number;
  /** Runs whose every item stayed literal. */
  skippedRuns: number;
  /** Items that stayed literal paragraphs with their visible marker. */
  skippedItems: number;
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

interface Marker {
  element: Element;
  /** The nearest font declared on the marker or its ancestors in the paragraph. */
  font: string | null | undefined;
}

/** A list level opened above an item whose parent levels a selection left out, from the level definitions. */
interface Ancestor {
  kind: ListItem['kind'];
  markerStyle: ListItem['markerStyle'];
  start: number;
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

// Marker spacing: CSS white space and the no-break spaces of Word's spacer runs.
const markerSpacing = /[\t\n\f\r \xa0]/gu;
// The longest label a marker may hold, and the most spacing around it: Word right aligns a level's label by
// padding it with a 7 pt spacer that fills the indent before it, about one no-break space per point (92 before
// a label at 99 pt), so about 1,600 at the widest indent Word allows (22 inches, 1,584 pt). The spacing has a
// bound of its own, with room for that, and only the label counts toward 64.
const maxLabelLength = 64;
const maxMarkerText = 2_048;

/** The visible marker text without surrounding spacing, or undefined for anything but plain marker spans. */
function markerLabel(marker: Element): string | undefined {
  let text = '';
  let label = 0;
  let visited = 0;
  const pending: RootContent[] = [marker];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (++visited > 32) return undefined;
    if (node.type === 'text') {
      text += node.value;
      label += node.value.replace(markerSpacing, '').length;
      if (label > maxLabelLength || text.length > maxMarkerText) return undefined;
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

/**
 * The marker element of a list paragraph: the one `mso-list:Ignore` element in its prefix, before any text,
 * with the font of its run. Undefined when the paragraph has none or more than one.
 */
function findMarker(entry: Candidate): Marker | undefined {
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
  return marker === undefined ? undefined : { element: marker, font: markerFont };
}

function readItem(entry: Candidate, rules: OfficeListRules, marker: Marker | undefined): ListItem | undefined {
  const metadata = listMetadata.exec(entry.declaration.value ?? '');
  const identity = metadata?.[1];
  const level = metadata?.[2];
  const instance = metadata?.[3];
  if (identity === undefined || level === undefined || instance === undefined || marker === undefined) return undefined;
  const label = markerLabel(marker.element);
  if (label === undefined) return undefined;
  const definition = resolveOfficeLevel(rules, identity, Number(level), instance);
  const value = definition === undefined ? legacyMarker(label)
    : definition === null ? undefined : profileMarker(label, Number(level), definition, marker.font);
  if (value === undefined) return undefined;
  return {
    paragraph: entry.paragraph, marker: marker.element, level: Number(level),
    identity: `${identity}:${instance}`, after: entry.after, ...value,
  };
}

/**
 * The marker class a level definition alone gives a level without a marker of its own: the same profiles
 * as profileMarker, with the definition's font in place of the absent marker run's.
 */
function definitionMarker(definition: OfficeLevelDefinition, level: number): Pick<ListItem, 'kind' | 'markerStyle'> | undefined {
  if (definition.legal) return undefined;
  if (definition.format === 'bullet') {
    const profile = bulletProfiles.get(definition.text ?? '');
    if (profile === undefined || (profile.font !== undefined && definition.font !== profile.font)) return undefined;
    return { kind: 'ul', markerStyle: profile.style };
  }
  const ordered = orderedProfiles[definition.format];
  const text = definition.text;
  if (ordered === undefined || !(text === undefined || text === `%${String(level)}.` || text === `%${String(level)})`)) return undefined;
  return { kind: 'ol', markerStyle: ordered.style };
}

/**
 * A picture bullet of an item that stays literal: Word writes the picture inside the marker. It is the
 * marker's decoration, never content, so it is not an image to paste or resolve: its alt text, if any,
 * stays as the visible marker the literal paragraph keeps.
 */
function literalMarkerPictures(marker: Element): void {
  marker.children = marker.children.flatMap((child): ElementContent[] => {
    if (child.type !== 'element') return [child];
    if (child.tagName !== 'img') { literalMarkerPictures(child); return [child]; }
    const alt = child.properties.alt;
    return typeof alt === 'string' && alt !== '' ? [{ type: 'text', value: alt, ...(child.position === undefined ? {} : { position: child.position }) }] : [];
  });
}

/** The metadata level of a candidate, or the first level when its metadata cannot be read. */
function entryLevel(entry: Candidate): number {
  return Number(listMetadata.exec(entry.declaration.value ?? '')?.[2] ?? 1);
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

interface RunOutput {
  content: RootContent[];
  lists: number;
  items: number;
  literal: number;
  /** First paragraph of each maximal contiguous literal segment. */
  segments: Element[];
}

type AncestorProfile = (item: ListItem, level: number) => Pick<ListItem, 'kind' | 'markerStyle'> | undefined;

/**
 * The levels to open above an item whose parent levels do not exist, as a selection that starts in a
 * nested item leaves them out: each from its level definition, with one empty item. An ordered level
 * starts one before the ordinal of its next item in the run, so that item continues it. Undefined when
 * a missing level has no supported definition.
 */
function ancestorsOf(entries: readonly PlannedEntry[], position: number, item: ListItem, depth: number, profile: AncestorProfile): Ancestor[] | undefined {
  const ancestors: Ancestor[] = [];
  for (let level = depth + 1; level < item.level; level++) {
    const value = profile(item, level);
    if (value === undefined) return undefined;
    let start = 1;
    for (const next of entries.slice(position + 1)) {
      const nextLevel = next.item?.level ?? entryLevel(next.entry);
      if (nextLevel < level) break;
      if (nextLevel > level) continue;
      const ordinal = next.item?.ordinal;
      if (next.item?.identity === item.identity && next.item.kind === value.kind && next.item.markerStyle === value.markerStyle
        && ordinal !== undefined && ordinal > 1) start = ordinal - 1;
      break;
    }
    ancestors.push({ ...value, start });
  }
  return ancestors;
}

interface PlannedEntry { entry: Candidate; item: ListItem | undefined; marker: Marker | undefined }

/**
 * Place a run item by item. A supported item joins the list stack as before. A supported item
 * whose parent levels do not exist opens them from their level definitions, each with one empty
 * item, so it keeps its depth and marker, but only before the run placed its first item. An
 * unsupported item, one that skips a level later in the run, or one whose missing parent levels
 * have no supported definition, stays a literal paragraph with its visible marker: inside the
 * nearest open list item when the destination can nest, otherwise at the run's own level, which
 * closes the open lists. Deeper items under a literal one have no list parent, so they stay
 * literal too until the level returns to a supported parent, unless their own definitions open it.
 */
function reconstructRun(entries: readonly PlannedEntry[], nestedLists: boolean, profile: AncestorProfile): RunOutput {
  const output: RunOutput = { content: [], lists: 0, items: 0, literal: 0, segments: [] };
  const stack: Level[] = [];
  let literalSegment = false;
  for (const [position, { entry, item, marker }] of entries.entries()) {
    const level = item?.level ?? entryLevel(entry);
    // Only a run that starts below its first level opens the levels above: a selection left them out. A level
    // skipped after an item was placed is the document's own, which an empty item would show as a marker Word does not.
    const ancestors = item !== undefined && stack.length < level - 1
      ? output.items === 0 ? ancestorsOf(entries, position, item, stack.length, profile) : undefined : [];
    if (item === undefined || ancestors === undefined) {
      if (marker !== undefined) literalMarkerPictures(marker.element);
      output.literal++;
      if (!literalSegment) output.segments.push(entry.paragraph);
      literalSegment = true;
      stack.length = Math.min(stack.length, level - 1);
      const parent = stack.at(-1);
      if (parent !== undefined && nestedLists) parent.lastItem.children.push(entry.paragraph, ...entry.after);
      else {
        stack.length = 0;
        output.content.push(entry.paragraph, ...entry.after);
      }
      continue;
    }
    literalSegment = false;
    for (const ancestor of ancestors) {
      const list: Element = { type: 'element', tagName: ancestor.kind, properties: {
        ...(ancestor.kind === 'ol' ? { start: ancestor.start } : {}), style: `list-style-type:${ancestor.markerStyle}`,
      }, children: [] };
      const empty: Element = { type: 'element', tagName: 'li', properties: {}, children: [] };
      list.children.push(empty);
      const parent = stack.at(-1);
      if (parent === undefined) output.content.push(list);
      else parent.lastItem.children.push(list);
      stack.push({ list, identity: item.identity, markerStyle: ancestor.markerStyle, lastItem: empty,
        nextOrdinal: ancestor.kind === 'ol' ? ancestor.start + 1 : undefined });
      output.lists++;
    }
    stack.length = Math.min(stack.length, item.level);
    let current = stack[item.level - 1];
    if (current?.list.tagName !== item.kind || current.identity !== item.identity || current.markerStyle !== item.markerStyle
      || (item.kind === 'ol' && current.nextOrdinal !== item.ordinal)) {
      const list: Element = { type: 'element', tagName: item.kind, properties: {
        ...(item.ordinal === undefined ? {} : { start: item.ordinal }), style: `list-style-type:${item.markerStyle}`,
      }, children: [] };
      if (item.level === 1) output.content.push(list);
      else {
        const parent = stack[item.level - 2];
        if (parent === undefined) throw new Error('Missing validated Office list parent');
        parent.lastItem.children.push(list);
      }
      current = { list, identity: item.identity, markerStyle: item.markerStyle, lastItem: list, nextOrdinal: undefined };
      stack[item.level - 1] = current;
      output.lists++;
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
    output.items++;
  }
  return output;
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

/**
 * Level keys that list paragraphs reference, with the levels above each, which a selection that starts
 * in a nested item can need to open. The stylesheet reader records nothing else.
 */
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
        for (let level = 1; level <= Number(metadata[2]); level++) {
          keys.add(officeLevelKey(metadata[1], level));
          keys.add(officeLevelKey(metadata[1], level, metadata[3]));
        }
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
    reconstructedRuns: 0, reconstructedLists: 0, reconstructedItems: 0, skippedRuns: 0, skippedItems: 0,
  };
  const skipped: Element[] = [];
  const rules = readOfficeListRules(stylesheetTexts(tree), referencedLevels(tree));
  const representable = (item: Pick<ListItem, 'kind' | 'markerStyle' | 'level'>): boolean => !(item.kind === 'ol' && options.orderedLists === false)
    && !(item.kind === 'ul' && options.bulletLists === false)
    && options.markers?.has(item.markerStyle) !== false
    && !(item.level > 1 && options.nestedLists === false);
  const ancestorProfile: AncestorProfile = (item, level) => {
    const [list = '', instance] = item.identity.split(':');
    const definition = resolveOfficeLevel(rules, list, level, instance);
    const value = definition === undefined || definition === null ? undefined : definitionMarker(definition, level);
    return value !== undefined && representable({ ...value, level }) ? value : undefined;
  };
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
        entries.push(next);
        end = nextIndex + 1;
      }
      const planned = entries.map(entry => {
        const marker = findMarker(entry);
        const item = readItem(entry, rules, marker);
        return { entry, marker, item: item !== undefined && representable(item) ? item : undefined };
      });
      const reconstructed = reconstructRun(planned, options.nestedLists !== false, ancestorProfile);
      children.push(...reconstructed.content);
      skipped.push(...reconstructed.segments);
      if (reconstructed.items > 0) result.reconstructedRuns++;
      else result.skippedRuns++;
      result.reconstructedLists += reconstructed.lists;
      result.reconstructedItems += reconstructed.items;
      result.skippedItems += reconstructed.literal;
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
