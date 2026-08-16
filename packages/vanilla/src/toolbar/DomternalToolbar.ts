import {
  ToolbarController,
  positionFloatingOnce,
  refocusEditorAfterCommand,
} from '@domternal/core';
import type {
  Editor,
  IconSet,
  ToolbarButton,
  ToolbarControllerEditor,
  ToolbarDropdown,
  ToolbarItem,
  ToolbarLayoutEntry,
} from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';
import { getTooltip } from './tooltip.js';
import { createIconCache, DROPDOWN_CARET } from './iconCache.js';
import type { IconCache } from './iconCache.js';
import { getComputedStyleAtCursor, getInlineStyleAtCursor } from './computedStyle.js';

export interface DomternalToolbarOptions {
  /** Editor instance the toolbar binds to. */
  editor: Editor;
  /** Optional icon set override. Falls back to `defaultIcons` per key. */
  icons?: IconSet;
  /**
   * Optional custom layout (item names + separators + custom dropdowns).
   * When omitted, items are grouped by their declared `group` property and
   * sorted by priority within each group.
   *
   * @example
   * ```ts
   * new DomternalToolbar(host, {
   *   editor,
   *   layout: ['bold', 'italic', 'underline', '|', 'heading', '|', 'undo', 'redo'],
   * });
   * ```
   */
  layout?: ToolbarLayoutEntry[];
}

/**
 * `DomternalToolbar` - vanilla DOM toolbar bound to an editor's items.
 *
 * Mounts a `ToolbarController` from `@domternal/core` and renders its state
 * (groups, active map, disabled map, dropdown state) into the host element.
 *
 * Re-renders are batched via `requestAnimationFrame` so transaction-rate
 * updates don't thrash the DOM. Button DOM nodes are reused across renders
 * (only their classes/attrs update) to preserve focus when navigating with
 * the keyboard.
 *
 * @example
 * ```ts
 * import { Editor, StarterKit } from '@domternal/core';
 * import { DomternalToolbar } from '@domternal/vanilla';
 * import '@domternal/theme';
 *
 * const editor = new Editor({
 *   element: document.getElementById('editor')!,
 *   extensions: [StarterKit],
 * });
 *
 * const toolbar = new DomternalToolbar(document.getElementById('toolbar')!, {
 *   editor,
 *   // Optional custom layout:
 *   // layout: ['bold', 'italic', '|', 'heading'],
 * });
 *
 * // Update later:
 * toolbar.setLayout(['bold', 'italic', 'underline']);
 *
 * // Cleanup:
 * toolbar.destroy();
 * ```
 *
 * **Events dispatched** (CustomEvent, `detail` shape in brackets):
 * - `dropdownopen` - `{ name: string }` - emitted when a dropdown opens
 * - `dropdownclose` - `{ name: string }` - emitted when a dropdown closes
 */
export class DomternalToolbar extends EventTarget {
  readonly host: HTMLElement;

  /** The editor instance this toolbar is bound to. */
  get editor(): Editor {
    return this.#editor;
  }

  /** Underlying controller. Exposed for power-user introspection. */
  get controller(): ToolbarController {
    return this.#controller;
  }

  #controller: ToolbarController;
  #editor: Editor;
  #layout: ToolbarLayoutEntry[] | undefined;
  #iconCache: IconCache;
  #abortCtl = new AbortController();
  #destroyed = false;

  /** Tracks the groups array reference to detect "structure changed" vs "state changed". */
  #lastGroupsRef: readonly unknown[] | null = null;

  /** Maps top-level button/dropdown name -> rendered trigger element. */
  #buttonEls = new Map<string, HTMLButtonElement>();
  /** Trigger markup last written, so a re-render does not rewrite it blindly. */
  #triggerHtml = new WeakMap<Element, string>();

  /** Rendered dropdown panel elements (created lazily when opened). */
  #dropdownPanelEl: HTMLElement | null = null;
  #cleanupFloating: (() => void) | null = null;

  #renderPending = false;
  #renderRaf = 0;
  #editorEl: HTMLElement | null = null;

  constructor(host: HTMLElement, options: DomternalToolbarOptions) {
    super();
    assertBrowser('DomternalToolbar');

    if (!(host instanceof HTMLElement)) {
      throw new TypeError(
        '[DomternalToolbar] host must be an HTMLElement. ' +
          'Pass a DOM node (e.g. document.querySelector("#toolbar")).',
      );
    }
    // Runtime guard for JS users who bypass TS type-checking.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.editor) {
      throw new TypeError('[DomternalToolbar] options.editor is required.');
    }

