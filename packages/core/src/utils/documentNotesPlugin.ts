import { Fragment, Slice, type Node as PMNode } from '@domternal/pm/model';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@domternal/pm/view';
import { DOCUMENT_NOTE_LIMITS, getDocumentNotes, getDocumentNoteTypes, validDocumentNoteId } from './documentNotes.js';

export function createDocumentNoteId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return 'note-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
    const random = Math.floor(Math.random() * 16); return (value === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

/** Remap copied bodies together with their references, leaving a reference-only copy linked. */
export function remapPastedDocumentNotes(slice: Slice, view: EditorView): Slice {
  const types = getDocumentNoteTypes(view.state.schema); const snapshot = getDocumentNotes(view.state.doc);
  if (!types || !snapshot || snapshot.exceeded || view.dragging?.move === true) return slice;
  const copied: PMNode[] = []; const order: PMNode[] = []; const pending: { node: PMNode; depth: number }[] = [];
  slice.content.forEach(node => pending.push({ node, depth: 0 }));
  let size = 0;
  while (pending.length > 0) {
    const item = pending.pop(); if (!item) continue;
    size += item.node.text?.length ?? 0;
    if (order.length >= DOCUMENT_NOTE_LIMITS.nodes || item.depth > DOCUMENT_NOTE_LIMITS.depth || size > DOCUMENT_NOTE_LIMITS.text) return slice;
    order.push(item.node); if (item.node.type === types.body) copied.push(item.node);
    if (copied.length > DOCUMENT_NOTE_LIMITS.bodies || item.node.childCount > DOCUMENT_NOTE_LIMITS.nodes - order.length - pending.length) return slice;
    item.node.forEach(node => pending.push({ node, depth: item.depth + 1 }));
  }
  const key = (node: PMNode): string => `${String(node.attrs['kind'])}:${String(node.attrs['noteId'])}`;
  const existing = new Set(snapshot.bodies.filter(body => view.dragging !== null || !view.state.selection.ranges.some(range => body.pos >= range.$from.pos && body.pos + body.node.nodeSize <= range.$to.pos)).map(body => `${body.kind}:${body.noteId}`));
  const counts = new Map<string, number>();
  for (const body of copied) counts.set(key(body), (counts.get(key(body)) ?? 0) + 1);
  const replacement = new Map<string, string>();
  for (const body of copied) {
    const id = key(body);
    if (validDocumentNoteId(body.attrs['noteId']) && counts.get(id) === 1 && existing.has(id)) {
      let next = createDocumentNoteId(); let attempt = 0;
      while (existing.has(`${String(body.attrs['kind'])}:${next}`) || counts.has(`${String(body.attrs['kind'])}:${next}`)) { if (++attempt >= 8) return slice; next = createDocumentNoteId(); }
      replacement.set(id, next); existing.add(`${String(body.attrs['kind'])}:${next}`);
    }
  }
  if (replacement.size === 0) return slice;
  const rebuilt = new Map<PMNode, PMNode>();
  for (let index = order.length - 1; index >= 0; index--) {
    const node = order[index]; if (!node) continue;
    const children: PMNode[] = []; const changed = { found: false };
    node.forEach(child => { const result = rebuilt.get(child) ?? child; children.push(result); changed.found ||= child !== result; });
    const id = node.type === types.body || node.type === types.reference ? replacement.get(key(node)) : undefined;
    rebuilt.set(node, id ? node.type.create({ ...node.attrs, noteId: id }, Fragment.fromArray(children), node.marks) : changed.found ? node.copy(Fragment.fromArray(children)) : node);
  }
  const children: PMNode[] = []; slice.content.forEach(node => children.push(rebuilt.get(node) ?? node));
  return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd);
}

export function documentNotesPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('documentNotes'),
    props: {
      transformPasted: (slice, view) => remapPastedDocumentNotes(slice, view),
      decorations(state) {
        const snapshot = getDocumentNotes(state.doc); if (!snapshot) return null;
        const decorations = [
          ...snapshot.references.map(ref => Decoration.node(ref.pos, ref.pos + ref.node.nodeSize, { 'data-note-state': `${ref.displayLabel}:${String(ref.body?.pos ?? 'missing')}:${String(snapshot.exceeded)}` })),
          ...snapshot.bodies.map(body => Decoration.node(body.pos, body.pos + body.node.nodeSize, { 'data-note-state': `${body.displayLabel}:${String(body.referenced)}:${String(body.duplicate)}:${String(snapshot.exceeded)}:${String(snapshot.references.find(ref => ref.body === body)?.pos)}` })),
        ];
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
