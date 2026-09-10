// Clients built from the published 1.2.0 packages installed in this folder. A 1.2.0 client runs
// its own copies of ProseMirror and Yjs, so it exchanges only binary Yjs updates with current ones.
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { Editor, Extension, StarterKit } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { TextSelection } from '@domternal/pm/state';

export const version = '1.2.0';

function extensions(levels) {
  return [StarterKit.configure(levels ? { heading: { levels } } : {}), Image, Table, TableRow, TableCell, TableHeader];
}

/** A 1.2.0 editor bound to its own Yjs document; `levels` configures its headings. */
export function makeClient({ levels, editable = true } = {}) {
  const ydoc = new Y.Doc();
  const Sync = Extension.create({
    name: 'mixedVersionSync',
    addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()],
  });
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [...extensions(levels), Sync],
    editable,
  });
  return { version, ydoc, editor, Y, TextSelection };
}

/** A 1.2.0 editor without collaboration: what a 1.2.0 app loads, edits and saves. */
export function makeEditor({ levels, content } = {}) {
  return new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: extensions(levels),
    content,
  });
}

/** The shared document a 1.2.0 server builds from a saved JSON document, as a binary update. */
export function seedFromJSON(json, { levels } = {}) {
  const editor = makeEditor({ levels });
  const ydoc = prosemirrorJSONToYDoc(editor.schema, json, 'default');
  editor.destroy();
  return Y.encodeStateAsUpdate(ydoc);
}
