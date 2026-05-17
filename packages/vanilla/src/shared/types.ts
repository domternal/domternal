/**
 * Shared option types reused across `@domternal/vanilla` components.
 */

/**
 * Custom content slot. Pass a pre-built DOM tree the wrapper appends into
 * its host instead of rendering the default UI.
 *
 * The DOM you pass stays YOURS. The wrapper does NOT mutate it after
 * construction and does NOT clean up event handlers on it during destroy.
 * Manage its lifecycle yourself.
 *
 * @example
 * ```ts
 * const myUi = document.createElement('div');
 * myUi.innerHTML = `<button data-mark="bold">B</button>`;
 * myUi.querySelector('button')!.addEventListener('click', () => {
 *   editor.chain().focus().toggleBold().run();
 * });
 *
 * const bubble = new DomternalBubbleMenu(host, {
 *   editor,
 *   customContent: myUi,
 * });
 *
 * // Later, when YOU destroy your UI, do listener cleanup yourself:
 * bubble.destroy();   // detaches myUi from host
 * myUi.remove();      // your responsibility
 * ```
 */
export interface CustomContentOption {
  customContent?: HTMLElement;
}
