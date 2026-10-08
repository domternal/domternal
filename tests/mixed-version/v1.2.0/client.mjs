// Clients built from the published 1.2.0 packages installed in this folder. A 1.2.0 client runs
// its own copies of ProseMirror and Yjs, so it exchanges only binary Yjs updates with current ones.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { Editor, Extension, StarterKit } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { TextSelection } from '@domternal/pm/state';

export const version = '1.2.0';
export { Editor };

/**
 * The packages this client must load from its own install, at the published versions. Without
 * that install, Node would resolve them from the workspace above and the "1.2.0" client would be
 * the current build, so every scenario would compare the current version with itself.
 */
const PINNED = {
  '@domternal/core': version, '@domternal/extension-image': version, '@domternal/extension-table': version,
  '@domternal/pm/state': version, 'y-prosemirror': '1.3.7', yjs: '13.6.32',
};

/** Throws unless every pinned package resolves inside this folder's node_modules at its pinned version. */
export function assertPublishedClient() {
  const modules = fileURLToPath(new URL('./node_modules/', import.meta.url));
  for (const [specifier, expected] of Object.entries(PINNED)) {
    const file = fileURLToPath(import.meta.resolve(specifier));
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    const marker = `/node_modules/${name}/`;
    const root = file.slice(0, file.lastIndexOf(marker) + marker.length);
    const found = file.startsWith(modules) && root.length > marker.length
      ? JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version : undefined;
    if (found !== expected) {
      throw new Error(`The ${version} client resolved ${specifier} from ${file}${found === undefined ? '' : ` at version ${found}`}, `
        + `not ${expected} from ${modules}. Install it first: pnpm --dir tests/mixed-version/v1.2.0 install --frozen-lockfile --ignore-workspace, `
        + 'as pnpm test:mixed-version does.');
    }
  }
}
assertPublishedClient();

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
