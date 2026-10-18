import { Node } from '../Node.js';
import { documentNoteAttributes } from '../utils/documentNotes.js';
import { DocumentNoteNodeView } from './DocumentNoteNodeView.js';

/** Inline, markable reference to an editable document note. */
export const DocumentNoteReference = Node.create({
  name: 'documentNoteReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return documentNoteAttributes('reference'); },
  parseHTML() { return [{ tag: 'sup[data-domternal-note-reference]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['sup', { ...HTMLAttributes, 'data-domternal-note-reference': '' }, typeof node.attrs['label'] === 'string' ? node.attrs['label'] : '?']; },
  addNodeView() { const i18n = this.editor?.i18n; return (node, view, getPos) => new DocumentNoteNodeView(node, view, getPos, i18n, true); },
});
