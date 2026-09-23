import type { Element, ElementContent, Properties, Root, RootContent, Text } from 'hast';
import { readSafeStyles, serializeStyles, styleToRead } from './styles.js';
import { envelopeTags } from './envelope.js';

export interface InlineInheritanceOptions {
  maxNodes: number;
  maxDepth: number;
  /** Reuse the input budget to bound additional generated attribute characters. */
  maxInputLength?: number;
  formatting?: 'preserve' | 'adapt';
}

export class InheritanceLimitError extends Error {}

interface FontSize { value: number; unit: 'px' | 'pt' }
interface State {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  subscript: boolean;
  superscript: boolean;
  family?: string;
  size?: FontSize;
  color?: string;
  highlight?: string;
  defaultHighlight: boolean;
  colorToken?: string;
  highlightToken?: string;
}

const neutralTags = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup']);
const inlineTags = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'mark', 'a', 'code', 'sub', 'sup', 'font', 'br']);
const discarded = new Set(['script', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'button', ...envelopeTags]);
const structuralText = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'ul', 'ol']);
const inheritedKeys = ['font-weight', 'font-style', 'font-family', 'font-size', 'color', 'text-decoration', 'text-decoration-line'];
const cssWide = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
// Named color keywords: https://www.w3.org/TR/css-color-4/#named-colors.
const namedColors = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
  + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew '
  + 'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue '
  + 'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred '
  + 'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple '
  + 'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
  + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white '
  + 'whitesmoke yellow yellowgreen transparent'
).split(' '));

/** Validate only the legacy color forms already admitted by readSafeStyles. */
function validColor(value: string): boolean {
  if (namedColors.has(value.toLowerCase()) || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true;
  const match = /^(rgb|rgba|hsl|hsla)\(([^)]+)\)$/i.exec(value);
  if (match === null) return false;
  const name = match[1]?.toLowerCase() ?? '';
  const parts = (match[2] ?? '').split(',').map(part => part.trim());
  if (parts.length !== (name.endsWith('a') ? 4 : 3)) return false;
  if (parts.some(part => !/^(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part))) return false;
  if (name.startsWith('hsl')) {
    if (parts[0]?.endsWith('%') || !parts[1]?.endsWith('%') || !parts[2]?.endsWith('%')) return false;
  } else if (parts.slice(0, 3).some(part => part.endsWith('%') !== parts[0]?.endsWith('%'))) return false;
  return parts.every(part => Number.isFinite(Number.parseFloat(part)));
}

/** Fully transparent inline boxes reveal their ancestor's painted background. */
function fullyTransparent(value: string): boolean {
  if (value.toLowerCase() === 'transparent') return true;
  if (value.startsWith('#')) return (value.length === 5 && value.endsWith('0')) || (value.length === 9 && value.endsWith('00'));
  const match = /^(?:rgba|hsla)\([^)]*,([^,)]+)\)$/i.exec(value);
  return match !== null && Number.parseFloat(match[1] ?? '') === 0;
}

function validFamily(value: string): boolean {
  if (cssWide.has(value.toLowerCase())) return false;
  const parts: string[] = [];
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote !== undefined) { if (character === quote) quote = undefined; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === ',') { parts.push(value.slice(start, index)); start = index + 1; }
  }
  if (quote !== undefined) return false;
  parts.push(value.slice(start));
  return parts.every(part => {
    const name = part.trim();
    if (name === '') return false;
    if (name.startsWith('"') || name.startsWith("'")) {
      return name.length > 2 && name.at(-1) === name[0] && !name.slice(1, -1).includes(name[0] ?? '');
    }
    return name.split(/\s+/).every(word => /^-?(?:[\p{L}_]|--)[\p{L}\p{N}_-]*$/u.test(word));
  });
}

/**
 * Preserve source order while ignoring invalid values within the safe grammar. Office writes the
 * `windowtext` system color to reset text to the default color; it resets the inherited color.
 */
function readInheritanceStyles(value: unknown, image: boolean, tag: string): { styles: Map<string, string>; removed: boolean; defaultColor: boolean } {
  const styles = new Map<string, string>();
  let removed = false;
  let defaultColor = false;
  if (typeof value !== 'string') return { styles, removed, defaultColor };
  for (const declaration of value.split(';')) {
    const parsed = readSafeStyles(declaration, image, tag);
    removed ||= parsed.removed;
    for (const [key, entry] of parsed.styles) {
      if (key === 'color' && entry.toLowerCase() === 'windowtext') { styles.delete(key); defaultColor = true; continue; }
      if (((key === 'color' || key === 'background-color') && !validColor(entry))
        || (key === 'font-family' && !validFamily(entry))) { removed = true; continue; }
      if (key === 'color') defaultColor = false;
      if (key === 'text-decoration') styles.delete('text-decoration-line');
      if (key === 'text-decoration-line') styles.delete('text-decoration');
      styles.set(key, entry);
    }
  }
  return { styles, removed, defaultColor };
}

