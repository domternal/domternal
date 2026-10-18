import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import type { AttributeSpec } from '../types/AttributeSpec.js';

export type DocumentNoteKind = 'footnote' | 'endnote';
export interface DocumentNoteIdentity { readonly noteId: string; readonly kind: DocumentNoteKind; readonly label?: string | null }
export interface DocumentNoteBodyRecord extends DocumentNoteIdentity {
  readonly node: PMNode; readonly pos: number; readonly referenced: boolean; readonly duplicate: boolean; readonly displayLabel: string;
}
export interface DocumentNoteReferenceRecord extends DocumentNoteIdentity {
  readonly node: PMNode; readonly pos: number; readonly body?: DocumentNoteBodyRecord; readonly displayLabel: string;
}
export interface DocumentNotesSnapshot {
  readonly bodies: readonly DocumentNoteBodyRecord[];
  readonly references: readonly DocumentNoteReferenceRecord[];
  readonly exceeded: boolean;
}
export interface DocumentNoteTypes { readonly body: NodeType; readonly reference: NodeType }
export const DOCUMENT_NOTE_LIMITS = Object.freeze({ nodes: 100_000, references: 512, bodies: 512, depth: 64, text: 2_000_000 });
const CONTROL = /[\p{Cc}\p{Cs}]/u;
export function validDocumentNoteId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !CONTROL.test(value);
}
export function validDocumentNoteLabel(value: unknown): value is string | null {
  return value === null || typeof value === 'string' && value.trim().length > 0 && value.length <= 64 && !CONTROL.test(value);
}
function validateId(value: unknown): void { if (value !== null && !validDocumentNoteId(value)) throw new RangeError('Invalid document note identity'); }
function validateKind(value: unknown): void { if (value !== 'footnote' && value !== 'endnote') throw new RangeError('Invalid document note kind'); }
function validateLabel(value: unknown): void { if (!validDocumentNoteLabel(value)) throw new RangeError('Invalid document note label'); }
const identityValidators = new WeakSet();

export function documentNoteAttributes(role: 'body' | 'reference'): Record<string, AttributeSpec> {
  const contract = (value: unknown): void => { validateId(value); };
  identityValidators.add(contract);
  return {
    noteId: { default: null, validate: contract, parseHTML: element => {
      const value = element.getAttribute('data-note-id'); return validDocumentNoteId(value) ? value : null;
    }, renderHTML: attrs => validDocumentNoteId(attrs['noteId']) ? { 'data-note-id': attrs['noteId'] } : {} },
    kind: { default: 'footnote', validate: validateKind, parseHTML: element => element.getAttribute('data-note-kind') === 'endnote' ? 'endnote' : 'footnote',
      renderHTML: attrs => ({ 'data-note-kind': attrs['kind'] === 'endnote' ? 'endnote' : 'footnote' }) },
    label: { default: null, validate: validateLabel, parseHTML: element => {
      const value = element.getAttribute('data-note-label'); return validDocumentNoteLabel(value) ? value : null;
    }, renderHTML: attrs => typeof attrs['label'] === 'string' && validDocumentNoteLabel(attrs['label']) ? { 'data-note-label': attrs['label'] } : {} },
    noteRole: { default: role, validate: value => { if (value !== role) throw new RangeError('Invalid document note role'); }, rendered: false },
  };
}

/** Identify only first-party note attributes, including renamed nodes that retain the contract. */
export function getDocumentNoteTypes(schema: Schema): DocumentNoteTypes | undefined {
  let body: NodeType | undefined; let reference: NodeType | undefined;
  for (const type of Object.values(schema.nodes)) {
    const attrs = type.spec.attrs; const validator: unknown = attrs?.['noteId']?.validate;
    if (typeof validator !== 'function' || !identityValidators.has(validator)) continue;
    if (type.isBlock && attrs?.['noteRole']?.default === 'body') { if (body) return undefined; body = type; }
    if (type.isInline && type.isAtom && attrs?.['noteRole']?.default === 'reference') { if (reference) return undefined; reference = type; }
  }
  return body && reference ? { body, reference } : undefined;
}

