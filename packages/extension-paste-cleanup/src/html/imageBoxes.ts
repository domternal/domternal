import type { Element, Root } from 'hast';
import { zeroLength } from './styles.js';

const boxDeclarations = new Set(['border', 'display', 'overflow', 'width', 'height']);

/** Lowercased declarations, the last of a name winning; undefined when one has no value. */
function declarations(style: unknown): Map<string, string> | undefined {
  const result = new Map<string, string>();
  for (const declaration of typeof style === 'string' ? style.split(';') : []) {
    if (declaration.trim() === '') continue;
    const separator = declaration.indexOf(':');
    if (separator < 0) return undefined;
    result.set(declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim().toLowerCase());
  }
  return result;
}

/** A positive pixel length, from a CSS `px` value or an HTML size attribute. */
function pixels(value: unknown, css: boolean): number | undefined {
  const text = String(value);
  const match = css ? /^(\d{1,5}(?:\.\d{1,3})?)px$/.exec(text) : /^\d{1,5}(?:\.\d{1,3})?$/.exec(text);
  const size = Number(css ? match?.[1] : match?.[0]);
  return match !== null && size > 0 ? size : undefined;
}

/**
 * The box is exactly the image's: an inline-block of the image's attribute size that clips nothing,
 * since the image keeps that size and no margin moves it. Its baseline is the image's bottom edge too.
 */
function drawsOnlyImage(span: Element): boolean {
  const image = span.children[0];
  if (span.children.length !== 1 || image?.type !== 'element' || image.tagName !== 'img') return false;
  const box = declarations(span.properties.style);
  const own = declarations(image.properties.style);
  if (box === undefined || own === undefined || [...box.keys()].some(name => !boxDeclarations.has(name))) return false;
  if (box.get('display') !== 'inline-block' || box.get('overflow') !== 'hidden' || (box.get('border') ?? 'none') !== 'none') return false;
  for (const side of ['width', 'height'] as const) {
    const size = pixels(image.properties[side], false);
    const css = own.get(side);
    if (size === undefined || pixels(box.get(side), true) !== size || (css !== undefined && pixels(css, true) !== size)) return false;
  }
  return [...own].every(([name, value]) => !name.startsWith('margin') || value.split(/\s+/).every(zeroLength));
}

/**
 * Drop the style of a span that only draws the box of the one image it holds, the shape Google Docs is
 * expected to write around images, checked against authored HTML, not native captures. Any crop, offset
 * or other layout keeps the style, so it is still reported.
 */
export function quietImageBoxes(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type === 'element' && node.tagName === 'span' && node.properties.style !== undefined && drawsOnlyImage(node)) delete node.properties.style;
  }
}
