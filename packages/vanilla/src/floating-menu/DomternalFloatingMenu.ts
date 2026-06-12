import { FloatingMenuController, createFloatingMenuPlugin } from '@domternal/core';
import type {
  Editor,
  FloatingMenuItem,
  FloatingMenuItemsOverride,
  FloatingMenuKeymap,
  FloatingMenuOptions,
  IconSet,
  PluginKey,
} from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';
import { createPluginKey } from '../shared/pluginKey.js';
import { resolveIcon } from '../shared/iconRenderer.js';
import type { CustomContentOption } from '../shared/types.js';

export interface DomternalFloatingMenuOptions extends CustomContentOption {
  /** Editor instance the floating menu binds to. */
  editor: Editor;
  /** Custom visibility predicate. Defaults to "cursor at start of empty paragraph". */
  shouldShow?: FloatingMenuOptions['shouldShow'];
  /** Pixel offset from the anchor. @default 0 */
  offset?: number;
  /** Items override (array replaces defaults; function filters/reorders). */
  items?: FloatingMenuItemsOverride;
  /** Keyboard shortcuts for entering the menu. */
  keymap?: FloatingMenuKeymap;
  /** Icon set override. Falls back to `defaultIcons` per key. */
  icons?: IconSet;
  /**
   * When `true`, the menu opens ONLY via explicit trigger (`showFloatingMenu`
   * call, typically from BlockHandle's `+` button). Pressing Enter to make
   * a new empty paragraph does NOT auto-show the menu. Notion-style behavior.
   * @default false
   */
  requireExplicitTrigger?: boolean;
}

/**
 * `DomternalFloatingMenu` - vanilla DOM block-insert menu bound to an editor.
 *
 * Renders the editor's `floatingMenuItems` (collected via extensions'
 * `addFloatingMenuItems()` hook) in groups, with roving-tabindex keyboard
 * navigation and `requireExplicitTrigger` support for Notion-style flow.
 *
 * Mounts `createFloatingMenuPlugin` from `@domternal/core`
 * for visibility + positioning. The plugin moves the host element inside
 * `.dm-editor` automatically so it scrolls with the editor.
 *
 * @example
 * ```ts
 * import { DomternalFloatingMenu } from '@domternal/vanilla';
 *
 * // Classic: auto-shows on every empty paragraph
 * new DomternalFloatingMenu(host, { editor });
 *
 * // Notion-style: only opens via "+" button or `showFloatingMenu(view)`
 * new DomternalFloatingMenu(host, { editor, requireExplicitTrigger: true });
 * ```
 */
export class DomternalFloatingMenu extends EventTarget {
  readonly host: HTMLElement;

  get editor(): Editor {
    return this.#editor;
  }

  /**
   * Underlying controller. Exposed for power-user introspection.
   *
   * `null` when `customContent` is provided (consumer owns rendering, and
   * therefore the item-state machine). Use the `editor.floatingMenuItems`
   * direct API in that case.
   */
  get controller(): FloatingMenuController | null {
    return this.#controller;
  }

  #editor: Editor;
  #pluginKey: PluginKey;
  #controller: FloatingMenuController | null = null;
  #icons: IconSet | undefined;
  #abortCtl = new AbortController();
  #destroyed = false;
  /** When `customContent` is provided, we skip controller + default render. */
  #hasCustomContent = false;

  #renderPending = false;
  #renderRaf = 0;