function resolveSize(value: string, parent: FontSize | undefined): FontSize | undefined {
  if (value === '0') return { value: 0, unit: parent?.unit ?? 'px' };
  const match = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i.exec(value);
  const number = Number(match?.[1]);
  const unit = match?.[2]?.toLowerCase();
  if (unit === 'px' || unit === 'pt') return { value: number, unit };
  if (parent === undefined || (unit !== 'em' && unit !== '%')) return undefined;
  const computed = parent.value * number / (unit === '%' ? 100 : 1);
  if (!Number.isFinite(computed) || computed > 9_999 || (computed > 0 && computed < 0.001)) return undefined;
  return { value: Math.round(computed * 1_000) / 1_000, unit: parent.unit };
}

/**
 * Resolve a fixed subset of source inline formatting before schema parsing.
 * This is not a stylesheet cascade or sanitizer. The caller must still sanitize
 * properties and URLs and must bypass cosmetic rewriting for verified own copies.
 * Source boundaries are retained; generated wrappers contain text or a hard break.
 */
export function resolveInlineInheritance(
  tree: Root,
  options: InlineInheritanceOptions,
  onUnsupported?: (element: Element) => void,
  onAdapted?: (element: Element) => void,
): void {
  // Adapt keeps semantic emphasis but never materializes source typography onto leaves.
  const preserve = options.formatting !== 'adapt';
  // The parser clones misnested formatting elements with the same source location; report each declaration once.
  const adaptedDeclarations = new Set<string>();
  const maxStyleLength = options.maxInputLength ?? 2_000_000;
  if (!Number.isSafeInteger(options.maxNodes) || options.maxNodes < 1 || options.maxNodes > 30_000
    || !Number.isSafeInteger(options.maxDepth) || options.maxDepth < 1 || options.maxDepth > 128
    || !Number.isSafeInteger(maxStyleLength) || maxStyleLength < 1 || maxStyleLength > 2_000_000) {
    throw new RangeError('Invalid inline inheritance limits');
  }
  let generatedStyleLength = 0;
  let nodes = 0;
  const pending: { node: RootContent; depth: number }[] = tree.children.map(node => ({ node, depth: 1 }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    if (++nodes > options.maxNodes || entry.depth > options.maxDepth) throw new InheritanceLimitError();
    if (entry.node.type === 'element') {
      for (const child of entry.node.children) pending.push({ node: child, depth: entry.depth + 1 });
    }
  }
  const wrapLeaf = (leaf: Text | Element, state: State, depth: number): ElementContent => {
    const styles = new Map<string, string>();
    const properties: Properties = {};
    if (preserve) {
      if (state.family !== undefined) styles.set('font-family', state.family);
      if (state.size !== undefined) styles.set('font-size', `${String(state.size.value)}${state.size.unit}`);
      if (state.color !== undefined) styles.set('color', state.color);
      if (state.highlight !== undefined) styles.set('background-color', state.highlight);
      if (state.colorToken !== undefined) properties['dataTextColor'] = state.colorToken;
      if (state.highlightToken !== undefined) properties['dataBgColor'] = state.highlightToken;
    }
    // Account for repeated source values before concatenating them into new
    // strings. Node limits alone do not bound a long color copied to many runs.
    let attributeLength = 0;
    for (const [name, value] of styles) attributeLength += name.length + value.length + 2;
    for (const [name, value] of Object.entries(properties)) attributeLength += name.length + String(value).length + 4;
    if (generatedStyleLength + attributeLength > maxStyleLength) throw new InheritanceLimitError();
    generatedStyleLength += attributeLength;
    if (styles.size > 0) properties.style = serializeStyles(styles);
    const tags: string[] = [];
    if (state.bold) tags.push('strong');
    if (state.italic) tags.push('em');
    if (state.underline) tags.push('u');
    if (state.strike) tags.push('s');
    if (state.subscript) tags.push('sub');
    if (state.superscript) tags.push('sup');
    const carrier = preserve && (state.defaultHighlight || Object.keys(properties).length > 0);
    const extra = tags.length + Number(carrier);
    if (nodes + extra > options.maxNodes || depth + extra > options.maxDepth) throw new InheritanceLimitError();
    nodes += extra;
    let child: ElementContent = leaf;
    for (const tagName of tags.reverse()) child = { type: 'element', tagName, properties: {}, children: [child], ...(leaf.position === undefined ? {} : { position: leaf.position }) };
    if (carrier) child = { type: 'element', tagName: state.defaultHighlight ? 'mark' : 'span', properties, children: [child], ...(leaf.position === undefined ? {} : { position: leaf.position }) };
    return child;
  };
  const visit = (parent: Root | Element, inherited: State, depth: number): void => {
    const children: RootContent[] = [];
    for (const child of parent.children) {
      if (child.type === 'text') {
        children.push(parent.type === 'element' && structuralText.has(parent.tagName) ? child : wrapLeaf(child, inherited, depth + 1));
        continue;
      }
      if (child.type !== 'element' || discarded.has(child.tagName)) { children.push(child); continue; }
      const state: State = { ...inherited };
      const tag = child.tagName;
      const inline = inlineTags.has(tag);
      const { styles, removed, defaultColor } = readInheritanceStyles(styleToRead(child), tag === 'img', tag);
      let unsupported = removed;
      // One adapted finding per discarded source property, reported on its declaring element.
      const adapted: string[] = [];
      if (tag === 'b' || tag === 'strong') state.bold = true;
      if (tag === 'i' || tag === 'em') state.italic = true;
      if (tag === 'mark') { state.defaultHighlight = true; delete state.highlight; delete state.highlightToken; }
      const weight = styles.get('font-weight');
      if (weight !== undefined) state.bold = weight === 'bold' || Number(weight) >= 600;
      const italic = styles.get('font-style');
      if (italic !== undefined) state.italic = italic !== 'normal';
      const decoration = styles.get('text-decoration-line') ?? styles.get('text-decoration');
      state.underline ||= decoration === undefined ? tag === 'u' : decoration.includes('underline');
      state.strike ||= decoration === undefined ? ['s', 'strike', 'del'].includes(tag) : decoration.includes('line-through');
      const vertical = styles.get('vertical-align');
      if (inline) {
        state.subscript ||= vertical === undefined ? tag === 'sub' : vertical === 'sub';
        state.superscript ||= vertical === undefined ? tag === 'sup' : vertical === 'super';
        if (vertical !== undefined) {
          if (['baseline', 'sub', 'super'].includes(vertical)) styles.delete('vertical-align');
          else unsupported = true;
        }
      } else if (vertical === 'sub' || vertical === 'super') {
        // Script alignment does not apply to block or table-cell content.
        styles.delete('vertical-align');
        unsupported = true;
      }
      const family = styles.get('font-family');
      if (family !== undefined) { state.family = family; adapted.push('font-family'); }
      const size = styles.get('font-size');
      if (size !== undefined) {
        adapted.push('font-size');
        const resolved = resolveSize(size, inherited.size);
        // An unknown relative base is a loss only when typography is preserved.
        if (resolved === undefined) { delete state.size; unsupported ||= preserve; }
        else state.size = resolved;
      }
      const color = styles.get('color');
      if (color !== undefined) { state.color = color; delete state.colorToken; adapted.push('color'); }
      else if (defaultColor) { delete state.color; delete state.colorToken; }
      // Inline backgrounds paint behind their descendants. Block and cell fills
      // stay on their owners and must not become text highlight marks.
      const highlight = styles.get('background-color');
      if (inline && highlight !== undefined) {
        if (!fullyTransparent(highlight)) {
          state.highlight = highlight; state.defaultHighlight = false; delete state.highlightToken; adapted.push('background-color');
        } else if (tag === 'mark') {
          state.defaultHighlight = inherited.defaultHighlight;
          if (inherited.highlight !== undefined) state.highlight = inherited.highlight;
          if (inherited.highlightToken !== undefined) state.highlightToken = inherited.highlightToken;
        }
        styles.delete('background-color');
      }
      if (inline) {
        for (const [key, stateKey] of [['dataTextColor', 'colorToken'], ['dataBgColor', 'highlightToken']] as const) {
          const token = child.properties[key];
          if (typeof token === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(token)) {
            state[stateKey] = token; adapted.push(key);
            if (stateKey === 'colorToken') delete state.color;
            else { delete state.highlight; state.defaultHighlight = false; }
          } else if (token !== undefined) unsupported = true;
        }
        delete child.properties['dataTextColor'];
        delete child.properties['dataBgColor'];
      }
      // A mark paints the default highlight only when neither a background nor a highlight token replaces it.
      if (tag === 'mark' && highlight === undefined && state.defaultHighlight) adapted.push('mark');
      for (const key of inheritedKeys) styles.delete(key);
      if (styles.size > 0) child.properties.style = serializeStyles(styles);
      else delete child.properties.style;
      if (neutralTags.has(tag)) child.tagName = 'span';
      if (unsupported) onUnsupported?.(child);
      if (!preserve) {
        const offset = child.position?.start.offset;
        for (const property of adapted) {
          if (offset !== undefined) {
            const declaration = `${String(offset)}:${property}`;
            if (adaptedDeclarations.has(declaration)) continue;
            adaptedDeclarations.add(declaration);
          }
          onAdapted?.(child);
        }
      }
      visit(child, state, depth + 1);
      children.push(tag === 'br' ? wrapLeaf(child, state, depth + 1) : child);
    }
    parent.children = children;
  };
  visit(tree, { bold: false, italic: false, underline: false, strike: false, subscript: false, superscript: false, defaultHighlight: false }, 0);
}
