/**
 * Clipboard envelope elements carry document metadata, stylesheets and Office settings,
 * never visible content. Browsers and Office applications add them to routine copies,
 * so their removal is not a loss and produces no diagnostic.
 */
export const envelopeTags: ReadonlySet<string> = new Set(['head', 'title', 'meta', 'link', 'base', 'style', 'xml']);

/**
 * Office namespace wrappers whose children are ordinary document content: paragraph marks
 * (`o:p`), content controls (`w:*`) and smart tags (`st1:*`). Unwrapping them loses nothing.
 * VML drawings (`v:*`) and Office math (`m:*`) are not transparent and stay reported.
 */
export function transparentOfficeWrapper(tagName: string): boolean {
  return /^(?:o|w|st\d{1,2}):[a-z]/.test(tagName);
}
