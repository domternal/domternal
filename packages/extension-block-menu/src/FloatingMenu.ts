/**
 * FloatingMenu Extension
 *
 * Shows a block-insert menu when the cursor is at the start of an empty
 * paragraph. Items are collected from all extensions via the
 * `addFloatingMenuItems()` hook; the menu exposes a WAI-ARIA `role="menu"`
 * with `role="group"` sections and `role="menuitem"` entries. Framework
 * wrappers (`@domternal/react`, `/vue`, `/angular`) render the UI; this
 * file owns visibility, positioning, dismiss, and keyboard entry.
 *
 * Styles ship via `@domternal/theme` (`_floating-menu.scss`).
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
}

export interface CreateFloatingMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  element: HTMLElement;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: number;
  keymap?: FloatingMenuKeymap | undefined;
}

/**
 * Parses a shortcut string like `Alt-F10` or `Mod-/` against a keyboard
 * event. `Mod` maps to Cmd on macOS, Ctrl elsewhere.
 */
function matchShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('-');
  const key = parts[parts.length - 1];
  if (!key) return false;
  const mods = new Set(parts.slice(0, -1));
  const isMac = /Mac|iPhone|iPad|iPod/i.test(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );
  const needMod = mods.has('Mod');
  const needAlt = mods.has('Alt');
  const needShift = mods.has('Shift');
  const needCtrl = mods.has('Ctrl') || (needMod && !isMac);
  const needMeta = mods.has('Meta') || (needMod && isMac);

  if (event.altKey !== needAlt) return false;
  if (event.shiftKey !== needShift) return false;
  if (event.ctrlKey !== needCtrl) return false;
  if (event.metaKey !== needMeta) return false;
  // Compare case-insensitively; single-char keys use event.key literal.
  return event.key === key || event.key.toLowerCase() === key.toLowerCase();
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

  return new Plugin({
    key: pluginKey,

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
      // against the scrollable editor container — zero jitter on scroll.
      editorEl = editorView.dom.closest('.dm-editor');
      if (editorEl && element.parentElement !== editorEl) {
        editorEl.appendChild(element);
      }

      const onFocus = (): void => {
        const visible = shouldShow({
          editor,
          view: editor.view,
          state: editor.view.state,
        });
        if (visible) updatePosition(editor.view);
        else hideMenu();
      };

      const onBlur = ({ event }: { event: FocusEvent }): void => {
        // Keep the menu visible if focus moved into it — users can
        // interact with menu items without the menu vanishing.
        if (event.relatedTarget && element.contains(event.relatedTarget as Node)) {
          return;
        }
        hideMenu();
      };

      // Click-outside dismissal. Capture phase ensures we fire before
      // other UI (dropdowns, popovers) handles the same click.
      clickOutsideHandler = (e: Event): void => {
        if (!isVisible()) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (element.contains(target)) return;
        if (editor.view.dom.contains(target)) return;
        hideMenu();
      };
      document.addEventListener('mousedown', clickOutsideHandler, true);

      // Cooperative dismissal: other overlays (toolbar dropdowns,
      // popovers) broadcast this event to close any open chrome.
      if (editorEl) {
        dismissOverlayHandler = (): void => { hideMenu(); };
        editorEl.addEventListener('dm:dismiss-overlays', dismissOverlayHandler);
      }

      editor.on('focus', onFocus);
      editor.on('blur', onBlur);

      return {
        update: (view) => {
          const visible = shouldShow({
            editor,
            view,
            state: view.state,
          });
          if (visible) updatePosition(view);
          else hideMenu();
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
    };
  },

  addProseMirrorPlugins() {
    const { element, shouldShow, offset, keymap } = this.options;
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
      }),
    ];
  },
});
