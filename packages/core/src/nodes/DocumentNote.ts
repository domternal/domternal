import { Node } from '../Node.js';
import { documentNoteAttributes } from '../utils/documentNotes.js';
import { documentNoteMessages } from '../messages/documentNotes.js';
import { localizeMessage } from '../utils/localizeMessage.js';
import { DocumentNoteNodeView } from './DocumentNoteNodeView.js';

/** Editable note content. Install DocumentNotes to include its reference node and commands. */
export const DocumentNote = Node.create({
  name: 'documentNote', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes() { return documentNoteAttributes('body'); },
  parseHTML() { return [{ tag: 'aside[data-domternal-note]', contentElement: '[data-note-content]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const placeholder = '{label}';
    const message = node.attrs['kind'] === 'endnote' ? localizeMessage(undefined, documentNoteMessages.noteEndnote, { label: placeholder }) : localizeMessage(undefined, documentNoteMessages.noteFootnote, { label: placeholder });
    const label = typeof node.attrs['label'] === 'string' ? node.attrs['label'] : '?';
    return ['aside', { ...HTMLAttributes, 'data-domternal-note': '', style: 'border-inline-start:2px solid currentColor;padding-inline-start:1em;margin-block:1em' },
      ['strong', { 'data-note-heading': '', 'data-note-heading-template': message.text, contenteditable: 'false', lang: message.language }, message.text.replaceAll('{label}', label)],
      ['div', { 'data-note-content': '' }, 0]];
  },
  addNodeView() { const i18n = this.editor?.i18n; return (node, view, getPos) => new DocumentNoteNodeView(node, view, getPos, i18n, false); },
});
