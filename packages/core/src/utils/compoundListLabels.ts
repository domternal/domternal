import type { Node as PMNode } from '@domternal/pm/model';
import type { ListLabel, ListLabelAncestor, ListLabelFormat } from '../types/ListLabel.js';
import { formatListLabel, listLabelForKind, parseListLabel } from './listLabel.js';
import { nodeListLabel } from './listLabelAttribute.js';
import { listMarker, parseListMarker } from './listMarker.js';

export const COMPOUND_MARKER_ATTRIBUTE = 'data-dm-compound-marker';
const DEFAULTS: readonly ListLabelFormat[] = ['decimal', 'lower-alpha', 'lower-roman'];
interface Frame { readonly counter: ListLabelAncestor; readonly parent: Frame | null; readonly depth: number }

function formatFor(label: ListLabel | null, marker: unknown, depth: number): ListLabelFormat {
  if (label?.kind === 'counter') return label.format;
  if (label?.kind === 'compound') {
    const own = label.parts.find(part => typeof part !== 'string' && part.ancestor === 0);
    return typeof own === 'object' && own.format !== 'inherit' ? own.format : label.fallback;
  }
  return (listMarker('orderedList', marker) ?? DEFAULTS[depth % DEFAULTS.length] ?? 'decimal') as ListLabelFormat;
}

function startFor(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1;
}

function frameFor(ordered: boolean, ordinal: number, format: ListLabelFormat, parent: Frame | null): Frame {
  return { counter: ordered && Number.isSafeInteger(ordinal) && ordinal <= 2_147_483_647 ? { ordinal, format } : null,
    parent, depth: (parent?.depth ?? 0) + 1 };
}

function ancestors(frame: Frame | null): ListLabelAncestor[] {
  const result: ListLabelAncestor[] = [];
  for (let current = frame; current !== null && result.length < 8; current = current.parent) result.push(current.counter);
  return result;
}

/** Derived presentation follows actual ancestry without writing counters into the document. */
export function visitCompoundListLabels(doc: PMNode, visit: (node: PMNode, position: number, text: string) => void): void {
  const pending: { node: PMNode; position: number; frame: Frame | null }[] = [{ node: doc, position: -1, frame: null }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const { node, position } = current;
    const frame = (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && current.frame !== null
      ? { ...current.frame, depth: 0 } : current.frame;
    const kind = node.type.name;
    const isList = kind === 'orderedList' || kind === 'bulletList' || kind === 'taskList';
    const label = isList ? nodeListLabel(node) : null;
    const format = formatFor(label, node.attrs['listStyleType'], frame?.depth ?? 0);
    const start = startFor(node.attrs['start']);
    const children: typeof pending = [];
    let ordinal = start;
    node.forEach((child, offset) => {
      const childPosition = position + 1 + offset;
      let nextFrame = frame;
      if (isList && (child.type.name === 'listItem' || child.type.name === 'taskItem')) {
        nextFrame = frameFor(kind === 'orderedList', ordinal, format, frame);
        if (label?.kind === 'compound') {
          const text = formatListLabel(label, ordinal, ancestors(frame));
          if (text !== null) visit(child, childPosition, text);
        }
        ordinal++;
      }
      children.push({ node: child, position: childPosition, frame: nextFrame });
    });
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]; if (child !== undefined) pending.push(child);
    }
  }
}

/** Recompute a serialized snapshot. Derived attributes are never trusted as source metadata. */
export function annotateCompoundListLabels(root: Element | DocumentFragment): void {
  if (root.querySelector('ol[data-dm-list-label], [data-dm-compound-marker]') === null) return;
  for (const element of Array.from(root.querySelectorAll('[data-dm-compound-marker]'))) element.removeAttribute(COMPOUND_MARKER_ATTRIBUTE);
  const pending: { element: Element; frame: Frame | null }[] = Array.from(root.children).reverse().map(element => ({ element, frame: null }));
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const { element } = current;
    const tag = element.localName.toLowerCase();
    const frame = (tag === 'td' || tag === 'th') && current.frame !== null ? { ...current.frame, depth: 0 } : current.frame;
    const isList = tag === 'ol' || tag === 'ul';
    const kind = tag === 'ol' ? 'orderedList' : 'bulletList';
    const task = element.getAttribute('data-type') === 'taskList';
    const label = isList && !task ? listLabelForKind(kind, parseListLabel(element.getAttribute('data-dm-list-label'))) : null;
    const format = formatFor(label, isList ? parseListMarker(kind, element) : null, frame?.depth ?? 0);
    const rawStart = element.getAttribute('start');
    let ordinal = startFor(rawStart === null ? 1 : Number.parseInt(rawStart, 10));
    const children: typeof pending = [];
    for (const child of Array.from(element.children)) {
      let nextFrame = frame;
      if (isList && child.localName.toLowerCase() === 'li') {
        nextFrame = frameFor(tag === 'ol' && !task, ordinal, format, frame);
        child.removeAttribute(COMPOUND_MARKER_ATTRIBUTE);
        if (label?.kind === 'compound') {
          const text = formatListLabel(label, ordinal, ancestors(frame));
          if (text !== null) child.setAttribute(COMPOUND_MARKER_ATTRIBUTE, text);
        }
        ordinal++;
      }
      children.push({ element: child, frame: nextFrame });
    }
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]; if (child !== undefined) pending.push(child);
    }
  }
}
