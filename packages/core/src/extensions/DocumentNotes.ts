import { Fragment, type Node as PMNode } from '@domternal/pm/model';
import { Selection } from '@domternal/pm/state';
import { Extension } from '../Extension.js';
import { DocumentNote } from '../nodes/DocumentNote.js';
import { DocumentNoteReference } from '../nodes/DocumentNoteReference.js';
import type { CommandSpec } from '../types/Commands.js';
import type { JSONContent } from '../types/Content.js';
import { createDocument } from '../helpers/createDocument.js';
import { DOCUMENT_NOTE_LIMITS, getDocumentNotes, getDocumentNoteTypes, validDocumentNoteId, validDocumentNoteLabel, type DocumentNoteKind } from '../utils/documentNotes.js';
import { createDocumentNoteId, documentNotesPlugin } from '../utils/documentNotesPlugin.js';

export interface InsertDocumentNoteOptions {
  readonly noteId?: string;
  readonly kind?: DocumentNoteKind;
  readonly label?: string | null;
  readonly content?: readonly JSONContent[];
}
export interface DocumentNoteTarget { readonly noteId: string; readonly kind?: DocumentNoteKind }

declare module '@domternal/core' {
  interface RawCommands {
    insertDocumentNote: CommandSpec<[options?: InsertDocumentNoteOptions]>;
    insertDocumentNoteReference: CommandSpec<[target: DocumentNoteTarget]>;
    focusDocumentNote: CommandSpec<[target: DocumentNoteTarget]>;
  }
}

function boundedContent(value: unknown): boolean {
  const stack = [{ value, depth: 0 }]; const seen = new WeakSet(); let count = 0; let text = 0;
  while (stack.length > 0) {
    const item = stack.pop(); if (!item) continue;
    if (++count > DOCUMENT_NOTE_LIMITS.nodes || item.depth > DOCUMENT_NOTE_LIMITS.depth * 2) return false;
    if (typeof item.value === 'string') { text += item.value.length; if (text > DOCUMENT_NOTE_LIMITS.text) return false; }
    else if (item.value && typeof item.value === 'object') {
      if (seen.has(item.value)) return false; seen.add(item.value);
      const children = Object.values(item.value);
      if (children.length > DOCUMENT_NOTE_LIMITS.nodes - count - stack.length) return false;
      for (const child of children) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}
function kindOf(value: unknown): DocumentNoteKind | undefined { return value === undefined ? 'footnote' : value === 'footnote' || value === 'endnote' ? value : undefined; }

/** Opt-in editable document notes. Bodies and references stay in the shared ProseMirror document. */
export const DocumentNotes = Extension.create({
  name: 'documentNotes',
  addExtensions() { return [DocumentNote, DocumentNoteReference]; },
  addProseMirrorPlugins() { return [documentNotesPlugin()]; },
  addCommands() {
    return {
      insertDocumentNote: (options: InsertDocumentNoteOptions = {}) => ({ tr, dispatch }) => {
        const types = getDocumentNoteTypes(tr.doc.type.schema); const snapshot = getDocumentNotes(tr.doc);
        const kind = kindOf(options.kind); const label = options.label ?? null;
        const noteId = options.noteId ?? createDocumentNoteId();
        if (!types || !snapshot || snapshot.exceeded || !kind || !validDocumentNoteId(noteId) || !validDocumentNoteLabel(label)) return false;
        if (snapshot.bodies.length >= DOCUMENT_NOTE_LIMITS.bodies || snapshot.references.length >= DOCUMENT_NOTE_LIMITS.references || snapshot.bodies.some(body => body.noteId === noteId && body.kind === kind)) return false;
        if (!tr.selection.$from.parent.inlineContent || !tr.selection.$from.sameParent(tr.selection.$to)) return false;
        for (let depth = 1; depth <= tr.selection.$from.depth; depth++) if (tr.selection.$from.node(depth).type === types.body) return false;
        let body: PMNode | null;
        try {
          const supplied: unknown = options.content;
          if (supplied !== undefined && (!Array.isArray(supplied) || !boundedContent(supplied))) return false;
          const content = options.content === undefined ? undefined : createDocument({ type: tr.doc.type.name, content: [...options.content] }, tr.doc.type.schema).content;
          body = types.body.createAndFill({ noteId, kind, label }, content);
          if (!body || !types.body.validContent(body.content)) return false;
          const nested = { found: false }; body.descendants(node => { if (node.type === types.body || node.type === types.reference) nested.found = true; });
          if (nested.found) return false;
        } catch { return false; }
        if (!tr.doc.canReplace(tr.doc.childCount, tr.doc.childCount, Fragment.from(body))) return false;
        const reference = types.reference.create({ noteId, kind, label }, null, tr.storedMarks ?? tr.selection.$from.marks());
        const parent = tr.selection.$from.parent;
        if (!parent.type.allowsMarks(reference.marks) || !parent.canReplaceWith(tr.selection.$from.index(), tr.selection.$to.index(), types.reference)) return false;
        if (dispatch) {
          tr.replaceSelectionWith(reference, false);
          const position = tr.doc.content.size; tr.insert(position, body);
          tr.setSelection(Selection.near(tr.doc.resolve(position + 1))).scrollIntoView(); dispatch(tr);
        }
        return true;
      },
      insertDocumentNoteReference: (target: DocumentNoteTarget) => ({ tr, dispatch }) => {
        const types = getDocumentNoteTypes(tr.doc.type.schema); const snapshot = getDocumentNotes(tr.doc); const kind = kindOf(target.kind);
        if (!types || !snapshot || snapshot.exceeded || !kind || !validDocumentNoteId(target.noteId) || snapshot.references.length >= DOCUMENT_NOTE_LIMITS.references) return false;
        const body = snapshot.bodies.find(body => body.noteId === target.noteId && body.kind === kind && !body.duplicate);
        if (!body || !tr.selection.$from.parent.inlineContent || !tr.selection.$from.sameParent(tr.selection.$to)) return false;
        for (let depth = 1; depth <= tr.selection.$from.depth; depth++) if (tr.selection.$from.node(depth).type === types.body) return false;
        const reference = types.reference.create({ noteId: body.noteId, kind: body.kind, label: body.label ?? null }, null, tr.storedMarks ?? tr.selection.$from.marks());
        if (!tr.selection.$from.parent.type.allowsMarks(reference.marks) || !tr.selection.$from.parent.canReplaceWith(tr.selection.$from.index(), tr.selection.$to.index(), types.reference)) return false;
        if (dispatch) { tr.replaceSelectionWith(reference, false).scrollIntoView(); dispatch(tr); }
        return true;
      },
      focusDocumentNote: (target: DocumentNoteTarget) => ({ tr, dispatch }) => {
        const snapshot = getDocumentNotes(tr.doc); const kind = kindOf(target.kind);
        if (!snapshot || snapshot.exceeded || !kind || !validDocumentNoteId(target.noteId)) return false;
        const body = snapshot.bodies.find(body => body.noteId === target.noteId && body.kind === kind && !body.duplicate);
        if (!body) return false;
        if (dispatch) { tr.setSelection(Selection.near(tr.doc.resolve(body.pos + 1))).scrollIntoView(); dispatch(tr); }
        return true;
      },
    };
  },
});
