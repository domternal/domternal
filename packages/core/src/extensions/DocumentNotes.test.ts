import { afterEach, describe, expect, it } from 'vitest';
import { Fragment, Slice, Schema } from '@domternal/pm/model';
import { AllSelection, TextSelection } from '@domternal/pm/state';
import { parseHTML } from 'linkedom';
import { Editor } from '../Editor.js';
import { StarterKit } from './StarterKit.js';
import { DocumentNotes } from './DocumentNotes.js';
import { DocumentNote } from '../nodes/DocumentNote.js';
import { DocumentNoteReference } from '../nodes/DocumentNoteReference.js';
import { getDocumentNotes, getDocumentNoteTypes } from '../utils/documentNotes.js';
import { remapPastedDocumentNotes } from '../utils/documentNotesPlugin.js';
import { generateHTML } from '../helpers/ssr.js';
import { deMessages } from '../locales/de.js';
import type { JSONContent } from '../types/Content.js';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const ref = (noteId: string, kind = 'footnote'): JSONContent => ({ type: 'documentNoteReference', attrs: { noteId, kind } });
const body = (noteId: string, text = 'Note text', kind = 'footnote', label: string | null = null): JSONContent => ({ type: 'documentNote', attrs: { noteId, kind, label }, content: [paragraph(text)] });
const content = (children: JSONContent[]): JSONContent => ({ type: 'doc', content: children });
const line = (...children: JSONContent[]): JSONContent => ({ type: 'paragraph', content: children });
const editors: Editor[] = [];
function make(doc: JSONContent = content([paragraph('Main')])): Editor {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ trailingNode: false }), DocumentNotes], content: doc }); editors.push(editor); return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

