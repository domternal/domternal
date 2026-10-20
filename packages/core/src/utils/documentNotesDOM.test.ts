// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DOMSerializer } from '@domternal/pm/model';
import { Editor } from '../Editor.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { DocumentNotes } from '../extensions/DocumentNotes.js';
import type { JSONContent } from '../types/Content.js';
import { getDocumentNotes } from './documentNotes.js';
import { annotateDocumentNotes } from './documentNotesDOM.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
const ref = (noteId: string, kind = 'footnote'): JSONContent => ({ type: 'documentNoteReference', attrs: { noteId, kind } });
const note = (noteId: string, kind = 'footnote', label: string | null = null): JSONContent => ({
  type: 'documentNote', attrs: { noteId, kind, label }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] }],
});
const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
function make(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: [StarterKit, DocumentNotes], content: { type: 'doc', content } });
  editors.push(editor); return editor;
}
function serialized(editor: Editor): HTMLElement {
  const root = document.createElement('div');
  root.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content)); return root;
}
const references = (root: ParentNode): (string | null)[] => Array.from(root.querySelectorAll('[data-domternal-note-reference]')).map(element => element.textContent);
const headings = (root: ParentNode): (string | null)[] => Array.from(root.querySelectorAll('[data-note-heading]')).map(element => element.textContent);

describe('presentation-only document note annotation', () => {
  it('derives complete-fragment labels with independent counters and safe custom marks', () => {
    const editor = make([line(ref('b'), ref('a'), ref('custom'), ref('a', 'endnote'), ref('b')),
      note('a'), note('b'), note('custom', 'footnote', '<&*'), note('a', 'endnote')]);
    const before = editor.getJSON(); const root = serialized(editor); annotateDocumentNotes(root);
    expect(references(root)).toEqual(['1', '2', '<&*', '1', '1']);
    expect(headings(root)).toEqual(['Footnote 2', 'Footnote 1', 'Footnote <&*', 'Endnote 1']);
    expect(root.querySelector('script')).toBeNull(); expect(editor.getJSON()).toEqual(before);
    expect(root.querySelector('[data-note-id="a"]')?.getAttribute('data-note-label')).toBeNull();
  });

  it('uses full-document numbering when a fragment contains only a later reference and body', () => {
    const editor = make([line(ref('a'), ref('b')), note('a'), note('b')]); const root = serialized(editor);
    root.querySelector('[data-domternal-note-reference]')?.remove();
    root.querySelector('[data-domternal-note]')?.remove();
    annotateDocumentNotes(root, getDocumentNotes(editor.state.doc));
    expect(references(root)).toEqual(['2']); expect(headings(root)).toEqual(['Footnote 2']);
  });

  it('does not resolve an ambiguous full-document identity from a locally unique fragment', () => {
    const editor = make([line(ref('duplicate')), note('duplicate'), note('duplicate')]); const root = serialized(editor);
    root.querySelector('[data-domternal-note]')?.remove();
    annotateDocumentNotes(root, getDocumentNotes(editor.state.doc));
    expect(references(root)).toEqual(['?']); expect(headings(root)).toEqual(['Footnote ?']);
  });

  it('does not invent labels absent from an authoritative snapshot', () => {
    const editor = make([line(ref('custom')), note('custom', 'footnote', '*')]); const root = serialized(editor);
    annotateDocumentNotes(root, { bodies: [], references: [], exceeded: false });
    expect(references(root)).toEqual(['?']); expect(headings(root)).toEqual(['Footnote ?']);
  });

  it('does not fall back to fragment numbering when the full-document note index exceeded its bounds', () => {
    const editor = make([line(ref('custom')), note('custom', 'footnote', '*')]); const root = serialized(editor);
    const snapshot = getDocumentNotes(editor.state.doc)!;
    annotateDocumentNotes(root, { ...snapshot, exceeded: true });
    expect(references(root)).toEqual(['?']); expect(headings(root)).toEqual(['Footnote ?']);
  });

  it('localizes headings and accessible reference labels in place without changing authored metadata', () => {
    const editor = make([line(ref('a'), ref('b', 'endnote')), note('a'), note('b', 'endnote', '<&*')]);
    const root = serialized(editor); const before = editor.getJSON(); const snapshot = getDocumentNotes(editor.state.doc);
    editor.i18n.set({ locale: 'de', messages: {
      'core.documentNotes.footnote': ({ label }) => `Fußnote ${label}`,
      'core.documentNotes.endnote': ({ label }) => `Endnote ${label}`,
    } });
    annotateDocumentNotes(root, snapshot, editor.i18n);
    expect(headings(root)).toEqual(['Fußnote 1', 'Endnote <&*']);
    expect(root.querySelector('sup')?.getAttribute('aria-label')).toBe('Fußnote 1');
    expect(root.querySelector('sup')?.getAttribute('lang')).toBe('de');
    const heading = root.querySelector('[data-note-heading]'); expect(heading?.getAttribute('lang')).toBe('de');
    editor.i18n.set({ locale: 'en' }); annotateDocumentNotes(root, snapshot, editor.i18n);
    expect(root.querySelector('[data-note-heading]')).toBe(heading); expect(headings(root)).toEqual(['Footnote 1', 'Endnote <&*']);
    expect(heading?.getAttribute('lang')).toBe('en'); expect(editor.getJSON()).toEqual(before);
  });
});
