// Current clients built from the workspace packages, 1.2.0 clients from the isolated project in
// v1.2.0/, and the helpers the scenarios share. Clients of the two versions exchange binary Yjs
// updates only, as they do through a collaboration server.
import './dom.mjs';
import * as Y from 'yjs';
import { ySyncPlugin, yUndoPlugin, undo } from 'y-prosemirror';
import { Editor, Extension, StarterKit } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { TextSelection } from '@domternal/pm/state';
import * as old from './v1.2.0/client.mjs';

export const SIX = [1, 2, 3, 4, 5, 6];
export const oldVersion = old.version;
export const makeOldEditor = old.makeEditor;
export const oldSeedFromJSON = old.seedFromJSON;
const REMOTE = 'mixed-version-remote';

function extensions(levels) {
  return [StarterKit.configure(levels ? { heading: { levels } } : {}), Image, Table, TableRow, TableCell, TableHeader];
}

/** A current editor bound to its own Yjs document, collecting its content diagnostics. */
function makeClient({ levels, editable = true } = {}) {
  const ydoc = new Y.Doc();
  const Sync = Extension.create({
    name: 'mixedVersionSync',
    addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()],
  });
  const diagnostics = [];
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [...extensions(levels), Sync],
    editable,
    onContentDiagnostic: ({ source, diagnostics: found, total }) => { diagnostics.push({ source, diagnostics: found, total }); },
  });
  return { version: 'current', ydoc, editor, Y, TextSelection, diagnostics, undo: () => undo(editor.state) };
}

/** A current editor without collaboration, collecting its content diagnostics. */
export function makeEditor({ levels, content } = {}) {
  const diagnostics = [];
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: extensions(levels),
    content,
    onContentDiagnostic: ({ source, diagnostics: found, total }) => { diagnostics.push({ source, diagnostics: found, total }); },
  });
  return { editor, diagnostics };
}

/**
 * Clients of the given kinds, 'old' for 1.2.0 and 'current', that relay every update they write
 * to each other and start from `seed`. Each counts the updates it writes itself, so a client that
 * rewrites the shared document shows it in its count.
 */
export function network(specs, seed) {
  const clients = [];
  for (const spec of specs) {
    const client = spec.kind === 'old' ? old.makeClient(spec) : makeClient(spec);
    client.kind = spec.kind;
    client.localUpdates = 0;
    client.errors = [];
    client.editor.on('error', ({ error }) => { client.errors.push(String(error?.message ?? error)); });
    if (seed) client.Y.applyUpdate(client.ydoc, seed, REMOTE);
    client.ydoc.on('update', (update, origin) => {
      if (origin === REMOTE) return;
      client.localUpdates++;
      for (const other of clients) {
        if (other !== client) other.Y.applyUpdate(other.ydoc, update, REMOTE);
      }
    });
    clients.push(client);
  }
  return clients;
}

/** Lets the bindings settle. */
export function settle() {
  return new Promise(resolve => { setTimeout(resolve, 30); });
}

/** The count of updates each client wrote, after the bindings settle. */
export async function counts(clients) {
  await settle();
  return clients.map(client => client.localUpdates);
}

export function destroy(clients) {
  for (const client of clients) client.editor.destroy();
}

/** The attributes of every shared element with this name, in document order. */
export function sharedAttributes(client, name) {
  const found = [];
  const walk = node => {
    if (node instanceof client.Y.XmlText) return;
    if (node.nodeName === name) found.push(node.getAttributes());
    node.toArray().forEach(walk);
  };
  client.ydoc.getXmlFragment('default').toArray().forEach(walk);
  return found;
}

/** The formatted runs of every shared text, in document order. */
export function sharedText(client) {
  const found = [];
  const walk = node => {
    if (node instanceof client.Y.XmlText) {
      found.push(...node.toDelta());
      return;
    }
    node.toArray().forEach(walk);
  };
  client.ydoc.getXmlFragment('default').toArray().forEach(walk);
  return found;
}

/** The value of one attribute on every node with this type name, in document order. */
export function nodeValues(editor, name, attribute) {
  const found = [];
  editor.state.doc.descendants(node => { if (node.type.name === name) found.push(node.attrs[attribute]); });
  return found;
}

/** The text of every textblock, in document order: what a reader could lose. */
export function words(editor) {
  const found = [];
  editor.state.doc.descendants(node => {
    if (!node.isTextblock) return true;
    found.push(node.textContent);
    return false;
  });
  return found.join('|');
}

/** Types text after the first occurrence of `needle`. */
export function typeAfter(client, needle, text) {
  const { state } = client.editor;
  let pos;
  state.doc.descendants((node, at) => {
    if (pos === undefined && node.isText && node.text.includes(needle)) pos = at + node.text.indexOf(needle) + needle.length;
  });
  if (pos === undefined) throw new Error(`"${needle}" is not in the document`);
  client.editor.view.dispatch(state.tr.setSelection(client.TextSelection.create(state.doc, pos)).insertText(text));
}

/** Marks the first occurrence of `needle` with a link to `href`, without validation. */
export function linkText(editor, needle, href) {
  const { state } = editor;
  let from;
  state.doc.descendants((node, at) => {
    if (from === undefined && node.isText && node.text.includes(needle)) from = at + node.text.indexOf(needle);
  });
  if (from === undefined) throw new Error(`"${needle}" is not in the document`);
  editor.view.dispatch(state.tr.addMark(from, from + needle.length, state.schema.marks.link.create({ href })));
}

/** A seed changed through the Yjs API, as a client of a later version could change it. */
export function editSeed(seed, change) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, seed);
  change(ydoc.getXmlFragment('default'), Y);
  return Y.encodeStateAsUpdate(ydoc);
}

/** Every diagnostic code a client reported, in order. */
export function codes(reports) {
  return reports.flatMap(report => report.diagnostics.map(diagnostic => diagnostic.code));
}
