/**
 * Return focus to the editor on the next frame after a toolbar / menu command,
 * UNLESS the command moved focus into a popover input the user is meant to type
 * into (currently the math LaTeX field).
 *
 * The refocus exists so keyboard (Enter / Space) activation of a plain command
 * button returns the caret to the document and keeps the native `::selection`
 * highlight. Mouse clicks already keep focus via `mousedown.preventDefault()`.
 *
 * A focused element is treated as such a popover when it sits inside a
 * `[data-dm-editor-ui]` element that is NOT the toolbar / bubble-menu / floating-
 * menu chrome and is not inside the contenteditable. To opt in, a popover must
 * render outside those surfaces, carry `data-dm-editor-ui`, and focus itself
 * synchronously while the opening command dispatches (so `activeElement` reflects
 * it before this frame runs).
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