const snapshots = new WeakMap<PMNode, DocumentNotesSnapshot>();
/** A bounded, derived view of references and editable bodies. Reading never rewrites the document. */
export function getDocumentNotes(doc: PMNode): DocumentNotesSnapshot | undefined {
  const types = getDocumentNoteTypes(doc.type.schema); if (!types) return undefined;
  const cached = snapshots.get(doc); if (cached) return cached;
  const bodies: { node: PMNode; pos: number }[] = []; const references: { node: PMNode; pos: number }[] = [];
  const pending = [{ node: doc, pos: -1, depth: 0 }]; let nodes = 0; let text = 0; let exceeded = false;
  while (pending.length > 0) {
    const item = pending.pop(); if (!item) continue;
    nodes += 1; text += item.node.text?.length ?? 0;
    if (nodes > DOCUMENT_NOTE_LIMITS.nodes || text > DOCUMENT_NOTE_LIMITS.text || item.depth > DOCUMENT_NOTE_LIMITS.depth) { exceeded = true; break; }
    if (item.node.type === types.body) bodies.push(item);
    if (item.node.type === types.reference) references.push(item);
    if (bodies.length > DOCUMENT_NOTE_LIMITS.bodies || references.length > DOCUMENT_NOTE_LIMITS.references) { exceeded = true; break; }
    if (item.node.childCount > DOCUMENT_NOTE_LIMITS.nodes - nodes - pending.length) { exceeded = true; break; }
    let offset = item.node.content.size;
    for (let index = item.node.childCount - 1; index >= 0; index--) { const child = item.node.child(index); offset -= child.nodeSize; pending.push({ node: child, pos: item.pos + 1 + offset, depth: item.depth + 1 }); }
  }
  const valid = (node: PMNode): boolean => (node.attrs['kind'] === 'footnote' || node.attrs['kind'] === 'endnote')
    && validDocumentNoteId(node.attrs['noteId']) && validDocumentNoteLabel(node.attrs['label'])
    && node.attrs['noteRole'] === (node.type === types.body ? 'body' : 'reference');
  const key = (node: PMNode): string => `${node.attrs['kind'] === 'endnote' ? 'endnote' : 'footnote'}:${String(node.attrs['noteId'])}`;
  const counts = new Map<string, number>(); const used = new Set(references.filter(ref => valid(ref.node)).map(ref => key(ref.node)));
  for (const body of bodies) counts.set(key(body.node), (counts.get(key(body.node)) ?? 0) + 1);
  const labels = new Map<string, string>(); const ordinals = { footnote: 0, endnote: 0 };
  for (const ref of references) {
    if (!valid(ref.node)) continue;
    const id = key(ref.node); if (labels.has(id)) continue;
    const body = bodies.find(body => key(body.node) === id);
    const kind = ref.node.attrs['kind'] === 'endnote' ? 'endnote' : 'footnote';
    if (!body || counts.get(id) !== 1 || !valid(ref.node) || !valid(body.node) || exceeded) { labels.set(id, '?'); continue; }
    const label: unknown = body.node.attrs['label'];
    labels.set(id, typeof label === 'string' && validDocumentNoteLabel(label) ? label : String(++ordinals[kind]));
  }
  const bodyRecords: DocumentNoteBodyRecord[] = bodies.map(({ node, pos }) => Object.freeze({ node, pos,
    noteId: validDocumentNoteId(node.attrs['noteId']) ? node.attrs['noteId'] : '', kind: node.attrs['kind'] === 'endnote' ? 'endnote' as const : 'footnote' as const,
    label: validDocumentNoteLabel(node.attrs['label']) ? node.attrs['label'] : null, referenced: valid(node) && used.has(key(node)), duplicate: (counts.get(key(node)) ?? 0) !== 1,
    displayLabel: labels.get(key(node)) ?? (typeof node.attrs['label'] === 'string' && validDocumentNoteLabel(node.attrs['label']) ? node.attrs['label'] : '?'),
  }));
  const byKey = new Map(bodyRecords.filter(body => !body.duplicate && valid(body.node)).map(body => [`${body.kind}:${body.noteId}`, body]));
  const referenceRecords: DocumentNoteReferenceRecord[] = references.map(({ node, pos }) => {
    const body = exceeded || !valid(node) ? undefined : byKey.get(key(node));
    return Object.freeze({ node, pos, noteId: validDocumentNoteId(node.attrs['noteId']) ? node.attrs['noteId'] : '',
      kind: node.attrs['kind'] === 'endnote' ? 'endnote' as const : 'footnote' as const, label: validDocumentNoteLabel(node.attrs['label']) ? node.attrs['label'] : null,
      ...(body ? { body } : {}), displayLabel: valid(node) ? labels.get(key(node)) ?? '?' : '?' });
  });
  const snapshot = Object.freeze({ bodies: Object.freeze(bodyRecords), references: Object.freeze(referenceRecords), exceeded });
  snapshots.set(doc, snapshot); return snapshot;
}
