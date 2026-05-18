/**
 * Block-insert menu shown when the cursor sits at the start of an empty
 * paragraph. Items collected via `addFloatingMenuItems()`. This file owns
 * visibility, positioning, dismiss, and keyboard entry; framework wrappers
 * render the UI.
 */
import { Extension, positionFloatingOnce } from '@domternal/core';
import type { Editor, FloatingMenuItemsOverride } from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { EditorState } from '@domternal/pm/state';

export const floatingMenuPluginKey = new PluginKey('floatingMenu');

/**
 * Default visibility predicate. Shows the menu when the cursor is at the
 * very start of an empty `paragraph` in an editable editor.
 */
function defaultShouldShow({
  editor,
  state,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
}): boolean {
  if (!editor.isEditable) return false;
  const { selection } = state;
  const { $from, empty } = selection;
  if (!empty) return false;
  if ($from.parent.type.name !== 'paragraph') return false;
  if ($from.parent.content.size !== 0) return false;
  if ($from.parentOffset !== 0) return false;
  return true;
}

/**
 * Keyboard shortcuts that move focus from the editor into the menu.
 * Defaults combine the WAI-ARIA recommendation (`Alt-F10`) with a
 * modern slash-command-friendly shortcut (`Mod-/`). Set to an empty
 * array to disable keyboard entry entirely.
 */
export interface FloatingMenuKeymap {
  /** Shortcuts that focus the first menu item when the menu is visible. */
  enterMenu?: string[];
}

const DEFAULT_ENTER_MENU_SHORTCUTS: string[] = ['Alt-F10', 'Mod-/'];

export interface FloatingMenuOptions {
  /**
   * The HTML element that contains the menu. Required when used directly;
   * framework wrappers create this element and pass it in.
   */
  element: HTMLElement | null;

  /**
   * Visibility predicate. Defaults to `defaultShouldShow` (empty paragraph
   * at cursor start).
   */
  shouldShow: (props: {
    editor: Editor;
    view: EditorView;
    state: EditorState;
  }) => boolean;

  /**
   * Pixel offset from the anchor. @default 0
   */
  offset: number;

  /**
   * Items override. Array replaces defaults entirely; function receives
   * the collected defaults and returns a new list (filter/reorder/extend).
   * Consumed by the controller; the plugin itself only reads it when the
   * wrapper does not construct its own controller.
   */
  items?: FloatingMenuItemsOverride;

  /** Keyboard shortcuts for entering the menu via keyboard. */
  keymap?: FloatingMenuKeymap;

  /**
   * When `true`, the menu only appears when EXPLICITLY triggered via
   * `showFloatingMenu(view)` (typically from BlockHandle's `+` button).
   * Pressing `Enter` to create a new empty paragraph no longer auto-shows
   * the menu. Mirrors Notion's behaviour: empty rows display a placeholder
   * hint, the slash command (`/`) is the keyboard trigger, and the menu
   * opens via the gutter `+` button only.
   *
   * @default false (auto-shows on every empty paragraph - backward compat)
   */
  requireExplicitTrigger?: boolean;
}

export interface CreateFloatingMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  element: HTMLElement;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: number;
  keymap?: FloatingMenuKeymap | undefined;
  requireExplicitTrigger?: boolean;
}

/** Internal plugin state - tracks whether `+` button explicitly triggered the menu. */
interface FloatingMenuPluginState {
  triggered: boolean;
}

/**
 * String meta key used by `showFloatingMenu` / `hideFloatingMenu`. We
 * use a STRING (not a PluginKey) so callers don't need a reference to
 * the specific plugin instance - framework wrappers (angular, react,
 * vue) create their own per-instance PluginKey via random suffix to
 * disambiguate menus across editors, but they all read this shared
 * string meta. The plugin's `state.apply` listens for it.
 */
export const FLOATING_MENU_META = 'dm:floatingMenuTrigger';

/**
 * Programmatically show the FloatingMenu - used by BlockHandle's `+`
 * button after it inserts a fresh empty paragraph. When the plugin is
 * configured with `requireExplicitTrigger: true`, this is the ONLY way
 * the menu opens (besides the existing `Mod-/` keyboard shortcut, which
 * is unaffected and continues to focus an already-visible menu).
 */
export function showFloatingMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(FLOATING_MENU_META, 'show'));
}

/** Programmatically hide the FloatingMenu (clears the explicit-trigger flag). */
export function hideFloatingMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(FLOATING_MENU_META, 'hide'));
}

// Cache platform check at module load rather than per-keystroke.
const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Parses a shortcut string (e.g. `Alt-F10`, `Mod-/`, `Shift-Ctrl-Enter`)
 * against a KeyboardEvent. Matches prosemirror-keymap's grammar:
 *
 * - Modifiers can appear in any order and separated by `-`.
 * - `Mod` maps to Cmd on macOS, Ctrl elsewhere.
 * - Aliases: `Cmd` / `m` / `Meta`, `Ctrl` / `c` / `Control`, `Alt` / `a`,
 *   `Shift` / `s`.
 * - Named keys use `KeyEvent.key` values directly (e.g. `F10`, `Enter`,
 *   `ArrowUp`). Letters are case-insensitive; `Shift-` prefix is implied
 *   for shifted-character keys.
 *
 * @returns true if the event matches the shortcut exactly (all and only
 * the listed modifiers, same key).
 */
function matchShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('-');
  let keyPart = parts.pop();
  if (!keyPart) return false;
  // prosemirror-keymap convention: `Space` is an alias for ' ' since the
  // literal character is awkward to type in a shortcut string.
  if (keyPart === 'Space') keyPart = ' ';

  let needCtrl = false;
  let needMeta = false;
  let needAlt = false;
  let needShift = false;

  for (const mod of parts) {
    switch (mod) {
      case 'Mod':
      case 'mod':
        if (IS_MAC) needMeta = true;
        else needCtrl = true;
        break;
      case 'Cmd':
      case 'cmd':
      case 'Meta':
      case 'meta':
      case 'm':
        needMeta = true;
        break;
      case 'Ctrl':
      case 'ctrl':
      case 'Control':
      case 'control':
      case 'c':
        needCtrl = true;
        break;
      case 'Alt':
      case 'alt':
      case 'a':
        needAlt = true;
        break;
      case 'Shift':
      case 'shift':
      case 's':
        needShift = true;
        break;
      default:
        return false;
    }
  }

  if (event.altKey !== needAlt) return false;
  if (event.ctrlKey !== needCtrl) return false;
  if (event.metaKey !== needMeta) return false;
  // For single-character keys, ignore Shift (since Shift is part of the
  // character itself, e.g. Shift+/ produces `?`). For named keys (F10,
  // ArrowUp, Enter, etc.), require Shift match exactly.
  if (keyPart.length > 1 && event.shiftKey !== needShift) return false;

  return event.key === keyPart || event.key.toLowerCase() === keyPart.toLowerCase();
}

/**
 * Creates a standalone FloatingMenu ProseMirror plugin. Framework wrappers
 * call this directly so they can own element creation and rendering.
 */
