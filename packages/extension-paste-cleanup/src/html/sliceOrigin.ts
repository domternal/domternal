import type { Element, Root, RootContent } from 'hast';
import { cleanSliceContext } from './metadata.js';
import { envelopeTags } from './envelope.js';

/** Trusted HAST data key. Pasted attributes never create HAST data, and node spreads keep it. */
const ANCHOR = 'domternalSliceAnchor';
const copyMarker = /^v1\.([A-Za-z0-9_-]{22})$/;

/**
 * The only `data-pm-slice` in a fragment, placed where ProseMirror reads it without dropping content:
 * on the first root element, and for `-N` table wrappers on a single root element whose first N - 1
 * levels each hold exactly one element. `target` is the element a Domternal copy marks.
 */
export interface SliceAnchor {
  readonly element: Element;
  readonly context: string;
  readonly target: Element | undefined;
}

/** Comments, whitespace and clipboard envelope elements never reach ProseMirror's clipboard parser. */
function ignorable(node: RootContent): boolean {
  if (node.type === 'comment' || node.type === 'doctype') return true;
  if (node.type === 'text') return /^[\t\n\f\r ]*$/.test(node.value);
  return envelopeTags.has(node.tagName);
}

function firstElement(parent: Root | Element): Element | undefined {
  for (const child of parent.children) {
    if (ignorable(child)) continue;
    return child.type === 'element' ? child : undefined;
  }
  return undefined;
}

function onlyElement(parent: Root | Element): Element | undefined {
  let found: Element | undefined;
  for (const child of parent.children) {
    if (ignorable(child)) continue;
    if (child.type !== 'element' || found !== undefined) return undefined;
    found = child;
  }
  return found;
}

function locate(tree: Root, markers: number): SliceAnchor | undefined {
  if (markers !== 1) return undefined;
  const element = firstElement(tree);
  const valid = element === undefined ? undefined : cleanSliceContext(element.properties['dataPmSlice']);
  if (element === undefined || valid === undefined) return undefined;
  const wrappers = Number(/^\d+ \d+ -(\d+) /.exec(valid)?.[1] ?? 0);
  let target: Element | undefined = element;
  if (wrappers > 0) {
    // ProseMirror descends N times through first element children and drops their siblings.
    if (onlyElement(tree) !== element) return undefined;
    let container = element;
    for (let level = 1; level < wrappers; level++) {
      const next = onlyElement(container);
      if (next === undefined) return undefined;
      container = next;
    }
    target = firstElement(container);
  }
  // The innermost wrapper must hold what ProseMirror parses first, and no wrapper holds bare text.
  const context = target === undefined ? (valid.endsWith(' []') ? valid : undefined)
    : cleanSliceContext(element.properties['dataPmSlice'], undefined, target);
  return context === undefined ? undefined : { element, context, target };
}

function count(tree: Root): { markers: number; copies: Element[] } {
  let markers = 0;
  const copies: Element[] = [];
  const pending: (Root | Element)[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.properties['dataPmSlice'] !== undefined) markers++;
      if (child.properties['dataDomternalCopy'] !== undefined && copies.length < 2) copies.push(child);
      pending.push(child);
    }
  }
  return { markers, copies };
}

/**
 * Classify a parsed fragment before any rewriting. A `data-pm-slice` is structural context only.
 * The fragment is a Domternal own copy only when its canonical anchor's target carries the single
 * `data-domternal-copy` marker and the private verifier confirms that marker's nonce.
 */
export function readSliceOrigin(tree: Root, confirm?: (nonce: string) => boolean): { anchor: SliceAnchor | undefined; own: boolean } {
  const { markers, copies } = count(tree);
  const anchor = locate(tree, markers);
  if (anchor === undefined) return { anchor, own: false };
  anchor.element.data ??= { position: {} };
  Reflect.set(anchor.element.data, ANCHOR, anchor.context);
  const carrier = copies.length === 1 ? copies[0] : undefined;
  const nonce = carrier !== undefined && carrier === anchor.target
    ? copyMarker.exec(String(carrier.properties['dataDomternalCopy']))?.[1] : undefined;
  if (nonce === undefined || confirm === undefined) return { anchor, own: false };
  try { return { anchor, own: confirm(nonce) }; } catch { return { anchor, own: false }; }
}

/** External rewriting can move the anchor; keep it only while ProseMirror still reads it canonically. */
export function confirmSliceAnchor(tree: Root, anchor: SliceAnchor): void {
  const current = locate(tree, count(tree).markers);
  const data = current?.element.data;
  if (current !== undefined && data !== undefined && Reflect.get(data, ANCHOR) !== undefined) return;
  if (anchor.element.data !== undefined) Reflect.deleteProperty(anchor.element.data, ANCHOR);
}

/** The context retained on an element that is still the confirmed anchor. */
export function sliceAnchorContext(element: Element): string | undefined {
  const value: unknown = element.data === undefined ? undefined : Reflect.get(element.data, ANCHOR);
  return typeof value === 'string' ? value : undefined;
}