    this.host = host;
    this.#editor = options.editor;
    this.#layout = options.layout;
    this.#iconCache = createIconCache(options.icons);

    // Host setup
    this.host.classList.add('dm-toolbar');
    this.host.setAttribute('role', 'toolbar');
    this.host.setAttribute('aria-label', 'Editor formatting');
    this.host.setAttribute('data-dm-editor-ui', '');

    // Controller
    this.#controller = new ToolbarController(
      this.#editor as unknown as ToolbarControllerEditor,
      () => { this.#scheduleRender(); },
      this.#layout,
    );
    this.#controller.subscribe();

    // Wire global listeners (AbortController scoped)
    this.#attachListeners();

    // Initial paint
    this.#render();
  }

  // === Getters ===

  get openDropdown(): string | null {
    return this.#controller.openDropdown;
  }

  // === Setters ===

  setLayout(layout: ToolbarLayoutEntry[] | undefined): void {
    if (this.#destroyed) return;
    this.#layout = layout;
    // ToolbarController doesn't expose a public setLayout, so recreate.
    // Destroy + new is the documented pattern.
    this.#controller.destroy();
    this.#controller = new ToolbarController(
      this.#editor as unknown as ToolbarControllerEditor,
      () => { this.#scheduleRender(); },
      this.#layout,
    );
    this.#controller.subscribe();
    this.#lastGroupsRef = null; // force full rebuild
    this.#scheduleRender();
  }

  setIcons(icons: IconSet | undefined): void {
    if (this.#destroyed) return;
    this.#iconCache.setIcons(icons);
    this.#lastGroupsRef = null; // force full rebuild (icons baked into innerHTML)
    this.#scheduleRender();
  }

  closeDropdown(): void {
    if (this.#destroyed) return;
    this.#controller.closeDropdown();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    cancelAnimationFrame(this.#renderRaf);
    this.#abortCtl.abort();
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#controller.destroy();

    this.#dropdownPanelEl?.remove();
    this.#dropdownPanelEl = null;
    this.host.replaceChildren();
    this.#buttonEls.clear();
  }

  // === Lifecycle helpers ===

  #attachListeners(): void {
    const { signal } = this.#abortCtl;

    // Outside-click closes any open dropdown
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!this.#controller.openDropdown) return;
        const target = e.target as Node;
        if (this.host.contains(target)) return;
        if (this.#dropdownPanelEl?.contains(target)) return;
        this.closeDropdown();
      },
      { signal },
    );

    // Escape from anywhere: opening a dropdown with the mouse leaves focus
    // outside the toolbar, so the host handler below never sees the key.
    document.addEventListener(
      'keydown',
      (e) => {
        if (!this.#controller.openDropdown) return;
        if (e.key !== 'Escape') return;
        // Focus inside the toolbar belongs to the host handler, which also
        // restores focus. Not defaultPrevented: ProseMirror prevents Escape
        // first whenever the caret is in the editor.
        if (this.host.contains(document.activeElement)) return;
        this.closeDropdown();
        e.preventDefault();
      },
      { signal },
    );

    // Keyboard navigation on toolbar host
    this.host.addEventListener(
      'keydown',
      (e) => { this.#onKeyDown(e); },
      { signal },
    );

    // Cooperative dismissal across editor overlays
    this.#editorEl = this.#editor.view.dom.closest<HTMLElement>('.dm-editor');
    this.#editorEl?.addEventListener(
      'dm:dismiss-overlays',
      () => {
        if (this.#controller.openDropdown) {
          this.closeDropdown();
        }
      },
      { signal },
    );
  }

  // === Render ===

  #scheduleRender(): void {
    if (this.#renderPending) return;
    this.#renderPending = true;
    this.#renderRaf = requestAnimationFrame(() => {
      this.#renderPending = false;
      if (this.#destroyed) return;
      this.#render();
    });
  }

  #render(): void {
    const groups = this.#controller.groups;
    const groupsChanged = groups !== this.#lastGroupsRef;
    if (groupsChanged) {
      this.#renderGroupsStructure(groups);
      this.#lastGroupsRef = groups;
    }
    this.#updateButtonStates();
    this.#renderDropdown();
  }

  #renderGroupsStructure(groups: readonly { name: string; items: ToolbarItem[] }[]): void {
    // Wipe and rebuild structure. Button refs are tracked so subsequent
    // state updates target individual DOM nodes (no full rebuild per tx).
    // Also drop any open dropdown panel reference - replaceChildren() removed
    // it from DOM; renderDropdown() will recreate it next pass if still open.
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#dropdownPanelEl = null;
    this.host.replaceChildren();
    this.#buttonEls.clear();

    groups.forEach((group, gi) => {
      if (gi > 0) {
        const sep = document.createElement('div');
        sep.className = 'dm-toolbar-separator';
        sep.setAttribute('role', 'separator');
        this.host.appendChild(sep);
      }

      const groupEl = document.createElement('div');
      groupEl.className = 'dm-toolbar-group';
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute('aria-label', group.name || 'Tools');

      for (const item of group.items) {
        if (item.type === 'button') {
          const btnEl = this.#createButton(item);
          groupEl.appendChild(btnEl);
          this.#buttonEls.set(item.name, btnEl);
        } else if (item.type === 'dropdown') {
          const wrapper = this.#createDropdownTrigger(item);
          groupEl.appendChild(wrapper);
        }
      }

      this.host.appendChild(groupEl);
    });
  }

  #createButton(item: ToolbarButton): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-toolbar-button';
    btn.innerHTML = this.#iconCache.getIcon(item.icon);
    btn.setAttribute('aria-label', item.label);
    btn.title = getTooltip(item);
    if (item.style) btn.setAttribute('style', item.style);

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', (e) => { this.#onButtonClick(item, e); });
    btn.addEventListener('focus', () => { this.#onButtonFocus(item.name); });

    return btn;
  }

  #createDropdownTrigger(dd: ToolbarDropdown): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dm-toolbar-dropdown-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-toolbar-button dm-toolbar-dropdown-trigger';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-label', dd.label);
    btn.title = dd.label;
    btn.setAttribute('data-dropdown', dd.name);
    const triggerHtml = this.#resolveDropdownTriggerHtml(dd);
    this.#triggerHtml.set(btn, triggerHtml);
    btn.innerHTML = triggerHtml;

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', () => { this.#onDropdownToggle(dd); });
    btn.addEventListener('focus', () => { this.#onButtonFocus(dd.name); });

    wrapper.appendChild(btn);
    this.#buttonEls.set(dd.name, btn);
    return wrapper;
  }

  #resolveDropdownTriggerHtml(dd: ToolbarDropdown): string {
    const activeItem = dd.items.find((sub) => this.#controller.activeMap.get(sub.name));

    // Dynamic-label dropdown reading computed style at cursor (e.g. font-size)
    if (dd.dynamicLabel && !activeItem && dd.computedStyleProperty) {
      let computed: string | null;
      if (dd.computedStyleProperty === 'font-family') {
        computed = getInlineStyleAtCursor(this.#editor, dd.computedStyleProperty);
        if (computed) {
          const first = computed.split(',')[0]?.replace(/['"]+/g, '').trim();
          computed = first ?? null;
        }
      } else {
        computed = getComputedStyleAtCursor(this.#editor, dd.computedStyleProperty);
      }
      if (computed) {
        return `<span class="dm-toolbar-trigger-label">${computed}</span>${DROPDOWN_CARET}`;
      }
    }

    return this.#iconCache.getDropdownTriggerHtml(dd, activeItem);
  }

  #updateButtonStates(): void {
    const groups = this.#controller.groups;
    const focusedIndex = this.#controller.focusedIndex;

    for (const group of groups) {
      for (const item of group.items) {
        if (item.type === 'button') {
          this.#updateButton(item, focusedIndex);
        } else if (item.type === 'dropdown') {
          this.#updateDropdownTrigger(item, focusedIndex);
        }
      }
    }
  }

  #updateButton(item: ToolbarButton, focusedIndex: number): void {
    const btn = this.#buttonEls.get(item.name);
    if (!btn) return;
    const isActive = this.#controller.activeMap.get(item.name) ?? false;
    const isDisabled = this.#controller.disabledMap.get(item.name) ?? false;
    const flat = this.#controller.getFlatIndex(item.name);

    btn.classList.toggle('dm-toolbar-button--active', isActive);
    btn.disabled = isDisabled;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.tabIndex = flat === focusedIndex ? 0 : -1;

    if (item.emitEvent) {
      const expanded = this.#controller.expandedMap.get(item.name) === true;
      if (expanded) {
        btn.setAttribute('aria-expanded', 'true');
      } else {
        btn.removeAttribute('aria-expanded');
      }
    }
  }

  #updateDropdownTrigger(dd: ToolbarDropdown, focusedIndex: number): void {
    const btn = this.#buttonEls.get(dd.name);
    if (!btn) return;

    const isDisabled = this.#controller.disabledMap.get(dd.name) ?? false;
    const isOpen = this.#controller.openDropdown === dd.name;
    const flat = this.#controller.getFlatIndex(dd.name);

    // dropdown trigger active when its currently-active sub-item exists
    const isDropdownActive = dd.layout !== 'grid'
      && !dd.dynamicLabel
      && dd.items.some((sub) => this.#controller.activeMap.get(sub.name) ?? false);

    btn.classList.toggle('dm-toolbar-button--active', isDropdownActive);
    btn.disabled = isDisabled;
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.tabIndex = flat === focusedIndex ? 0 : -1;

    // Trigger HTML follows the cursor (dynamicLabel/dynamicIcon). Compared
    // against what was last WRITTEN: `btn.innerHTML` returns the browser's
    // re-serialisation, so the old guard never held and every render replaced
    // the glyph under the pointer, killing the press.
    const newHtml = this.#resolveDropdownTriggerHtml(dd);
    if (this.#triggerHtml.get(btn) !== newHtml) {
      this.#triggerHtml.set(btn, newHtml);
      btn.innerHTML = newHtml;
    }
  }

  #renderDropdown(): void {
    const openName = this.#controller.openDropdown;
    const currentPanel = this.#dropdownPanelEl;

    // Nothing to do
    if (openName === null && currentPanel === null) return;

    // Closing: remove panel
    if (openName === null) {
      this.#cleanupFloating?.();
      this.#cleanupFloating = null;
      currentPanel?.remove();
      this.#dropdownPanelEl = null;
      return;
    }

    // Open: find the dropdown definition
    const dd = this.#findDropdown(openName);
    if (!dd) return;

    // If panel already shows this dropdown, do nothing
    if (currentPanel?.dataset['dropdownPanel'] === openName) return;

    // Replace any prior panel (shouldn't happen but be safe)
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    currentPanel?.remove();

    const panel = this.#createDropdownPanel(dd);
    const trigger = this.#buttonEls.get(dd.name);
    if (!trigger) return;

    // Append to wrapper so theme styles position relative
    trigger.parentElement?.appendChild(panel);
    this.#dropdownPanelEl = panel;

    requestAnimationFrame(() => {
      if (this.#destroyed || !panel.isConnected) return;
      const placement = dd.layout === 'grid' ? 'bottom' : 'bottom-start';
      this.#cleanupFloating = positionFloatingOnce(trigger, panel, {
        placement,
        offsetValue: 4,
      });
    });

    this.dispatchEvent(new CustomEvent('dropdownopen', { detail: { name: openName } }));
  }

  #createDropdownPanel(dd: ToolbarDropdown): HTMLElement {
    const panel = document.createElement('div');
    panel.dataset['dropdownPanel'] = dd.name;
    panel.setAttribute('role', 'menu');

    if (dd.layout === 'grid') {
      panel.className = 'dm-toolbar-dropdown-panel dm-color-palette';
      panel.style.setProperty('--dm-palette-columns', String(dd.gridColumns ?? 10));

      for (const sub of dd.items) {
        if (sub.color) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dm-color-swatch';
          if (this.#controller.activeMap.get(sub.name)) {
            btn.classList.add('dm-color-swatch--active');
          }
          btn.setAttribute('role', 'menuitem');
          btn.tabIndex = -1;
          btn.setAttribute('aria-label', sub.label);
          btn.title = sub.label;
          btn.style.backgroundColor = sub.color;
          btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
          btn.addEventListener('click', (e) => { this.#onDropdownItemClick(sub, e); });
          panel.appendChild(btn);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dm-color-palette-reset';
          btn.setAttribute('role', 'menuitem');
          btn.tabIndex = -1;
          btn.setAttribute('aria-label', sub.label);
          btn.innerHTML = this.#iconCache.getItemContent(sub.icon, sub.label);
          btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
          btn.addEventListener('click', (e) => { this.#onDropdownItemClick(sub, e); });
          panel.appendChild(btn);
        }
      }
      return panel;
    }

    // Standard list dropdown
    panel.className = 'dm-toolbar-dropdown-panel';
    if (dd.displayMode) panel.setAttribute('data-display-mode', dd.displayMode);

    for (const sub of dd.items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-toolbar-dropdown-item';
      if (this.#controller.activeMap.get(sub.name)) {
        btn.classList.add('dm-toolbar-dropdown-item--active');
      }
      btn.setAttribute('role', 'menuitem');
      btn.tabIndex = -1;
      btn.setAttribute('aria-label', sub.label);
      btn.title = sub.label;
      btn.innerHTML = this.#iconCache.getItemContent(sub.icon, sub.label, dd.displayMode);
      if (sub.style) btn.setAttribute('style', sub.style);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      btn.addEventListener('click', (e) => { this.#onDropdownItemClick(sub, e); });
      panel.appendChild(btn);
    }
    return panel;
  }

  #findDropdown(name: string): ToolbarDropdown | null {
    for (const group of this.#controller.groups) {
      for (const item of group.items) {
        if (item.type === 'dropdown' && item.name === name) {
          return item;
        }
      }
    }
    return null;
  }

  // === Event handlers ===

  #onButtonClick(item: ToolbarButton, event: MouseEvent): void {
    if (this.#controller.openDropdown) {
      this.closeDropdown();
    }

    if (item.emitEvent) {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest<HTMLElement>('.dm-toolbar-button') ?? target ?? undefined;
      (this.#editor.emit as (e: string, d: unknown) => void)(
        item.emitEvent,
        { anchorElement: anchor },
      );
      return;
    }

    this.#controller.executeCommand(item);

    // Refocus editor so caret stays visible (mousedown.preventDefault holds
    // focus on mouse path; keyboard activations need explicit refocus).
    refocusEditorAfterCommand(this.#editor.view);
  }

  #onDropdownToggle(dd: ToolbarDropdown): void {
    const wasOpen = this.#controller.openDropdown === dd.name;
    if (wasOpen) {
      this.closeDropdown();
      this.dispatchEvent(new CustomEvent('dropdownclose', { detail: { name: dd.name } }));
      return;
    }

    // Close any prior dropdown before opening new one (controller does this
    // via toggleDropdown internally too, but emit close event explicitly)
    if (this.#controller.openDropdown) {
      const prev = this.#controller.openDropdown;
      this.dispatchEvent(new CustomEvent('dropdownclose', { detail: { name: prev } }));
    }

    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#controller.toggleDropdown(dd.name);
  }

  #onDropdownItemClick(item: ToolbarButton, event: MouseEvent): void {
    let anchor: HTMLElement | undefined;
    if (item.emitEvent) {
      const wrapper = (event.target as HTMLElement).closest('.dm-toolbar-dropdown-wrapper');
      anchor = wrapper?.querySelector<HTMLElement>('.dm-toolbar-dropdown-trigger') ?? undefined;
    }

    this.closeDropdown();

    if (item.emitEvent) {
      (this.#editor.emit as (e: string, d: unknown) => void)(
        item.emitEvent,
        { anchorElement: anchor },
      );
    } else {
      this.#controller.executeCommand(item);
    }

    refocusEditorAfterCommand(this.#editor.view);
  }

  #onButtonFocus(name: string): void {
    const index = this.#controller.getFlatIndex(name);
    if (index >= 0) {
      this.#controller.setFocusedIndex(index);
    }
  }

  // === Keyboard navigation ===

  #onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.#controller.navigateNext();
        this.#focusCurrentButton();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.#controller.navigatePrev();
        this.#focusCurrentButton();
        break;
      case 'ArrowDown': {
        event.preventDefault();
        if (this.#controller.openDropdown) {
          this.#focusDropdownItem(1);
        } else {
          const btn = document.activeElement;
          if (btn instanceof HTMLElement && btn.getAttribute('aria-haspopup') && this.host.contains(btn)) {
            btn.click();
            requestAnimationFrame(() => { this.#focusDropdownItem(0, true); });
          }
        }
        break;
      }
      case 'ArrowUp':
        event.preventDefault();
        if (this.#controller.openDropdown) {
          this.#focusDropdownItem(-1);
        }
        break;
      case 'Home':
        event.preventDefault();
        this.#controller.navigateFirst();
        this.#focusCurrentButton();
        break;
      case 'End':
        event.preventDefault();
        this.#controller.navigateLast();
        this.#focusCurrentButton();
        break;
      case 'Escape':
        if (this.#controller.openDropdown) {
          event.preventDefault();
          this.closeDropdown();
          this.#focusCurrentButton();
        }
        break;
    }
  }

  #focusCurrentButton(): void {
    const buttons = this.host.querySelectorAll<HTMLElement>('.dm-toolbar-button');
    // item() returns null when focusedIndex is out of range, but the DOM lib
    // mistypes it as non-null; widen and optional-chain to avoid a TypeError.
    const btn = buttons.item(this.#controller.focusedIndex) as HTMLElement | null;
    btn?.focus();
  }

  #focusDropdownItem(direction: number, first?: boolean): void {
    const panel = this.#dropdownPanelEl;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    if (first) {
      items[0]?.focus();
      return;
    }
    const current = document.activeElement;
    const idx = current instanceof HTMLElement ? items.indexOf(current) : -1;
    const next = idx === -1
      ? (direction > 0 ? 0 : items.length - 1)
      : (idx + direction + items.length) % items.length;
    items[next]?.focus();
  }
}
