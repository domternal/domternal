import type { EditorView } from '@domternal/pm/view';
import { pasteCleanupKey } from '../operations.js';

/**
 * A conservative eligibility hint, never an HTML validator. False positives merely keep
 * the existing asset path. The HTML parser also treats the legacy image start tag as img.
 */
export function mayContainImageMarkup(html: string): boolean {
  return /<(?:img|image)/i.test(html);
}

/**
 * Reuse a preflight result only where no application HTML transform can change destination
 * behavior or own-copy identity before cleanup, even when it returns the same HTML string.
 * This follows ProseMirror's property order: direct props, direct plugins, state plugins.
 */
export function isFirstHTMLTransformer(view: EditorView): boolean {
  const own = pasteCleanupKey.get(view.state);
  if (own === undefined || typeof own.props.transformPastedHTML !== 'function'
    || view.props.transformPastedHTML !== undefined) return false;
  for (const plugin of [...view.props.plugins ?? [], ...view.state.plugins]) {
    if (plugin === own) return true;
    if (plugin.props.transformPastedHTML !== undefined) return false;
  }
  return false;
}
