/**
 * NormalizeContentAttributes command: the explicit migration for stored
 * attribute values that loading JSON content would replace, the document
 * counterpart of normalizeContent. It covers list markers this version does
 * not know, heading levels the Heading configuration lacks, including values
 * that are not levels at all, and links whose href the URL policy refuses,
 * which it removes while keeping their text.
 *
 * JSON entry points normalize such values while loading, but a document can
 * still hold one: a collaborative document binds without validation, a
 * collaborator configured with more heading levels writes them, and undo can
 * restore a removed node. Rendering shows the replacement and never rewrites
 * the document, so the value stays until an app runs this command, for
 * example on one writer client after the first sync. Run it only when every
 * client shares this version, heading levels and Link configuration: a client
 * with an older marker vocabulary, fewer heading levels or narrower Link
 * `protocols` would replace values, or remove links, that another client
 * supports. Replacements that are the same for every version and
 * configuration, `unsafe-url` and `unsupported-table-span`, can run earlier on
 * their own through the `codes` option.
 */
import type { EditorView } from '@domternal/pm/view';
import type { CommandSpec } from '../types/Commands.js';
import type { ContentDiagnostic } from '../types/Content.js';

/** Options of the normalizeContentAttributes command. */
export interface NormalizeContentAttributesOptions {
  /**
   * Replace only the values whose diagnostic has one of these codes; all of
   * them when omitted. An empty list replaces nothing.
   */
  codes?: readonly ContentDiagnostic['code'][];
}
import { diagnosticCode, forEachNormalizedAttribute } from '../utils/normalizedAttributes.js';
import { contentReport, recordContentDiagnostics, reportReplacedValue } from '../helpers/normalizeContent.js';

/**
 * The explicit migration of stored values that loading JSON content would
 * replace: list markers this version does not know, heading levels the
 * Heading configuration lacks, table spans the Table extension does not
 * support, and links whose href the Link's URL policy refuses, which are
 * removed with their text kept.
 *
 * Run it only when every client shares this version, heading levels and Link
 * configuration: a client with an older marker vocabulary, fewer heading
 * levels or narrower Link `protocols` would replace values, or remove links,
 * that another client supports. `codes: ['unsafe-url', 'unsupported-table-span']`
 * replaces only what every version and configuration replaces the same way.
 *
 * Replaces every such value in one transaction of attribute-only steps that
 * stays out of the undo history, so undo cannot bring the value back, and
 * reports each one through contentDiagnostic.
 * Returns false in a read-only editor or when nothing needs replacing, so
 * `can().normalizeContentAttributes()` detects a document that needs it.
 * Running it again is a no-op. Run it on its own: in a chain, the whole
 * transaction stays out of the history. With `codes`, only values reported
 * with one of those codes are replaced, and the result says whether any is.
 */
export const normalizeContentAttributes: CommandSpec<[options?: NormalizeContentAttributesOptions]> = (options = {}) => ({ editor, tr, dispatch }) => {
  // A read-only editor still accepts a direct dispatch, so the command checks itself.
  if ((editor.view as EditorView | undefined)?.editable === false) return false;
  const { codes } = options;
  const chosen = (code: ContentDiagnostic['code']): boolean => codes === undefined || codes.includes(code);
  const report = contentReport();
  const { doc } = tr;
  doc.descendants((node, pos) => {
    const pathTo = (): number[] => {
      const $pos = doc.resolve(pos);
      return Array.from({ length: $pos.depth + 1 }, (_, depth) => $pos.index(depth));
    };
    forEachNormalizedAttribute(doc.type.schema, node.type.name, node.attrs, 'unsupported', (attribute, value, normalizer) => {
      const code = diagnosticCode(normalizer, value);
      if (!chosen(code)) return;
      reportReplacedValue(report, code, node.type.name, attribute, pathTo(), value);
      // A dry run must leave the transaction alone: in a chain it is the one run() dispatches.
      if (dispatch) tr.setNodeAttribute(pos, attribute, normalizer.replacement(value));
    });
    for (const mark of node.marks) {
      let current = mark;
      let removed = false;
      forEachNormalizedAttribute(doc.type.schema, mark.type.name, mark.attrs, 'unsupported', (attribute, value, normalizer) => {
        if (removed) return;
        const code = diagnosticCode(normalizer, value);
        if (!chosen(code)) return;
        reportReplacedValue(report, code, node.type.name, attribute, pathTo(), value, mark.type.name);
        removed = normalizer.removesMark === true;
        if (!dispatch) return;
        tr.removeMark(pos, pos + node.nodeSize, current);
        if (removed) return;
        current = mark.type.create({ ...current.attrs, [attribute]: normalizer.replacement(value) });
        tr.addMark(pos, pos + node.nodeSize, current);
      });
    }
  });
  if (report.total === 0) return false;
  if (dispatch) {
    tr.setMeta('addToHistory', false);
    recordContentDiagnostics(tr, 'normalizeContentAttributes', report);
    dispatch(tr);
  }
  return true;
};