  constructor(host: HTMLElement, options: DomternalFloatingMenuOptions) {
    super();
    assertBrowser('DomternalFloatingMenu');

    if (!(host instanceof HTMLElement)) {
      throw new TypeError(
        '[DomternalFloatingMenu] host must be an HTMLElement. ' +
          'Pass a DOM node (e.g. document.querySelector("#floating")).',
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.editor) {
      throw new TypeError('[DomternalFloatingMenu] options.editor is required.');
    }

    this.host = host;
    this.#editor = options.editor;
    this.#icons = options.icons;
    this.#pluginKey = createPluginKey('vanillaFloatingMenu');

    // Host setup
    this.host.classList.add('dm-floating-menu');
    this.host.setAttribute('role', 'menu');
    this.host.setAttribute('aria-label', 'Insert block');
    this.host.setAttribute('data-dm-editor-ui', '');

    // Register the visibility/positioning plugin
    const plugin = createFloatingMenuPlugin({
      pluginKey: this.#pluginKey,
      editor: this.#editor,
      element: this.host,
      ...(options.shouldShow !== undefined && { shouldShow: options.shouldShow }),
      offset: options.offset ?? 0,
      ...(options.keymap !== undefined && { keymap: options.keymap }),
      ...(options.requireExplicitTrigger !== undefined && {
        requireExplicitTrigger: options.requireExplicitTrigger,
      }),
    });
    this.#editor.registerPlugin(plugin);

    // customContent path: consumer owns rendering entirely. Plugin handles
    // visibility/positioning; we skip controller + default rendering + key
    // nav (consumer wires their own). Matches Vue's `hasCustomSlot` branch.
    if (options.customContent) {
      this.#hasCustomContent = true;
      this.host.appendChild(options.customContent);
      return;
    }

    // Default rendering path: spin up controller + key nav + initial paint.
    this.#controller = new FloatingMenuController(
      this.#editor,
      () => { this.#scheduleRender(); },
      options.items,
    );
    this.#controller.subscribe();

    this.host.addEventListener(
      'keydown',
      (e) => { this.#onKeyDown(e); },
      { signal: this.#abortCtl.signal },
    );

    this.#render();
  }

  /**
   * Swap the icon set. Re-renders to refresh button SVGs. No-op when
   * `customContent` is in use (consumer renders their own icons).
   */
  setIcons(icons: IconSet | undefined): void {
    if (this.#destroyed) return;
    this.#icons = icons;
    if (!this.#hasCustomContent) this.#scheduleRender();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    cancelAnimationFrame(this.#renderRaf);
    this.#abortCtl.abort();
    this.#controller?.destroy();

    if (!this.#editor.isDestroyed) {
      this.#editor.unregisterPlugin(this.#pluginKey);
    }

    this.host.replaceChildren();
  }

  // === Render ===

  #scheduleRender(): void {
    if (this.#renderPending || this.#hasCustomContent) return;
    this.#renderPending = true;
    this.#renderRaf = requestAnimationFrame(() => {
      this.#renderPending = false;
      if (this.#destroyed || !this.#controller) return;
      this.#render();
      // After paint, focus the active item if the menu has keyboard focus
      const focusedIdx = this.#controller.focusedIndex;
      if (focusedIdx >= 0) {
        queueMicrotask(() => {
          const target = this.host.querySelector<HTMLElement>(
            `[data-floating-menu-index="${String(focusedIdx)}"]`,
          );
          target?.focus();
        });
      }
    });
  }

  #render(): void {
    if (!this.#controller) return;
    this.host.replaceChildren();
    const groups = this.#controller.groups;
    const focusedIdx = this.#controller.focusedIndex;

    let flatIndex = 0;
    groups.forEach((group, gi) => {
      if (group.name) {
        const label = document.createElement('div');
        label.className = 'dm-floating-menu-group-label';
        label.id = `dm-fm-g${String(gi)}`;
        label.textContent = group.name;
        this.host.appendChild(label);
      }

      const groupEl = document.createElement('div');
      groupEl.className = 'dm-floating-menu-group';
      groupEl.setAttribute('role', 'group');
      if (group.name) groupEl.setAttribute('aria-labelledby', `dm-fm-g${String(gi)}`);

      for (const item of group.items) {
        const currentFlat = flatIndex;
        flatIndex += 1;
        const btn = this.#createItem(item, currentFlat, focusedIdx);
        groupEl.appendChild(btn);
      }

      this.host.appendChild(groupEl);
    });
  }

  #createItem(
    item: FloatingMenuItem,
    flatIndex: number,
    focusedIndex: number,
  ): HTMLButtonElement {
    const disabled = this.#controller?.isDisabled(item) ?? false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-floating-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset['floatingMenuItem'] = item.name;
    btn.dataset['floatingMenuIndex'] = String(flatIndex);
    btn.tabIndex = this.#tabIndexFor(flatIndex, focusedIndex);
    if (disabled) btn.setAttribute('aria-disabled', 'true');
    if (item.shortcut) btn.setAttribute('aria-keyshortcuts', item.shortcut);
    btn.disabled = disabled;

    if (item.icon) {
      const iconHtml = resolveIcon(item.icon, this.#icons);
      if (iconHtml) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'dm-floating-menu-item-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = iconHtml;
        btn.appendChild(iconSpan);
      }
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'dm-floating-menu-item-label';
    labelSpan.textContent = item.label;
    btn.appendChild(labelSpan);

    if (item.shortcut) {
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'dm-floating-menu-item-shortcut';
      shortcutSpan.setAttribute('aria-hidden', 'true');
      shortcutSpan.textContent = item.shortcut;
      btn.appendChild(shortcutSpan);
    }

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', () => { this.#onItemClick(item); });
    return btn;
  }

  /**
   * Roving tabindex: focused item gets 0; when no item focused, first item
   * gets 0 (so tab traversal from outside lands naturally on the menu).
   */
  #tabIndexFor(flat: number, focused: number): 0 | -1 {
    if (flat === focused) return 0;
    if (focused < 0 && flat === 0) return 0;
    return -1;
  }

  // === Event handlers ===

  #onItemClick(item: FloatingMenuItem): void {
    if (this.#destroyed || !this.#controller) return;
    this.#controller.execute(item);
    requestAnimationFrame(() => { this.#editor.view.focus(); });
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (!this.#controller) return;
    const focused = this.#controller.focusedItem();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#controller.next();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#controller.prev();
        break;
      case 'Home':
        event.preventDefault();
        this.#controller.first();
        break;
      case 'End':
        event.preventDefault();
        this.#controller.last();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.#controller.leaveMenu();
        this.#editor.view.focus();
        break;
      case 'Enter':
      case ' ':
        if (focused) {
          event.preventDefault();
          this.#onItemClick(focused);
        }
        break;
      default:
        break;
    }
  }
}
