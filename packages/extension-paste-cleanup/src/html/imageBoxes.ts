import type { Element, Root } from 'hast';
import { imageSourceAttributes } from './parse.js';
import { plainDeclarations, zeroLength } from './styles.js';

const boxDeclarations = new Set(['border', 'display', 'overflow', 'width', 'height']);

/** Lowercased declarations, the last of a name winning; undefined for a style CSS may read otherwise. */
function declarations(style: unknown): Map<string, string> | undefined {
  const plain = plainDeclarations(style);
  return plain && new Map(plain.map(([name, value]) => [name, value.toLowerCase()]));
}

/** A positive pixel length, from a CSS `px` value or the source text of an HTML size attribute. */
function pixels(value: string | undefined, css: boolean): number | undefined {
  const match = /^(\d{1,5}(?:\.\d{1,3})?)(px)?$/.exec(value ?? '');
  const size = Number(match?.[1]);
  return match !== null && (match[2] !== undefined) === css && size > 0 ? size : undefined;
}

/**
 * The box is the image's own: an inline-block of the image's attribute size around an image that keeps that
 * size, with no margin, padding, `hspace`, `vspace` or border attribute moving it inside the clip, and the
 * image's bottom edge as its baseline too. Only an image shorter than the line's text is clipped there, by the
 * line's baseline below the box's height; without the box such an image shows whole.
 */
function drawsOnlyImage(span: Element): boolean {
  const image = span.children[0];
  if (span.children.length !== 1 || image?.type !== 'element' || image.tagName !== 'img') return false;
  const box = declarations(span.properties.style);
  const own = declarations(image.properties.style);
  // The parser's reading of the attributes, since HAST reads sizes such as `1e3` or `0x140` as numbers browsers do not.
  const source = imageSourceAttributes.get(image);
  if (box === undefined || own === undefined || source === undefined || [...box.keys()].some(name => !boxDeclarations.has(name))) return false;
  if (box.get('display') !== 'inline-block' || box.get('overflow') !== 'hidden' || (box.get('border') ?? 'none') !== 'none') return false;
  if (source.has('hspace') || source.has('vspace') || !/^0*$/.test(source.get('border') ?? '')) return false;
  for (const side of ['width', 'height'] as const) {
    const size = pixels(source.get(side), false);
    const css = own.get(side);
    if (size === undefined || pixels(box.get(side), true) !== size || (css !== undefined && pixels(css, true) !== size)) return false;
  }
  return [...own].every(([name, value]) => !/^(?:margin|padding)/.test(name) || value.split(/\s+/).every(zeroLength));
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
