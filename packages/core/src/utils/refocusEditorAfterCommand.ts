/**
 * Return focus to the editor on the next frame after a toolbar / menu command,
 * UNLESS the command opened a popover the user is meant to type into (e.g. the
 * math LaTeX field, a link or image input).
 *
 * The post-command refocus exists so that keyboard (Enter / Space) activation of a
 * plain command button returns the caret to the document and keeps the native
 * `::selection` highlight. Mouse clicks already keep editor focus via the buttons'
 * `mousedown.preventDefault()`. But some commands legitimately move focus into a
 * popover input; for those the refocus must NOT steal it back.
 *
 * A focused element counts as a "popover to leave alone" when it sits inside a
 * `[data-dm-editor-ui]` element that is NOT the toolbar, bubble-menu, or floating-
 * menu chrome (those carry the same marker, but their commands should return focus
 * to the document), and is not inside the editor's own contenteditable. This reuses
 * the `data-dm-editor-ui` + `.dm-*` discriminator already used by the bubble menu
 * and selection decoration, so it introduces no new convention.
 *
 * Contract for popovers that rely on this (math edit popover, link/image inputs):
 *  (a) render OUTSIDE the contenteditable and outside `.dm-toolbar` /
 *      `.dm-bubble-menu` / `.dm-floating-menu`;
 *  (b) carry the `data-dm-editor-ui` attribute;
 *  (c) focus themselves SYNCHRONOUSLY while the opening command's transaction is
 *      dispatched, so `document.activeElement` reflects them before this frame runs.
 */
export function refocusEditorAfterCommand(view: { dom: Element; focus: () => void }): void {
  requestAnimationFrame(() => {
    const ae = document.activeElement;
    if (!ae) {
      view.focus();
      return;
    }
    if (
      ae.closest('[data-dm-editor-ui]') &&
      !ae.closest('.dm-toolbar') &&
      !ae.closest('.dm-bubble-menu') &&
      !ae.closest('.dm-floating-menu') &&
      !view.dom.contains(ae)
    ) {
      // Focus moved into a popover input; leave it there.
      return;
    }
    view.focus();
  });
}