export function createFloatingMenuPlugin(options: CreateFloatingMenuPluginOptions): Plugin {
  const {
    pluginKey,
    editor,
    element,
    shouldShow = defaultShouldShow,
    offset = 0,
    keymap,
    requireExplicitTrigger = false,
  } = options;

  const enterShortcuts = keymap?.enterMenu ?? DEFAULT_ENTER_MENU_SHORTCUTS;

  // Semantic defaults: `menu` is the right WAI-ARIA role for a transient
  // list of single-action choices (unlike `toolbar` which implies a
  // persistent set of controls).
  if (!element.getAttribute('role')) {
    element.setAttribute('role', 'menu');
    element.setAttribute('aria-label', 'Insert block');
  }

  let cleanupFloating: (() => void) | null = null;
  let editorEl: Element | null = null;
  let clickOutsideHandler: ((e: Event) => void) | null = null;
  let dismissOverlayHandler: (() => void) | null = null;

  const isVisible = (): boolean => element.hasAttribute('data-show');

  const updatePosition = (view: EditorView): void => {
    const { selection } = view.state;
    const { $from } = selection;
    const depth = $from.depth;
    const startPos = $from.start(depth);
    const domNode = view.nodeDOM(startPos - 1);
    if (domNode instanceof HTMLElement) {
      cleanupFloating?.();
      cleanupFloating = positionFloatingOnce(domNode, element, {
        placement: 'bottom-start',
        offsetValue: offset,
      });
      element.setAttribute('data-show', '');
    }
  };

  const hideMenu = (): void => {
    cleanupFloating?.();
    cleanupFloating = null;
    element.removeAttribute('data-show');
  };

  // Focus first menuitem. Wrappers mark each item with
  // `data-floating-menu-item`; falls back to any focusable descendant.
  const focusFirstItem = (): boolean => {
    const first =
      element.querySelector<HTMLElement>('[data-floating-menu-item]:not([aria-disabled="true"])')
      ?? element.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
    if (!first) return false;
    first.focus();
    return true;
  };

  // Hide initially (wrappers may render the element before the plugin runs).
  hideMenu();

  // Compute final visibility: when `requireExplicitTrigger` is on, both
  // the explicit-trigger flag AND the user-supplied shouldShow predicate
  // must be true. Otherwise (default), only shouldShow gates visibility.
  const isVisibleNow = (view: EditorView): boolean => {
    const wantsShow = shouldShow({ editor, view, state: view.state });
    if (!requireExplicitTrigger) return wantsShow;
    const triggered = (pluginKey.getState(view.state) as FloatingMenuPluginState | undefined)?.triggered ?? false;
    return triggered && wantsShow;
  };

  return new Plugin<FloatingMenuPluginState>({
    key: pluginKey,

    state: {
      init: (): FloatingMenuPluginState => ({ triggered: false }),
      apply: (tr, prev): FloatingMenuPluginState => {
        const meta = tr.getMeta(FLOATING_MENU_META) as unknown;
        if (meta === 'show') return { triggered: true };
        if (meta === 'hide') return { triggered: false };
        return prev;
      },
    },

    props: {
      // Keyboard entry from the editor. ProseMirror's handleKeyDown fires
      // before browser defaults, so we can intercept without risking
      // interference with typing. We only act while the menu is visible.
      handleKeyDown(_view, event): boolean {
        if (!isVisible()) return false;
        for (const shortcut of enterShortcuts) {
          if (matchShortcut(event, shortcut)) {
            if (focusFirstItem()) {
              event.preventDefault();
              return true;
            }
            return false;
          }
        }
        return false;
      },
    },

    view: (editorView) => {
      // Move the menu into `.dm-editor` so `position:absolute` resolves
      // against the scrollable editor container - zero jitter on scroll.
      editorEl = editorView.dom.closest('.dm-editor');
      if (editorEl && element.parentElement !== editorEl) {
        editorEl.appendChild(element);
      }

      // Hide the menu AND clear the explicit-trigger flag so a stale
      // `triggered=true` doesn't survive across an unrelated dismissal.
      const dismiss = (): void => {
        hideMenu();
        if (requireExplicitTrigger) {
          const triggered = (pluginKey.getState(editor.view.state) as FloatingMenuPluginState | undefined)?.triggered ?? false;
          if (triggered) {
            editor.view.dispatch(editor.view.state.tr.setMeta(FLOATING_MENU_META, 'hide'));
          }
        }
      };

      const onFocus = (): void => {
        if (isVisibleNow(editor.view)) updatePosition(editor.view);
        else dismiss();
      };

      const onBlur = ({ event }: { event: FocusEvent }): void => {
        // Keep the menu visible if focus moved into it - users can
        // interact with menu items without the menu vanishing.
        // `relatedTarget` is `EventTarget | null`, not `Node` - guard with
        // an `instanceof Node` check so `.contains()` receives a valid arg
        // even for exotic focus targets (e.g. AbortSignal-based targets
        // never raise a focus event in practice, but the cast is unsound).
        const related = event.relatedTarget;
        if (related instanceof Node && element.contains(related)) return;
        dismiss();
      };

      // Click-outside dismissal. Capture phase ensures we fire before
      // other UI (dropdowns, popovers) handles the same click.
      clickOutsideHandler = (e: Event): void => {
        if (!isVisible()) return;
        const target = e.target;
        if (!(target instanceof Node)) return;
        if (element.contains(target)) return;
        if (editor.view.dom.contains(target)) return;
        dismiss();
      };
      document.addEventListener('mousedown', clickOutsideHandler, true);

      // Cooperative dismissal: other overlays (toolbar dropdowns,
      // popovers) broadcast this event to close any open chrome.
      if (editorEl) {
        dismissOverlayHandler = (): void => { dismiss(); };
        editorEl.addEventListener('dm:dismiss-overlays', dismissOverlayHandler);
      }

      editor.on('focus', onFocus);
      editor.on('blur', onBlur);

      return {
        update: (view) => {
          if (isVisibleNow(view)) updatePosition(view);
          else {
            hideMenu();
            // Auto-clear stale `triggered` state when the user navigates
            // away from the empty paragraph (e.g. types a character or
            // moves the cursor) - otherwise the next empty paragraph
            // they enter would silently re-show the menu.
            if (requireExplicitTrigger) {
              const triggered = (pluginKey.getState(view.state) as FloatingMenuPluginState | undefined)?.triggered ?? false;
              if (triggered) {
                view.dispatch(view.state.tr.setMeta(FLOATING_MENU_META, 'hide'));
              }
            }
          }
        },

        destroy: () => {
          hideMenu();
          editor.off('focus', onFocus);
          editor.off('blur', onBlur);
          if (clickOutsideHandler) {
            document.removeEventListener('mousedown', clickOutsideHandler, true);
            clickOutsideHandler = null;
          }
          if (dismissOverlayHandler && editorEl) {
            editorEl.removeEventListener('dm:dismiss-overlays', dismissOverlayHandler);
            dismissOverlayHandler = null;
          }
          editorEl = null;
        },
      };
    },
  });
}

export const FloatingMenu = Extension.create<FloatingMenuOptions>({
  name: 'floatingMenu',

  addOptions() {
    return {
      element: null,
      shouldShow: defaultShouldShow,
      offset: 0,
      requireExplicitTrigger: false,
    };
  },

  addProseMirrorPlugins() {
    const { element, shouldShow, offset, keymap, requireExplicitTrigger } = this.options;
    if (!element) return [];
    const editor = this.editor as Editor | null;
    if (!editor) return [];

    return [
      createFloatingMenuPlugin({
        pluginKey: floatingMenuPluginKey,
        editor,
        element,
        shouldShow,
        offset,
        keymap,
        ...(requireExplicitTrigger !== undefined && { requireExplicitTrigger }),
      }),
    ];
  },
});
