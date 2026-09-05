/**
 * NormalizeListMarkers command: the explicit migration for list markers
 * this version does not know.
 *
 * JSON entry points normalize such values while loading, but a document can
 * still hold one: a collaborative document binds without validation, and
 * undo can restore a removed list. Rendering shows the default marker and
 * never rewrites the document, so the value stays until an app runs this
 * command, for example on one writer client after the first sync. Run it
 * only when every client shares this marker vocabulary: an older client
 * would erase markers a newer one supports.
 */
import type { EditorView } from '@domternal/pm/view';
import type { CommandSpec } from '../types/Commands.js';
import { forEachNormalizedAttribute } from '../utils/normalizedAttributes.js';
import { contentReport, recordContentDiagnostics, reportReplacedValue } from '../helpers/normalizeContent.js';

/**
 * Sets every unknown list marker to null in one transaction of
 * attribute-only steps that stays out of the undo history, so undo cannot
 * bring the value back.
 * Returns false in a read-only editor or when nothing is unknown, so
 * `can().normalizeListMarkers()` detects a document that needs it. Running
 * it again is a no-op. Run it on its own: in a chain, the whole transaction
 * stays out of the history.
 */
export const normalizeListMarkers: CommandSpec = () => ({ editor, tr, dispatch }) => {
  // A read-only editor still accepts a direct dispatch, so the command checks itself.
  if ((editor.view as EditorView | undefined)?.editable === false) return false;
  const report = contentReport();
  const { doc } = tr;
  doc.descendants((node, pos) => {
    forEachNormalizedAttribute(doc.type.schema, node.type.name, node.attrs, 'unsupported', (attribute, value, normalizer) => {
      const $pos = doc.resolve(pos);
      const path = Array.from({ length: $pos.depth + 1 }, (_, depth) => $pos.index(depth));
      reportReplacedValue(report, normalizer.code, node.type.name, attribute, path, value);
      // A dry run must leave the transaction alone: in a chain it is the one run() dispatches.
      if (dispatch) tr.setNodeAttribute(pos, attribute, normalizer.replacement(value));
    }, 'unknown-list-marker');
  });
  if (report.total === 0) return false;
  if (dispatch) {
    tr.setMeta('addToHistory', false);
    recordContentDiagnostics(tr, 'normalizeListMarkers', report);
    dispatch(tr);
  }
  return true;
};