describe('opt-in editable document notes', () => {
  it('keeps StarterKit unchanged and requires the actual first-party contract', () => {
    const plain = new Editor({ extensions: [StarterKit] }); editors.push(plain);
    expect(plain.schema.nodes['documentNote']).toBeUndefined(); expect(getDocumentNoteTypes(plain.schema)).toBeUndefined();
    const other = new Schema({ nodes: { doc: { content: 'block+' }, text: { group: 'inline' }, p: { group: 'block', content: 'inline*' }, documentNote: { group: 'block', content: 'block+', attrs: { noteRole: { default: 'body' }, noteId: { default: null } } }, documentNoteReference: { group: 'inline', inline: true, atom: true, attrs: { noteRole: { default: 'reference' }, noteId: { default: null } } } } });
    expect(getDocumentNoteTypes(other)).toBeUndefined();
    const renamed = new Editor({ extensions: [StarterKit, DocumentNote.extend({ name: 'customNote' }), DocumentNoteReference.extend({ name: 'customReference' })] }); editors.push(renamed);
    expect(getDocumentNoteTypes(renamed.schema)?.body.name).toBe('customNote');
  });
  it('inserts reference and editable body in one undoable transaction, retaining reference marks', () => {
    const editor = make(); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3))); editor.commands.toggleBold(); const before = editor.getJSON();
    expect(editor.can().insertDocumentNote({ noteId: 'n' })).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.insertDocumentNote({ noteId: 'n', content: [paragraph('Editable')] })).toBe(true);
    const snapshot = getDocumentNotes(editor.state.doc)!;
    expect(snapshot.references).toHaveLength(1); expect(snapshot.bodies).toHaveLength(1);
    expect(snapshot.references[0]?.body).toBe(snapshot.bodies[0]);
    expect(snapshot.references[0]?.node.marks.map(mark => mark.type.name)).toEqual(['bold']);
    expect(editor.state.selection.$from.parent.textContent).toBe('Editable');
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true); expect(getDocumentNotes(editor.state.doc)?.bodies).toHaveLength(1);
  });
  it('supports repeated references with one body and independent footnote/endnote counters', () => {
    const editor = make(content([line(ref('b'), ref('a'), ref('b'), ref('a', 'endnote')), body('a'), body('b'), body('a', 'End', 'endnote')]));
    const snapshot = getDocumentNotes(editor.state.doc)!;
    expect(snapshot.references.map(reference => reference.displayLabel)).toEqual(['1', '2', '1', '1']);
    expect(snapshot.bodies.map(note => note.displayLabel)).toEqual(['2', '1', '1']);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(editor.commands.insertDocumentNoteReference({ noteId: 'a' })).toBe(true);
    expect(getDocumentNotes(editor.state.doc)?.references.map(reference => reference.displayLabel)).toEqual(['1', '2', '1', '2', '1']);
    expect(editor.view.dom.querySelectorAll('[data-domternal-note-reference]')[1]?.textContent).toBe('2');
  });
  it('keeps custom marks as text and does not consume automatic numbers', () => {
    const editor = make(content([line(ref('custom'), ref('ordinary')), body('custom', 'Custom', 'footnote', '<&*'), body('ordinary')]));
    expect(getDocumentNotes(editor.state.doc)?.references.map(reference => reference.displayLabel)).toEqual(['<&*', '1']);
    const html = editor.getHTML(); const received = document.createElement('div'); received.innerHTML = html;
    expect(received.querySelector('sup')?.textContent).toBe('<&*'); expect(received.querySelector('script')).toBeNull();
  });
  it('updates derived numbering after reorder without editing note attributes', () => {
    const editor = make(content([line(ref('a'), ref('b')), body('a'), body('b')]));
    const attrs = getDocumentNotes(editor.state.doc)!.bodies.map(body => body.node.attrs);
    const first = editor.state.doc.firstChild!; editor.view.dispatch(editor.state.tr.replaceWith(0, first.nodeSize, first.copy(Fragment.fromArray([first.child(1), first.child(0)]))));
    expect(getDocumentNotes(editor.state.doc)?.bodies.map(body => body.displayLabel)).toEqual(['2', '1']);
    expect(getDocumentNotes(editor.state.doc)?.bodies.map(body => body.node.attrs)).toEqual(attrs);
    expect(editor.view.dom.querySelector('[data-note-heading]')?.textContent).toBe('Footnote 2');
  });
  it('keeps unreferenced and duplicate bodies visible rather than guessing or deleting content', () => {
    const editor = make(content([line(ref('duplicate'), ref('missing')), body('duplicate', 'One'), body('duplicate', 'Two'), body('orphan', 'Retain me')]));
    const before = editor.getJSON(); const snapshot = getDocumentNotes(editor.state.doc)!;
    expect(snapshot.references.every(ref => ref.body === undefined)).toBe(true);
    expect(editor.view.dom.textContent).toContain('More than one note uses this identity');
    expect(editor.view.dom.textContent).toContain('This note has no reference');
    expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.focusDocumentNote({ noteId: 'duplicate' })).toBe(false);
  });
  it('never resolves malformed remote note attributes by coercing them to another note kind', () => {
    const editor = make(content([line(ref('n')), body('n')])); const schema = editor.schema;
    const reference = editor.state.doc.firstChild!.firstChild!; const note = editor.state.doc.lastChild!;
    for (const attrs of [{ kind: 'other' }, { noteRole: 'body' }, { label: '\u0000' }]) {
      const invalid = reference.type.create({ ...reference.attrs, ...attrs });
      const doc = schema.topNodeType.create(null, [editor.state.doc.firstChild!.copy(Fragment.from(invalid)), note]);
      expect(getDocumentNotes(doc)?.references[0]?.body).toBeUndefined(); expect(getDocumentNotes(doc)?.references[0]?.displayLabel).toBe('?');
    }
    const invalidBody = note.type.create({ ...note.attrs, kind: 'other' }, note.content);
    const doc = schema.topNodeType.create(null, [editor.state.doc.firstChild!, invalidBody]);
    expect(getDocumentNotes(doc)?.references[0]?.body).toBeUndefined(); expect(getDocumentNotes(doc)?.bodies[0]?.referenced).toBe(false);
  });
  it('deleting a reference leaves editable content and undo restores the relationship', () => {
    const editor = make(content([line(ref('n')), body('n')]));
    editor.view.dispatch(editor.state.tr.delete(1, 2));
    expect(getDocumentNotes(editor.state.doc)?.bodies[0]?.referenced).toBe(false);
    expect(editor.view.dom.textContent).toContain('Note text');
    editor.commands.undo(); expect(getDocumentNotes(editor.state.doc)?.references[0]?.body?.noteId).toBe('n');
  });
  it('navigates with pointer, keyboard and command while preserving content', () => {
    const editor = make(content([line(ref('n')), body('n', 'Editable')])); const before = editor.getJSON();
    const reference = editor.view.dom.querySelector('sup')!;
    reference.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor.state.selection.$from.parent.textContent).toBe('Editable');
    const heading = editor.view.dom.querySelector('strong[data-note-heading]')!;
    heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(editor.state.selection.from).toBe(1);
    expect(editor.commands.focusDocumentNote({ noteId: 'n' })).toBe(true); expect(editor.getJSON()).toEqual(before);
  });
  it('repairs missing-body status when a matching body arrives, without rewriting the reference', () => {
    const editor = make(content([line(ref('n'))]));
    expect(editor.view.dom.querySelector('sup')?.getAttribute('aria-label')).toContain('missing');
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodeFromJSON(body('n'))));
    expect(editor.view.dom.querySelector('sup')?.textContent).toBe('1');
    expect(editor.view.dom.querySelector('sup')?.getAttribute('role')).toBe('link');
  });
  it('repaints note labels in German without changing stored content or editable DOM', () => {
    const editor = make(content([line(ref('n')), body('n')])); const before = editor.getJSON(); const editable = editor.view.dom.querySelector('[data-note-content]');
    editor.i18n.set({ locale: 'de', messages: deMessages });
    expect(editor.view.dom.querySelector('[data-note-heading]')?.textContent).toBe('Fußnote 1');
    expect(editor.view.dom.querySelector('[data-note-content]')).toBe(editable); expect(editor.getJSON()).toEqual(before);
  });
  it.each(['', 'x\n', 'x'.repeat(257)])('refuses invalid identities %j atomically', noteId => {
    const editor = make(); const before = editor.getJSON(); expect(editor.commands.insertDocumentNote({ noteId })).toBe(false); expect(editor.getJSON()).toEqual(before);
  });
  it('refuses nested notes, malformed bodies, oversized JSON and ambiguous targets', () => {
    const editor = make(content([paragraph('Main'), body('n')])); const before = editor.getJSON();
    expect(editor.commands.insertDocumentNote({ noteId: 'n' })).toBe(false);
    expect(editor.commands.insertDocumentNote({ noteId: 'new', content: [body('nested')] })).toBe(false);
    expect(editor.commands.insertDocumentNote({ content: [paragraph('x'.repeat(2_000_001))] })).toBe(false);
    editor.commands.focusDocumentNote({ noteId: 'n' });
    expect(editor.commands.insertDocumentNote()).toBe(false); expect(editor.commands.insertDocumentNoteReference({ noteId: 'n' })).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
  it('fails bounded indexing visibly without mutating a document exceeding the reference budget', () => {
    const editor = make(content([line(...Array.from({ length: 513 }, () => ref('n'))), body('n')])); const before = editor.getJSON();
    expect(getDocumentNotes(editor.state.doc)?.exceeded).toBe(true);
    expect(editor.view.dom.querySelector('sup')?.getAttribute('aria-label')).toContain('document size');
    expect(editor.commands.focusDocumentNote({ noteId: 'n' })).toBe(false); expect(editor.getJSON()).toEqual(before);
  });
  it('serializes semantic HTML with derived labels in the browser and under linkedom', () => {
    const doc = content([line(ref('b'), ref('a')), body('a'), body('b')]); const editor = make(doc);
    for (const html of [editor.getHTML(), generateHTML(doc, [StarterKit, DocumentNotes], { document: parseHTML('<html><body></body></html>').document })]) {
      const wrapper = document.createElement('div'); wrapper.innerHTML = html;
      expect(Array.from(wrapper.querySelectorAll('sup')).map(node => node.textContent)).toEqual(['1', '2']);
      expect(Array.from(wrapper.querySelectorAll('[data-note-heading]')).map(node => node.textContent)).toEqual(['Footnote 2', 'Footnote 1']);
      const loaded = new Editor({ extensions: [StarterKit.configure({ trailingNode: false }), DocumentNotes], content: html }); editors.push(loaded);
      expect(loaded.getJSON()).toEqual(editor.getJSON());
    }
  });
});

