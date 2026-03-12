/**
 * Handle ArrowRight/ArrowDown when cursor is at the end of a details summary
 * and the content is collapsed. Sets a GapCursor after the details node.
 */
import { findParentNode, findChildren } from '@domternal/core';
import { GapCursor } from '@domternal/pm/gapcursor';
import type { EditorState } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { isNodeVisible } from './isNodeVisible.js';

interface EditorLike {
  readonly state: EditorState;
  readonly view: EditorView;
  readonly extensionManager?: {
    readonly extensions: readonly { readonly name: string }[];
  };
}

export const setGapCursor = (editor: EditorLike, direction: 'down' | 'right'): boolean => {
  const { state, view } = editor;
  const { schema, selection } = state;
  const { empty, $anchor } = selection;
  const summaryType = schema.nodes['detailsSummary'];
  const detailsType = schema.nodes['details'];
  const contentType = schema.nodes['detailsContent'];

  // Check if GapCursor extension is available
  const hasGapCursor = editor.extensionManager?.extensions.some(
    (ext) => ext.name === 'gapcursor' || ext.name === 'gapCursor',
  );

  if (!empty || $anchor.parent.type !== summaryType || !hasGapCursor) {
    return false;
  }

  // For ArrowRight, only activate at end of summary
  if (direction === 'right' && $anchor.parentOffset !== $anchor.parent.nodeSize - 2) {
    return false;
  }

  const details = findParentNode((node) => node.type === detailsType)(selection);
  if (!details) return false;

  const detailsContent = findChildren(details.node, (node) => node.type === contentType);
  if (!detailsContent.length) return false;

  const firstContent = detailsContent[0];
  if (!firstContent) return false;

  const isOpen = isNodeVisible(details.start + firstContent.pos + 1, editor);
  if (isOpen) return false;

  const $position = state.doc.resolve(details.pos + details.node.nodeSize);
  const found = GapCursor.findFrom($position, 1, false);

  if (!found) return false;

  const { tr } = state;
  // GapCursor.findFrom returns Selection; use its $from for GapCursor constructor
  const gapCursorSelection = new GapCursor(found.$from);

  tr.setSelection(gapCursorSelection);
  tr.scrollIntoView();
  view.dispatch(tr);

  return true;
};
