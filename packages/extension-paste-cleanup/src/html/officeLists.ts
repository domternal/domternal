import type { Comment, Element, ElementContent, Root, RootContent, Text } from 'hast';
import { StructureLimitError } from './parse.js';

export interface OfficeListReconstructionOptions {
  maxNodes: number;
  maxDepth: number;
  /** Missing capabilities retain the original paragraph and visible marker. */
  orderedLists?: boolean;
  bulletLists?: boolean;
  nestedLists?: boolean;
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
  markerStyle: 'decimal' | 'disc' | 'circle' | 'square';
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

function markerValue(marker: Element): Pick<ListItem, 'kind' | 'ordinal' | 'markerStyle'> | undefined {
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
  const match = /^[\t\n\r \u00a0]*([1-9][0-9]{0,4}[.)]|[•·◦▪●])[\t\n\r \u00a0]*$/u.exec(text);
  const label = match?.[1];
  if (label === undefined) return undefined;
  if (/^[•·◦▪●]$/u.test(label)) {
    // Preserve the admitted marker class, without claiming its original font or geometry.
    return { kind: 'ul', markerStyle: label === '◦' ? 'circle' : label === '▪' ? 'square' : 'disc' };
  }
  const ordinal = Number(label.slice(0, -1));
  return ordinal <= 10_000 ? { kind: 'ol', ordinal, markerStyle: 'decimal' } : undefined;
}

function readItem(entry: Candidate): ListItem | undefined {
  const metadata = /^l([0-9]{1,10})[\t\n\f\r ]+level([1-9])[\t\n\f\r ]+lfo([0-9]{1,10})$/.exec(entry.declaration.value ?? '');
  const identity = metadata?.[1];
  const level = metadata?.[2];
  const instance = metadata?.[3];
  if (identity === undefined || level === undefined || instance === undefined) return undefined;
  let prefix = true;
  let marker: Element | undefined;
  const pending: RootContent[] = [...entry.paragraph.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.type === 'comment') continue;
    if (node.type === 'text') {
      if (!prefixWhitespace.test(node.value)) prefix = false;
      continue;
    }
    if (node.type !== 'element') { prefix = false; continue; }
    const declaration = listDeclaration(node.properties.style);
    if (declaration.present) {
      if (declaration.value !== 'ignore' || marker !== undefined || !prefix) return undefined;
      marker = node;
      prefix = false;
      continue;
    }
    if (!inlineWrappers.has(node.tagName)) prefix = false;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) pending.push(child);
    }
  }
  if (marker === undefined) return undefined;
  const value = markerValue(marker);
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

/**
 * Reconstruct only explicit Office list paragraphs whose visible markers are supported.
 * Plan all replacements before committing so unsupported runs and limit errors preserve input.
 * Sanitation and destination insertion remain the caller's responsibility.
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
        const item = readItem(entry);
        if (item === undefined || item.level > previousLevel + 1
          || (item.kind === 'ol' && options.orderedLists === false)
          || (item.kind === 'ul' && options.bulletLists === false)
          || (item.level > 1 && options.nestedLists === false)) {
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
