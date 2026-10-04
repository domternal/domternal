import type { Element, Nodes, Root } from 'hast';
import { StructureLimitError } from './parse.js';
import { readSafeStyles } from './styles.js';
import { cleanSliceContext } from './metadata.js';
import { listStyleFromType, validListStyle } from './listStyles.js';
import type { PasteHTMLLimits } from './types.js';
import { linkFeature } from './links.js';

export type PasteDestinationFeature =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript'
  | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5' | 'heading-6'
  | 'font-family' | 'font-size' | 'text-color' | 'highlight' | 'text-align' | 'line-height'
  | 'table' | 'table-header' | 'ordered-list' | 'bullet-list' | 'nested-list'
  | 'ordered-list-style' | 'bullet-list-style'
  | 'link-http' | 'link-https' | 'link-mailto' | 'link-tel'
  // An image node that holds a remote source, and one that holds a data URL. Asked for each image a paste keeps.
  | 'image' | 'image-data'
  // Where the destination parses a heading as the enclosing block's text: at the start of a list
  // item, in a summary, in a preformatted block. Asked only by heading level adaptation.
  | 'heading-text-at-list-item-start' | 'heading-text-in-summary' | 'heading-text-in-preformatted';

const featureOrder: readonly PasteDestinationFeature[] = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'subscript', 'superscript',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
  'font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height',
  'table', 'table-header', 'ordered-list', 'bullet-list', 'nested-list',
  'ordered-list-style', 'bullet-list-style',
  'link-http', 'link-https', 'link-mailto', 'link-tel',
]);
const headings: Readonly<Record<string, PasteDestinationFeature>> = {
  h1: 'heading-1', h2: 'heading-2', h3: 'heading-3',
  h4: 'heading-4', h5: 'heading-5', h6: 'heading-6',
};
const semanticMarks: Readonly<Record<string, PasteDestinationFeature>> = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline',
  s: 'strike', del: 'strike', sub: 'subscript', sup: 'superscript', mark: 'highlight',
};
const inlineTags = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'a', 'code', 'sub', 'sup']);
const token = /^[a-z][a-z0-9-]{0,63}$/;

function validToken(value: unknown): boolean {
  return typeof value === 'string' && token.test(value);
}

function elementDemand(node: Element, hasInlineContent: boolean, nestedList: boolean, features: Set<PasteDestinationFeature>): void {
  const tag = node.tagName;
  const heading = Object.hasOwn(headings, tag) ? headings[tag] : undefined;
  if (heading !== undefined) features.add(heading);
  if (tag === 'table') features.add('table');
  if (tag === 'th') { features.add('table'); features.add('table-header'); }
  if (tag === 'ol' || tag === 'ul') {
    features.add(tag === 'ol' ? 'ordered-list' : 'bullet-list');
    if (nestedList) features.add('nested-list');
    const marker = readSafeStyles(node.properties.style, false, tag).styles.get('list-style-type')
      ?? listStyleFromType(tag, node.properties.type);
    if (marker !== undefined && node.properties.dataType !== 'taskList') features.add(tag === 'ol' ? 'ordered-list-style' : 'bullet-list-style');
  }
  const slice = cleanSliceContext(node.properties['dataPmSlice']);
  if (slice !== undefined) {
    const context = JSON.parse(slice.slice(slice.indexOf('['))) as unknown[];
    for (let index = 0; index < context.length; index += 2) {
      const kind = context[index];
      const attributes = context[index + 1] as Record<string, unknown> | null;
      const listTag = kind === 'orderedList' ? 'ol' : kind === 'bulletList' ? 'ul' : '';
      if (validListStyle(listTag, attributes?.['listStyleType'])) features.add(listTag === 'ol' ? 'ordered-list-style' : 'bullet-list-style');
    }
  }

  // Empty paragraph layout is meaningful; cell layout belongs to table support.
  const paragraph = tag === 'p' || heading !== undefined;
  if (!hasInlineContent && !paragraph) return;
  const styles = readSafeStyles(node.properties.style).styles;
  if (paragraph) {
    if (styles.has('text-align')) features.add('text-align');
    if (styles.has('line-height')) features.add('line-height');
  }
  if (!hasInlineContent) return;

  const semantic = Object.hasOwn(semanticMarks, tag) ? semanticMarks[tag] : undefined;
  if (semantic !== undefined) features.add(semantic);
  // A link with text needs its scheme; an empty one carries nothing to lose.
  const link = tag === 'a' ? linkFeature(node.properties.href) : undefined;
  if (link !== undefined) features.add(link);
  if (/^(?:bold|[6-9]00)$/.test(styles.get('font-weight') ?? '')) features.add('bold');
  if (/^(?:italic|oblique)$/.test(styles.get('font-style') ?? '')) features.add('italic');
  const decoration = styles.get('text-decoration-line') ?? styles.get('text-decoration') ?? '';
  if (decoration.includes('underline')) features.add('underline');
  if (decoration.includes('line-through')) features.add('strike');
  if (styles.get('vertical-align') === 'sub') features.add('subscript');
  if (styles.get('vertical-align') === 'super') features.add('superscript');
  if (styles.has('font-family')) features.add('font-family');
  if (styles.has('font-size')) features.add('font-size');
  if (styles.has('color') || validToken(node.properties['dataTextColor'])) features.add('text-color');
  // A block or cell's painted box is not an inline text highlight.
  if (inlineTags.has(tag) && (styles.has('background-color') || validToken(node.properties['dataBgColor']))) features.add('highlight');
}

interface Frame {
  node: Nodes;
  depth: number;
  listAncestors: number;
  nextChild: number;
  hasInlineContent: boolean;
}

/**
 * Read an already sanitized, policy-adapted tree. This is feature demand only,
 * not another sanitizer or a certificate for each value or destination context.
 * The iterative postorder retains at most one frame per admitted depth. Every
 * occurrence, including comments and empty text, consumes the node allowance.
 */
export function collectDestinationDemand(
  tree: Root,
  limits: Pick<PasteHTMLLimits, 'maxNodes' | 'maxDepth'>,
): readonly PasteDestinationFeature[] {
  const { maxNodes, maxDepth } = limits;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new StructureLimitError();
  let nodes = 0;
  const frames: Frame[] = [];
  const features = new Set<PasteDestinationFeature>();
  const enter = (node: Nodes, depth: number, listAncestors: number): void => {
    if (++nodes > maxNodes || depth > maxDepth) throw new StructureLimitError();
    frames.push({ node, depth, listAncestors, nextChild: 0,
      hasInlineContent: node.type === 'text' && node.value.length > 0 || node.type === 'element' && node.tagName === 'br' });
  };
  enter(tree, 0, 0);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) break;
    if ('children' in frame.node && frame.nextChild < frame.node.children.length) {
      const child = frame.node.children[frame.nextChild++];
      if (child === undefined) throw new StructureLimitError();
      const list = frame.node.type === 'element' && (frame.node.tagName === 'ol' || frame.node.tagName === 'ul');
      enter(child, frame.depth + 1, frame.listAncestors + (list ? 1 : 0));
      continue;
    }
    if (frame.node.type === 'element') elementDemand(frame.node, frame.hasInlineContent, frame.listAncestors > 0, features);
    frames.pop();
    const parent = frames[frames.length - 1];
    if (parent !== undefined) parent.hasInlineContent ||= frame.hasInlineContent;
  }
  return Object.freeze(featureOrder.filter(feature => features.has(feature)));
}
