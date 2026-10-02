/**
 * Whether normalization removed text of the content's own that it does not paste, Word's hidden text. The editor
 * passes it to Core's paste file rule: the content had text, so the clipboard's image files, an application's
 * picture of the selection that can show that text, are not the paste. It travels beside a result, never as a
 * property of the public result.
 */
const removed = new WeakSet();

/** Records that a normalization result removed text it does not paste. */
export function recordRemovedText(result: object): void {
  removed.add(result);
}

/** Whether a normalization result removed text it does not paste. */
export function removedText(result: object | undefined): boolean {
  return result !== undefined && removed.has(result);
}
