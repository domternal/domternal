/**
 * Shared option types reused across @domternal/vanilla components.
 */

/**
 * Custom content slot - pass a pre-built DOM tree the wrapper appends
 * into its host instead of rendering the default UI.
 *
 * The DOM you pass stays YOURS. The wrapper does NOT mutate it after
 * construction and does NOT clean up event handlers on it during destroy.
 * Manage its lifecycle yourself.
 */
export interface CustomContentOption {
  customContent?: HTMLElement;
}