describe('document note clipboard identities', () => {
  it('remaps a copied body and all its references, preserving mark and content', () => {
    const editor = make(content([line(ref('n'), ref('n')), body('n')]));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const original = new Slice(editor.state.doc.content, 0, 0); const copied = remapPastedDocumentNotes(original, editor.view);
    const doc = editor.schema.topNodeType.create(null, copied.content); const snapshot = getDocumentNotes(doc)!;
    expect(snapshot.bodies[0]?.noteId).not.toBe('n'); expect(snapshot.references.every(ref => ref.body === snapshot.bodies[0])).toBe(true);
    expect(snapshot.bodies[0]?.node.textContent).toBe('Note text'); expect(editor.state.doc.lastChild?.attrs['noteId']).toBe('n');
  });
  it('keeps a reference-only copy attached to its existing body', () => {
    const editor = make(content([line(ref('n')), body('n')])); const original = new Slice(Fragment.from(editor.state.doc.firstChild!.firstChild), 0, 0);
    expect(remapPastedDocumentNotes(original, editor.view)).toBe(original);
    const dom = editor.view.serializeForClipboard(original).dom;
    expect(dom.querySelector('sup')?.textContent).toBe('1');
  });
  it('preserves identities when replacing the whole document and when moving a drag', () => {
    const editor = make(content([line(ref('n')), body('n')])); const slice = new Slice(editor.state.doc.content, 0, 0);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(remapPastedDocumentNotes(slice, editor.view)).toBe(slice);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    editor.view.dragging = { slice, move: true };
    expect(remapPastedDocumentNotes(slice, editor.view)).toBe(slice); editor.view.dragging = null;
  });
  it('keeps malformed duplicate copied identities visibly ambiguous instead of selecting one body', () => {
    const editor = make(content([line(ref('n')), body('n'), body('n', 'Other')]));
    const slice = new Slice(editor.state.doc.content, 0, 0); expect(remapPastedDocumentNotes(slice, editor.view)).toBe(slice);
  });
});
