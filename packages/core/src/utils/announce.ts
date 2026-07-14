/**
 * Sends a short status message to screen readers through one shared
 * `aria-live="polite"` region inside `.dm-editor` (WCAG 4.1.3 Status
 * Messages). Visual UI already shows the outcome; this is the non-visual
 * channel for actions whose effect a screen reader cannot otherwise
 * perceive (a block moving between columns, a column resize, ...).
 *
 * The region is created lazily on first use, tagged `data-dm-editor-ui`
 * like every other editor-owned floating element, and visually hidden
 * with the standard clip technique (`display: none` would silence it).
 * Polite, not assertive: announcements queue behind the screen reader's
 * typing echo instead of interrupting it.
 */
export function announce(view: { dom: Element }, message: string): void {
  const editorEl = view.dom.closest('.dm-editor');
  if (!(editorEl instanceof HTMLElement)) return;
  let region = editorEl.querySelector<HTMLElement>(':scope > .dm-live-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'dm-live-region';
    region.setAttribute('data-dm-editor-ui', '');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    // Inline (not stylesheet) so the region works without the theme package.
    region.style.cssText
      = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    editorEl.appendChild(region);
  }
  // A repeated identical message would not mutate the DOM, and without a
  // mutation screen readers stay silent; alternate a trailing no-break
  // space so consecutive identical announcements are both spoken.
  region.textContent = region.textContent === message ? `${message}\u00A0` : message;
}
