import { DOCUMENT_NOTE_LIMITS, validDocumentNoteId, validDocumentNoteLabel, type DocumentNotesSnapshot } from './documentNotes.js';
import type { I18nService } from '../i18n/index.js';
import { documentNoteMessages } from '../messages/documentNotes.js';
import { localizeMessage } from './localizeMessage.js';

/**
 * Refresh derived note labels in a serialized fragment that the caller owns, without editing document attributes.
 * Pass a full-document snapshot when rendering only part of a document. A supplied snapshot is authoritative,
 * including unresolved identities and an exceeded index; without one, numbering is derived from the fragment itself.
 */
export function annotateDocumentNotes(root: ParentNode, snapshot?: DocumentNotesSnapshot, i18n?: I18nService): void {
  const all = root.querySelectorAll('[data-domternal-note], [data-domternal-note-reference]');
  if (all.length > DOCUMENT_NOTE_LIMITS.bodies + DOCUMENT_NOTE_LIMITS.references) return;
  const bodies = new Map<string, Element[]>(); const references: Element[] = [];
  const key = (element: Element): string | undefined => {
    const id = element.getAttribute('data-note-id');
    return validDocumentNoteId(id) ? `${element.getAttribute('data-note-kind') === 'endnote' ? 'endnote' : 'footnote'}:${id}` : undefined;
  };
  for (const element of Array.from(all)) {
    if (element.hasAttribute('data-domternal-note')) {
      const id = key(element); if (id) bodies.set(id, [...(bodies.get(id) ?? []), element]);
    } else references.push(element);
  }
  const labels = new Map<string, string>(); const counts = { footnote: 0, endnote: 0 };
  if (snapshot && !snapshot.exceeded) {
    for (const body of snapshot.bodies) if (!body.duplicate) labels.set(`${body.kind}:${body.noteId}`, body.displayLabel);
    for (const ref of snapshot.references) labels.set(`${ref.kind}:${ref.noteId}`, ref.displayLabel);
  }
  for (const ref of references) {
    const id = key(ref); const matches = id ? bodies.get(id) : undefined;
    if (snapshot === undefined && id && !labels.has(id) && matches?.length === 1) {
      const body = matches[0]; const custom = body?.getAttribute('data-note-label');
      const kind = ref.getAttribute('data-note-kind') === 'endnote' ? 'endnote' : 'footnote';
      labels.set(id, typeof custom === 'string' && validDocumentNoteLabel(custom) ? custom : String(++counts[kind]));
    }
    const label = id ? labels.get(id) ?? '?' : '?';
    ref.textContent = label;
    if (i18n) {
      const title = localizeMessage(i18n, ref.getAttribute('data-note-kind') === 'endnote' ? documentNoteMessages.noteEndnote : documentNoteMessages.noteFootnote, { label });
      ref.setAttribute('aria-label', title.text); ref.setAttribute('lang', title.language);
    }
  }
  for (const [id, matches] of bodies) for (const body of matches) {
    const heading = Array.from(body.children).find(child => child.hasAttribute('data-note-heading'));
    if (!heading) continue;
    const template = heading.getAttribute('data-note-heading-template');
    if (!template || template.length > 512) continue;
    const custom = body.getAttribute('data-note-label');
    const label = matches.length === 1 ? labels.get(id) ?? (snapshot === undefined && typeof custom === 'string' && validDocumentNoteLabel(custom) ? custom : '?') : '?';
    if (i18n) {
      const title = localizeMessage(i18n, body.getAttribute('data-note-kind') === 'endnote' ? documentNoteMessages.noteEndnote : documentNoteMessages.noteFootnote, { label });
      heading.textContent = title.text; heading.setAttribute('lang', title.language);
    } else heading.textContent = template.replaceAll('{label}', label);
  }
}
