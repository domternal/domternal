import { DOMParser, DOMSerializer } from '@domternal/pm/model';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import type { Element, Root, RootContent } from 'hast';
import { readSafeStyles } from './html/styles.js';

const MAX_PROBES = 128;
const MAX_VALUE_UNITS = 16384;
const MAX_VALUE_LENGTH = 1024;
const MAX_NODES = 30000;
const MAX_DEPTH = 128;
const TEXT_PROPERTIES = ['font-family', 'font-size', 'color', 'background-color'] as const;
const BLOCK_PROPERTIES = ['text-align', 'line-height'] as const;
const SEMANTIC: Readonly<Record<string, string>> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', del: 's', strike: 's', sub: 'sub', sup: 'sup' };
const EQUIVALENT: Readonly<Record<string, readonly string[]>> = { strong: ['strong', 'b'], em: ['em', 'i'], s: ['s', 'del', 'strike'] };
interface Value { readonly block: string; readonly kind: 'inline' | 'block' | 'attribute' | 'semantic'; readonly property: string; readonly value: string }

/**
 * Check actual retained values against a small detached parser/serializer roundtrip.
 * This is advisory capability evidence, not a claim about final insertion or rendered pixels.
 * No source text, image source, resource-loading element or raw HTML enters a probe.
 */
export function confirmDestinationValues(schema: Schema, document: Document, tree: Root): boolean {
  const cache = new Set<string>();
  let units = 0;
  let nodes = 0;
  let inert: Document | undefined;
  let parser: DOMParser | undefined;
  let serializer: DOMSerializer | undefined;
  const probe = (value: Value): boolean => {
    const key = JSON.stringify(value);
    if (cache.has(key)) return true;
    if (cache.size >= MAX_PROBES || value.value.length > MAX_VALUE_LENGTH || (units += key.length) > MAX_VALUE_UNITS) return false;
    inert ??= document.implementation.createHTMLDocument('');
    parser ??= DOMParser.fromSchema(schema);
    serializer ??= DOMSerializer.fromSchema(schema);
    const host = inert.createElement('div');
    const block = inert.createElement(value.block);
    const carrier = value.kind === 'block' ? block : inert.createElement(value.kind === 'semantic' ? value.property : value.property === 'href' ? 'a' : 'span');
    if (value.kind === 'inline' || value.kind === 'block') carrier.style.setProperty(value.property, value.value);
    else if (value.kind === 'attribute') carrier.setAttribute(value.property, value.value);
    const expected = value.kind === 'inline' || value.kind === 'block' ? carrier.style.getPropertyValue(value.property) : value.value;
    if (value.kind !== 'semantic' && expected === '') return false;
    carrier.textContent = 'x';
    if (carrier !== block) block.append(carrier);
    host.append(block);
    const parsed = parser.parseSlice(host);
    if (parsed.content.size === 0) return false;
    let parsedCount = 0;
    parsed.content.descendants(() => { if (++parsedCount > 32) throw new RangeError('Unbounded destination probe'); });
    parsed.content.forEach(node => { node.check(); });
    const rendered = inert.createElement('div');
    rendered.append(serializer.serializeFragment(parsed.content, { document: inert }));
    const elements = [rendered as HTMLElement];
    let inspected = 0;
    let retained = false;
    while (elements.length > 0) {
      const element = elements.pop();
      if (element === undefined || ++inspected > 64) return false;
      if (value.kind === 'semantic') retained ||= (EQUIVALENT[value.property] ?? [value.property]).includes(element.localName);
      else if (value.kind === 'attribute') retained ||= element.getAttribute(value.property) === expected;
      else retained ||= element.style.getPropertyValue(value.property) === expected;
      for (let child = element.firstElementChild; child !== null; child = child.nextElementSibling) elements.push(child as HTMLElement);
    }
    // A configured block default can intentionally omit its declaration while retaining the exact model value.
    if (!retained && value.kind === 'block') {
      const attribute = value.property === 'text-align' ? 'textAlign' : value.property === 'line-height' ? 'lineHeight' : undefined;
      const node = parsed.content.childCount === 1 ? parsed.content.firstChild : null;
      retained = attribute !== undefined && node !== null && defaultAttribute(node, attribute, expected);
    }
    if (retained) cache.add(key);
    return retained;
  };
  const meaningful = new WeakSet<Element>();
  const styleCache = new Map<string, ReturnType<typeof readSafeStyles>['styles']>();
  let styleUnits = 0;
  const stack: { node: RootContent; block: string; depth: number; visited?: true }[] = tree.children.map(node => ({ node, block: 'p', depth: 1 }));
  // The input already passed the HTML limits. This walk additionally bounds its own work and never recurses.
  try {
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined || (!entry.visited && ++nodes > MAX_NODES) || entry.depth > MAX_DEPTH) return false;
      if (entry.node.type !== 'element') continue;
      const node = entry.node;
      const isBlock = /^(?:p|h[1-6]|pre)$/u.test(node.tagName);
      const block = isBlock ? node.tagName : entry.block;
      if (!entry.visited) {
        stack.push({ ...entry, visited: true });
        for (const child of node.children) stack.push({ node: child, block, depth: entry.depth + 1 });
        continue;
      }
      const hasText = node.children.some(child => child.type === 'text' ? child.value.length > 0 : child.type === 'element' && meaningful.has(child));
      if (hasText) meaningful.add(node);
      const rawStyle = node.properties.style;
      const styleKey = typeof rawStyle === 'string' && rawStyle.length <= 2048 ? `${node.tagName}:${rawStyle}` : undefined;
      let style = styleKey === undefined ? undefined : styleCache.get(styleKey);
      if (style === undefined) {
        style = readSafeStyles(rawStyle, false, node.tagName).styles;
        if (styleKey !== undefined && styleCache.size < 128 && styleUnits + styleKey.length <= 16384) {
          styleCache.set(styleKey, style); styleUnits += styleKey.length;
        }
      }
      for (const property of TEXT_PROPERTIES) {
        // Cell fills belong to the table node contract, not an inline Highlight in a paragraph.
        if (property === 'background-color' && (node.tagName === 'td' || node.tagName === 'th')) continue;
        const value = style.get(property);
        if (value !== undefined && (hasText || isBlock && property === 'background-color') && !probe({ block, kind: isBlock && property === 'background-color' ? 'block' : 'inline', property, value })) return false;
      }
      if (isBlock) for (const property of BLOCK_PROPERTIES) {
        const value = style.get(property);
        if (value !== undefined && !probe({ block, kind: 'block', property, value })) return false;
      }
      const semantic = SEMANTIC[node.tagName];
      if (hasText && semantic !== undefined && !probe({ block, kind: 'semantic', property: semantic, value: '' })) return false;
      if (hasText && node.tagName === 'a' && typeof node.properties.href === 'string' && !probe({ block, kind: 'attribute', property: 'href', value: node.properties.href })) return false;
    }
    return true;
  } catch {
    // A custom schema failure cannot reject or modify an otherwise valid paste.
    return false;
  }
}

function defaultAttribute(node: PMNode, attribute: string, expected: string): boolean {
  return node.attrs[attribute] === expected && node.type.spec.attrs?.[attribute]?.default === expected;
}
