/**
 * Plugin machinery for the block-insert floating menu: visibility,
 * positioning, dismiss, and keyboard entry. Framework wrappers call
 * `createFloatingMenuPlugin` directly and render the UI themselves; the
 * `FloatingMenu` extension in `@domternal/extension-block-controls` wraps the
 * same factory for extension-based setups. Lives in core so the wrappers
 * need no dependency on the block-menu package.
 */
import { positionFloatingOnce } from './utils/positionFloating.js';
import type { Editor } from './Editor.js';
import type { FloatingMenuItemsOverride } from './types/FloatingMenu.js';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { EditorState } from '@domternal/pm/state';

export const floatingMenuPluginKey = new PluginKey('floatingMenu');

/** Default visibility: cursor at the start of an empty `paragraph` in an editable editor. */
export function defaultFloatingMenuShouldShow({
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
 * Keyboard shortcuts to move focus from the editor into the menu. Defaults
 * pair the WAI-ARIA `Alt-F10` with `Mod-/`; empty array disables keyboard entry.
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
   * Visibility predicate. Defaults to `defaultFloatingMenuShouldShow` (empty
   * paragraph at cursor start).
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
   * Items override. Array replaces defaults entirely; function receives the
   * collected defaults and returns a new list. Consumed by the controller;
   * the plugin reads it only when the wrapper doesn't build its own controller.
   */
  items?: FloatingMenuItemsOverride;

  /** Keyboard shortcuts for entering the menu via keyboard. */
  keymap?: FloatingMenuKeymap;

  /**
   * When `true`, the menu only opens via `showFloatingMenu(view)` (the gutter
   * `+` button); pressing Enter into an empty paragraph no longer auto-shows
   * it. Mirrors Notion: empty rows show a placeholder, `/` is the keyboard trigger.
   *
   * @default false (auto-shows on every empty paragraph, backward compat)
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

/** Internal state: whether the `+` button explicitly triggered the menu. */
interface FloatingMenuPluginState {
  triggered: boolean;
}

/**
 * Meta key for `showFloatingMenu` / `hideFloatingMenu`. A STRING (not a
 * PluginKey) so callers don't need a plugin-instance reference: framework
 * wrappers create per-instance PluginKeys but all read this shared meta.
 */
export const FLOATING_MENU_META = 'dm:floatingMenuTrigger';

/**
 * Programmatically show the FloatingMenu, used by BlockHandle's `+` button
 * after inserting a fresh empty paragraph. With `requireExplicitTrigger: true`
 * this is the only way the menu opens (the `Mod-/` shortcut still focuses an
 * already-visible menu).
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
 * Matches a shortcut string (e.g. `Alt-F10`, `Mod-/`) against a KeyboardEvent,
 * following prosemirror-keymap's grammar:
 * - Modifiers in any order, `-`-separated; `Mod` = Cmd on macOS else Ctrl.
 * - Aliases: `Cmd`/`m`/`Meta`, `Ctrl`/`c`/`Control`, `Alt`/`a`, `Shift`/`s`.
 * - Named keys use `KeyEvent.key` (`F10`, `Enter`, ...); letters are
 *   case-insensitive and `Shift-` is implied for shifted-character keys.
 *
 * @returns true only if all and only the listed modifiers plus the key match.
 */
function matchShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('-');
  let keyPart = parts.pop();
  if (!keyPart) return false;
  // prosemirror-keymap convention: `Space` aliases ' ' (awkward to type literally).
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
  // Single-char keys ignore Shift (it's part of the char, e.g. Shift+/ = `?`);
  // named keys (F10, Enter, ...) require an exact Shift match.
  if (keyPart.length > 1 && event.shiftKey !== needShift) return false;

  return event.key === keyPart || event.key.toLowerCase() === keyPart.toLowerCase();
}

/**
 * Creates the FloatingMenu plugin. Framework wrappers call this directly so
 * they own element creation and rendering.
 */
export function createFloatingMenuPlugin(options: CreateFloatingMenuPluginOptions): Plugin {
  const {
    pluginKey,
    editor,
    element,
    shouldShow = defaultFloatingMenuShouldShow,
    offset = 0,
    keymap,
    requireExplicitTrigger = false,
  } = options;

  const enterShortcuts = keymap?.enterMenu ?? DEFAULT_ENTER_MENU_SHORTCUTS;

  // `menu` is the right WAI-ARIA role for a transient list of single-action
  // choices, unlike `toolbar` (a persistent set of controls).
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

  // Clear the explicit-trigger flag if set. No-op when requireExplicitTrigger is off.
  const clearTriggeredFlag = (view: EditorView): void => {
    if (!requireExplicitTrigger) return;
    const triggered = (pluginKey.getState(view.state) as FloatingMenuPluginState | undefined)?.triggered ?? false;
    if (triggered) view.dispatch(view.state.tr.setMeta(FLOATING_MENU_META, 'hide'));
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

  // Final visibility: with requireExplicitTrigger on, both the trigger flag
  // AND shouldShow must be true; otherwise only shouldShow gates it.
  const isVisibleNow = (view: EditorView): boolean => {
    // Read-only shows no insert menu; unconditional so a wrapper-supplied
    // shouldShow cannot opt back in (matches the bubble menu gate).
    if (!editor.isEditable) return false;
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
      // Keyboard entry. handleKeyDown fires before browser defaults; we only
      // act while the menu is visible.
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
      // Move the menu into `.dm-editor` so `position:absolute` resolves against
      // the scrollable editor container (zero jitter on scroll).
      editorEl = editorView.dom.closest('.dm-editor');
      if (editorEl && element.parentElement !== editorEl) {
        editorEl.appendChild(element);
      }

      // Hide and clear the trigger flag so a stale `triggered=true` doesn't
      // survive an unrelated dismissal.
      const dismiss = (): void => {
        hideMenu();
        clearTriggeredFlag(editor.view);
      };

      const onFocus = (): void => {
        if (isVisibleNow(editor.view)) updatePosition(editor.view);
        else dismiss();
      };

      const onBlur = ({ event }: { event: FocusEvent }): void => {
        // Keep the menu visible if focus moved into it. `relatedTarget` is
        // `EventTarget | null`, so guard with `instanceof Node` before `.contains()`.
        const related = event.relatedTarget;
        if (related instanceof Node && element.contains(related)) return;
        dismiss();
      };

      // Click-outside dismissal. Capture phase so we fire before other UI
      // (dropdowns, popovers) handles the same click.
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
            // Clear stale `triggered` when the user leaves the empty paragraph,
            // else the next empty paragraph they enter would silently re-show the menu.
            clearTriggeredFlag(view);
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
