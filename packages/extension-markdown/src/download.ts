import type { Editor } from '@domternal/core';
import type { SerializeMarkdownResult } from './types.js';
import { getMarkdown } from './Markdown.js';

/**
 * Serialize the document and hand it to the browser as a .md download.
 * Returns the serialization result so callers can surface the warnings.
 */
export function downloadMarkdown(
  editor: Editor,
  fileName = 'document.md'
): SerializeMarkdownResult {
  const result = getMarkdown(editor);
  const blob = new Blob([result.markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return result;
}
