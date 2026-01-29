/**
 * Gapcursor Extension
 *
 * Allows cursor to be placed in positions that normally wouldn't accept text,
 * like before/after tables or other block nodes.
 */
import { gapCursor } from 'prosemirror-gapcursor';
import { Extension } from '../Extension.js';

export const Gapcursor = Extension.create({
  name: 'gapcursor',

  addProseMirrorPlugins() {
    return [gapCursor()];
  },
});
