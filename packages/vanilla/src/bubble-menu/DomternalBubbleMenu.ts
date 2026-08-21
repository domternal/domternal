import {
  ToolbarController,
  buildBubbleItemMaps,
  createBubbleMenuPlugin,
  createBubbleShouldShow,
  defaultBubbleContexts,
  resolveBubbleMenuItems,
  resolveBubbleNames,
  positionFloatingOnce,
  refocusEditorAfterCommand,
} from '@domternal/core';
import { resolveIcon } from '../shared/iconRenderer.js';
import type {
  Editor,
  BubbleMenuOptions,
  IconSet,
  ToolbarButton,
  ToolbarDropdown,
  PluginKey,
} from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';
import { createPluginKey } from '../shared/pluginKey.js';
import type { CustomContentOption } from '../shared/types.js';
import type { BubbleContexts, BubbleMenuItem, BubbleItemMaps } from '@domternal/core';
import {
  computeTrailingState,
  INITIAL_TRAILING_STATE,
  type BubbleMenuTrailingState,
} from './trailingState.js';

const DROPDOWN_CARET =
  '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
  '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface DomternalBubbleMenuOptions extends CustomContentOption {
  /** Editor instance the bubble menu binds to. */
  editor: Editor;
  /** Custom visibility predicate. Replaces the default (auto-detect context). */
  shouldShow?: BubbleMenuOptions['shouldShow'];
  /** Placement relative to the selection. @default 'top' */
  placement?: 'top' | 'bottom';
  /** Pixel offset from the selection edge. @default 8 */
  offset?: number;
  /** Debounce delay for position updates (ms). @default 0 */
  updateDelay?: number;
  /** Explicit item list (overrides contexts). E.g. `['bold', 'italic', '|', 'link']`. */
  items?: string[];
  /**
   * Context-aware items. Map from context name (`'text'`, `'codeBlock'`, etc.)
   * to item name list, `true` (show all format items), or `null` (no menu for
   * this context). Defaults to `defaultBubbleContexts(editor)`.
   */
  contexts?: BubbleContexts;
  /** Custom icon overrides. Falls back to default Phosphor icons for unmapped keys. */
  icons?: IconSet;
}

export type { BubbleMenuItem, BubbleMenuTrailingState };

/**
 * `DomternalBubbleMenu` - vanilla DOM bubble menu bound to an editor.
 *
 * Mounts `createBubbleMenuPlugin` from `@domternal/core` for visibility and
 * positioning, then renders ProseMirror selection-aware buttons + dropdowns
 * inside the host element. Trailing buttons ("A" for Notion color picker,
 * "..." for block context menu) are rendered automatically when the
 * corresponding extensions are loaded.
 *
 * Re-renders are batched via `requestAnimationFrame`. The structure is rebuilt
 * only when the item list changes; a state-only render updates the nodes on
 * screen, so a press that outlives a transaction still produces a click.
 *
 * **Stable identity convention.** A trigger survives a state-only render but
 * NOT an item-list change, so consumers holding a reference to one (e.g. as a
 * popover anchor) should still:
 * - Either listen for `selectionUpdate` / `transaction` and re-resolve the
 *   anchor via `host.querySelector('.dm-ncp-trigger')` on demand
 * - Or match the trigger by class + container (`closest('.dm-bubble-menu')`)
 *   rather than DOM identity for purposes like toggle-on-second-click.
 *
 * @example
 * ```ts
 * import { DomternalBubbleMenu } from '@domternal/vanilla';
 *
 * const bubble = new DomternalBubbleMenu(host, { editor });
 *
 * // Custom item list:
 * new DomternalBubbleMenu(host, {
 *   editor,
 *   items: ['bold', 'italic', '|', 'link'],
 * });
 *
 * // Listen for state changes:
 * bubble.addEventListener('dropdownopen', (e) => {
 *   console.log('opened', (e as CustomEvent<{ name: string }>).detail.name);
 * });
 *
 * bubble.destroy();
 * ```
 *
 * **Events dispatched** (CustomEvent, `detail` shape in brackets):
 * - `dropdownopen` - `{ name: string }`
 * - `dropdownclose` - `{ name: string }`
 */
export class DomternalBubbleMenu extends EventTarget {
  readonly host: HTMLElement;

  get editor(): Editor {
    return this.#editor;
  }

  /** Current trailing-button state snapshot. */
  get trailing(): Readonly<BubbleMenuTrailingState> {
    return this.#trailing;
  }

  /** Currently open dropdown name (e.g. text-align), or `null`. */
  get openDropdown(): string | null {
    return this.#openDropdown;
  }

  #editor: Editor;
  #pluginKey: PluginKey;
  #destroyed = false;
  /** Optional consumer-provided DOM appended after default items + trailing. */
  #customContent: HTMLElement | undefined;

  // Configuration cached from constructor
  #shouldShowOpt: BubbleMenuOptions['shouldShow'] | undefined;
  #placement: 'top' | 'bottom';
  #offset: number;
  #updateDelay: number;
  #explicitItems: string[] | undefined;
  #explicitContexts: Record<string, string[] | true | null> | undefined;
  #icons: IconSet | undefined;

  // Editor-derived caches (set once in #init)
  #maps: BubbleItemMaps | null = null;
  #hasNotionColorPicker = false;
  #hasBlockContextMenu = false;
  #effectiveContexts: Record<string, string[] | true | null> | undefined;
  #defaultItemList: BubbleMenuItem[] = [];
  #transactionHandler: (() => void) | null = null;

  // Live state
  #resolvedItems: BubbleMenuItem[] = [];
  #activeMap = new Map<string, boolean>();
  #disabledMap = new Map<string, boolean>();
  #trailing: BubbleMenuTrailingState = { ...INITIAL_TRAILING_STATE };

  // Structure rebuilt only on an item-list change, so a pressed button lives.
  #structureKey: string | null = null;
  #buttonEls = new Map<string, HTMLButtonElement>();
  // Icon markup last WRITTEN. `btn.innerHTML` returns the browser's
  // re-serialisation, so comparing against it rewrites every render and
  // replaces the glyph under the pointer. Keyed by element: names repeat.
  #iconHtml = new WeakMap<Element, string>();
  #colorTriggerEl: HTMLButtonElement | null = null;
  #blockMenuTriggerEl: HTMLButtonElement | null = null;

  // Dropdown state (text-align dropdown inside bubble menu)
  #openDropdown: string | null = null;
  #dropdownPanelEl: HTMLDivElement | null = null;
  #cleanupDropdownFloating: (() => void) | null = null;
  #dropdownAbortCtl: AbortController | null = null;

  #renderPending = false;
  #renderRaf = 0;

  constructor(host: HTMLElement, options: DomternalBubbleMenuOptions) {
    super();
    assertBrowser('DomternalBubbleMenu');

    if (!(host instanceof HTMLElement)) {
      throw new TypeError(
        '[DomternalBubbleMenu] host must be an HTMLElement. ' +
          'Pass a DOM node (e.g. document.querySelector("#bubble")).',
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.editor) {
      throw new TypeError('[DomternalBubbleMenu] options.editor is required.');
    }

    this.host = host;
    this.#editor = options.editor;
    this.#shouldShowOpt = options.shouldShow;
    this.#placement = options.placement ?? 'top';
    this.#offset = options.offset ?? 8;
    this.#updateDelay = options.updateDelay ?? 0;
    this.#explicitItems = options.items;
    this.#explicitContexts = options.contexts;
    this.#icons = options.icons;
    this.#customContent = options.customContent;
    this.#pluginKey = createPluginKey('vanillaBubbleMenu');

    // Host setup
    this.host.classList.add('dm-bubble-menu');
    this.host.setAttribute('role', 'toolbar');
    this.host.setAttribute('aria-label', 'Text formatting');

    this.#init();
  }

  // === Public API ===

  /**
   * Emit `notionColorOpen` with the given anchor element. Listened to by
   * `DomternalNotionColorPicker` (Phase 4) which positions its panel against
   * the anchor. Typically called by the wrapper's internal "A" trigger but
   * exposed publicly for power users with custom UIs.
   */
  openColorPicker(anchor: HTMLElement): void {
    if (this.#destroyed) return;
    (this.#editor.emit as (e: string, d: unknown) => void)(
      'notionColorOpen',
      { anchorElement: anchor },
    );
  }

  /**
   * Open the block context menu against the cursor's containing block.
   * Dispatches `dm:block-context-menu-open` on `.dm-editor`. The
   * `BlockContextMenu` extension listens and positions itself against the
   * provided anchor.
   *
   * Walks one level up when the cursor's textblock is not a direct doc
   * child (e.g. cursor in `listItem > paragraph` targets the `listItem`),
   * so "Delete" / "Turn into" operate on the visual block.
   */
  openBlockContextMenu(anchor: HTMLElement): void {
    if (this.#destroyed) return;
    const $from = this.#editor.state.selection.$from;
    if ($from.depth < 1) return;
    const depth =
      $from.depth > 1 && $from.node($from.depth - 1).type.name !== 'doc'
        ? $from.depth - 1
        : $from.depth;
    const blockPos = $from.before(depth);
    const editorEl = this.#editor.view.dom.closest<HTMLElement>('.dm-editor');
    editorEl?.dispatchEvent(
      new CustomEvent('dm:block-context-menu-open', {
        bubbles: false,
        detail: { blockPos, anchorElement: anchor },
      }),
    );
  }

  /**
   * Replace the explicit item list. When `undefined`, falls back to
   * context-aware resolution (per `contexts` or `defaultBubbleContexts`).
   * Re-renders on next transaction; call manually if needed:
   * `editor.dispatch(editor.state.tr)` to force an immediate re-resolve.
   */
  setItems(items: string[] | undefined): void {
    if (this.#destroyed) return;
    this.#explicitItems = items;
    // Recompute the static default list (used when contexts are disabled).
    if (this.#maps) {
      this.#defaultItemList = items
        ? resolveBubbleNames(items, this.#maps.itemMap, this.#maps.dropdownMap)
        : resolveBubbleNames(['bold', 'italic', 'underline'], this.#maps.itemMap, this.#maps.dropdownMap);
    }
    this.#updateResolvedItems();
    this.#updateStates();
    this.#scheduleRender();
  }

  /**
   * Replace context map. When `undefined`, defaults to
   * `defaultBubbleContexts(editor)`. Note: `shouldShow` is baked into the
   * plugin at construction; this only changes WHICH items render once the
   * menu is visible.
   */
  setContexts(contexts: BubbleContexts | undefined): void {
    if (this.#destroyed) return;
    this.#explicitContexts = contexts;
    this.#effectiveContexts =
      contexts ?? (this.#explicitItems ? undefined : defaultBubbleContexts(this.#editor));
    this.#updateResolvedItems();
    this.#updateStates();
    this.#scheduleRender();
  }

  /** Replace the icon set. `undefined` restores default Phosphor icons. */
  setIcons(icons: IconSet | undefined): void {
    if (this.#destroyed) return;
    this.#icons = icons;
    // Icons live in innerHTML where the state-only render never looks: the
    // "..." trigger and an open panel. Rebuild, as the toolbar does; a
    // consumer call catches no press.
    this.#structureKey = null;
    this.#scheduleRender();
  }

  /** Close any open dropdown (text-align). No-op if nothing is open. */
  closeDropdown(): void {
    if (this.#openDropdown === null) return;
    const prev = this.#openDropdown;
    this.#openDropdown = null;
    this.#detachDropdown();
    this.dispatchEvent(new CustomEvent('dropdownclose', { detail: { name: prev } }));
    this.#scheduleRender();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    cancelAnimationFrame(this.#renderRaf);
    this.#detachDropdown();

    if (this.#transactionHandler) {
      this.#editor.off('transaction', this.#transactionHandler);
      this.#transactionHandler = null;
    }
    if (!this.#editor.isDestroyed) {
      this.#editor.unregisterPlugin(this.#pluginKey);
    }

    this.host.replaceChildren();
  }

  // === Init ===

  #init(): void {
    const ed = this.#editor;
    if (ed.isDestroyed) return;

    // Cache extension presence (immutable per editor lifetime)
    const exts = ed.extensionManager.extensions;
    this.#hasNotionColorPicker = exts.some((e) => e.name === 'notionColorPicker');
    this.#hasBlockContextMenu = exts.some((e) => e.name === 'blockContextMenu');

    // Build item maps + bubble defaults
    this.#maps = buildBubbleItemMaps(ed);

    // Resolve effective contexts
    this.#effectiveContexts =
      this.#explicitContexts ?? (this.#explicitItems ? undefined : defaultBubbleContexts(ed));

    // Resolve default item list (used when contexts disabled and no NodeSelection match)
    this.#defaultItemList = this.#explicitItems
      ? resolveBubbleNames(this.#explicitItems, this.#maps.itemMap, this.#maps.dropdownMap)
      : resolveBubbleNames(['bold', 'italic', 'underline'], this.#maps.itemMap, this.#maps.dropdownMap);

    // Register the visibility/positioning plugin
    const shouldShow = this.#shouldShowOpt ?? this.#buildDefaultShouldShow();
    const plugin = createBubbleMenuPlugin({
      pluginKey: this.#pluginKey,
      editor: ed,
      element: this.host,
      shouldShow,
      placement: this.#placement,
      offset: this.#offset,
      updateDelay: this.#updateDelay,
    });
    ed.registerPlugin(plugin);

    // Initial item resolution + state sync
    this.#updateResolvedItems();
    this.#updateStates();
    this.#trailing = computeTrailingState(ed, {
      hasNotionColorPicker: this.#hasNotionColorPicker,
      hasBlockContextMenu: this.#hasBlockContextMenu,
    });

    // Transaction handler - resolves items + recomputes state per change.
    // rAF-batched render below dedups multiple consecutive transactions.
    this.#transactionHandler = (): void => {
      if (this.#destroyed) return;
      this.#updateResolvedItems();
      this.#updateStates();
      this.#trailing = computeTrailingState(ed, {
        hasNotionColorPicker: this.#hasNotionColorPicker,
        hasBlockContextMenu: this.#hasBlockContextMenu,
      });
      this.#scheduleRender();
    };
    ed.on('transaction', this.#transactionHandler);

    // Initial paint
    this.#render();
  }

  #buildDefaultShouldShow(): BubbleMenuOptions['shouldShow'] {
    const maps = this.#maps;
    if (!maps) return () => false;
    return createBubbleShouldShow(maps, this.#effectiveContexts);
  }

  // === State updates (called per transaction) ===

  /**
   * One call per transaction, into the resolver core owns. Every renderer
   * asks the same question and has to get the same answer, so the answer is
   * not written here.
   */
  #updateResolvedItems(): void {
    const maps = this.#maps;
    if (!maps) {
      this.#resolvedItems = [];
      return;
    }
    this.#resolvedItems = resolveBubbleMenuItems({
      editor: this.#editor,
      maps,
      contexts: this.#effectiveContexts,
      fallbackItems: this.#defaultItemList,
    });
  }

  #updateStates(): void {
    const ed = this.#editor;
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try {
      canProxy = ed.can() as unknown as Record<string, (...args: unknown[]) => boolean>;
    } catch {
      canProxy = null;
    }

    const trackButton = (btn: ToolbarButton): void => {
      this.#activeMap.set(btn.name, ToolbarController.resolveActive(ed as never, btn));
      try {
        const canCmd = typeof btn.command === 'string' ? canProxy?.[btn.command] : undefined;
        this.#disabledMap.set(
          btn.name,
          canCmd
            ? !(btn.commandArgs?.length ? canCmd(...btn.commandArgs) : canCmd())
            : false,
        );
      } catch {
        this.#disabledMap.set(btn.name, false);
      }
    };

    for (const item of this.#resolvedItems) {
      if (item.type === 'separator') continue;
      if (item.type === 'dropdown') {
        for (const sub of item.items) trackButton(sub);
        continue;
      }
      trackButton(item);
    }
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

  /** Signature of what decides which nodes exist; equal keys reuse the DOM. */
  #computeStructureKey(): string {
    const items = this.#resolvedItems
      .map((item) =>
        item.type === 'dropdown'
          ? `${item.type}:${item.name}:${item.items.map((sub) => sub.name).join(',')}`
          : `${item.type}:${item.name}`,
      )
      .join('|');
    const t = this.#trailing;
    return [
      items,
      t.showColorPickerButton && !t.isNodeSelection ? 'color' : '',
      t.showBlockMenuButton && !t.isNodeSelection ? 'block' : '',
      this.#customContent ? 'custom' : '',
    ].join('#');
  }

  /**
   * Runs on every transaction, and pointer motion alone dispatches those. A
   * render lands a frame late, so rebuilding wholesale can replace a button
   * between mousedown and mouseup: the two events share no element and the
   * browser fires no click at all. Structure only on an item-list change,
   * state in place otherwise, as the toolbar does.
   */
  #render(): void {
    // A dropdown whose trigger left the item list cannot stay open.
    if (this.#openDropdown !== null) {
      const stillExists = this.#resolvedItems.some(
        (item) => item.type === 'dropdown' && item.name === this.#openDropdown,
      );
      if (!stillExists) {
        this.#openDropdown = null;
        this.#detachDropdown();
      }
    }

    const key = this.#computeStructureKey();
    if (key === this.#structureKey) {
      this.#updateButtons();
    } else {
      this.#renderStructure();
      this.#structureKey = key;
    }
    this.#syncDropdownPanel();
  }

  #renderStructure(): void {
    this.host.replaceChildren();
    this.#buttonEls.clear();
    this.#colorTriggerEl = null;
    this.#blockMenuTriggerEl = null;
    // replaceChildren() took the panel; `#openDropdown` survives and
    // `#syncDropdownPanel` rebuilds it under the new trigger.
    this.#detachDropdown();

    for (const item of this.#resolvedItems) {
      if (item.type === 'separator') {
        this.host.appendChild(this.#createSeparator(item.name));
      } else if (item.type === 'dropdown') {
        this.host.appendChild(this.#createDropdownTrigger(item));
      } else {
        this.host.appendChild(this.#createButton(item));
      }
    }

    /* Trailing buttons (gated on extension presence + not NodeSelection).
       Each leads with a separator only when something is already standing to
       its left: the resolved list can be empty, and `collapseSeparators`
       cannot see these because they are appended after it has run. */
    const t = this.#trailing;
    const showColor = t.showColorPickerButton && !t.isNodeSelection;
    const showBlock = t.showBlockMenuButton && !t.isNodeSelection;
    if (showColor) {
      if (this.#resolvedItems.length > 0) {
        this.host.appendChild(this.#createSeparator('trailing-sep-color'));
      }
      this.host.appendChild(this.#createColorTrigger());
    }
    if (showBlock) {
      if (this.#resolvedItems.length > 0 || showColor) {
        this.host.appendChild(this.#createSeparator('trailing-sep-block'));
      }
      this.host.appendChild(this.#createBlockMenuTrigger());
    }

    // Consumer-provided customContent: appended LAST so it sits after the
    // default items + trailing. The wrapper does not own its lifecycle - its
    // event listeners survive each render because the same DOM reference is
    // re-appended (DOM listeners attach to nodes, not parents).
    if (this.#customContent) {
      this.host.appendChild(this.#customContent);
    }
  }

  #createSeparator(name: string): HTMLSpanElement {
    const sep = document.createElement('span');
    sep.className = 'dm-toolbar-separator';
    sep.setAttribute('role', 'separator');
    sep.dataset['name'] = name;
    return sep;
  }

  #createButton(item: ToolbarButton): HTMLButtonElement {
    const isActive = this.#activeMap.get(item.name) ?? false;
    const isDisabled = this.#disabledMap.get(item.name) ?? false;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-toolbar-button';
    if (isActive) btn.classList.add('dm-toolbar-button--active');
    btn.disabled = isDisabled;
    btn.setAttribute('aria-label', item.label);
    btn.setAttribute('aria-pressed', String(isActive));
    btn.title = item.label;
    this.#setIconHtml(btn, resolveIcon(item.icon, this.#icons));

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', (e) => { this.#onButtonClick(item, e); });
    this.#buttonEls.set(item.name, btn);
    return btn;
  }

  #createDropdownTrigger(dd: ToolbarDropdown): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dm-toolbar-dropdown-wrapper';
    wrapper.dataset['dropdownWrapper'] = dd.name;

    const dropdownActive = dd.items.some((sub) => this.#activeMap.get(sub.name) ?? false);
    const activeChild = dd.dynamicIcon
      ? dd.items.find((sub) => this.#activeMap.get(sub.name) ?? false)
      : undefined;
    const triggerIcon = activeChild?.icon ?? dd.icon;
    const triggerHtml = resolveIcon(triggerIcon, this.#icons) + DROPDOWN_CARET;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dm-toolbar-button dm-toolbar-dropdown-trigger';
    if (dropdownActive) trigger.classList.add('dm-toolbar-button--active');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', String(this.#openDropdown === dd.name));
    trigger.setAttribute('aria-label', dd.label);
    trigger.title = dd.label;
    trigger.dataset['dropdown'] = dd.name;
    this.#setIconHtml(trigger, triggerHtml);
    trigger.addEventListener('mousedown', (e) => { e.preventDefault(); });
    trigger.addEventListener('click', () => { this.#onDropdownToggle(dd); });

    wrapper.appendChild(trigger);
    this.#buttonEls.set(dd.name, trigger);
    // `#syncDropdownPanel` owns the panel, so opening one rebuilds nothing.
    return wrapper;
  }

  #createDropdownPanel(dd: ToolbarDropdown): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'dm-toolbar-dropdown-panel';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('data-dm-editor-ui', '');
    panel.dataset['dropdownPanel'] = dd.name;

    for (const sub of dd.items) {
      const subActive = this.#activeMap.get(sub.name) ?? false;
      const subHtml = `${resolveIcon(sub.icon, this.#icons)} ${sub.label}`;
      const subBtn = document.createElement('button');
      subBtn.type = 'button';
      subBtn.className = 'dm-toolbar-dropdown-item';
      if (subActive) subBtn.classList.add('dm-toolbar-dropdown-item--active');
      subBtn.setAttribute('role', 'menuitem');
      subBtn.setAttribute('aria-label', sub.label);
      subBtn.dataset['dropdownItem'] = sub.name;
      subBtn.innerHTML = subHtml;
      subBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      subBtn.addEventListener('click', () => { this.#onDropdownItemClick(sub); });
      panel.appendChild(subBtn);
    }
    return panel;
  }

  #createColorTrigger(): HTMLButtonElement {
    const t = this.#trailing;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-toolbar-button dm-ncp-trigger';
    if (t.hasAnyColor) btn.classList.add('dm-toolbar-button--active');
    btn.title = 'Text and background color';
    btn.setAttribute('aria-label', 'Text and background color');
    btn.setAttribute('aria-haspopup', 'dialog');

    const glyph = document.createElement('span');
    glyph.className = 'dm-ncp-trigger-glyph';
    glyph.textContent = 'A';
    if (t.currentTextColorVar) glyph.style.color = t.currentTextColorVar;
    btn.appendChild(glyph);

    const underline = document.createElement('span');
    underline.className = 'dm-ncp-trigger-underline';
    if (t.currentBgColorVar) underline.style.backgroundColor = t.currentBgColorVar;
    btn.appendChild(underline);

    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', () => { this.openColorPicker(btn); });
    this.#colorTriggerEl = btn;
    return btn;
  }

  #createBlockMenuTrigger(): HTMLButtonElement {
    const t = this.#trailing;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-toolbar-button';
    btn.disabled = t.blockMenuButtonDisabled;
    btn.title = t.blockMenuButtonDisabled
      ? 'Block actions (select within a single block)'
      : 'More options';
    btn.setAttribute('aria-label', 'More options');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.innerHTML = resolveIcon('dotsThree', this.#icons);
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    btn.addEventListener('click', () => { this.openBlockContextMenu(btn); });
    this.#blockMenuTriggerEl = btn;
    return btn;
  }

  // === In-place updates (the common render) ===

  #updateButtons(): void {
    for (const item of this.#resolvedItems) {
      if (item.type === 'separator') continue;
      const el = this.#buttonEls.get(item.name);
      if (!el) continue;
      if (item.type === 'dropdown') this.#updateDropdownTrigger(item, el);
      else this.#updateButton(item, el);
    }

    const t = this.#trailing;
    if (this.#colorTriggerEl) {
      this.#colorTriggerEl.classList.toggle('dm-toolbar-button--active', t.hasAnyColor);
      const glyph = this.#colorTriggerEl.querySelector<HTMLElement>('.dm-ncp-trigger-glyph');
      if (glyph) glyph.style.color = t.currentTextColorVar ?? '';
      const underline = this.#colorTriggerEl.querySelector<HTMLElement>('.dm-ncp-trigger-underline');
      if (underline) underline.style.backgroundColor = t.currentBgColorVar ?? '';
    }
    if (this.#blockMenuTriggerEl) {
      this.#blockMenuTriggerEl.disabled = t.blockMenuButtonDisabled;
      this.#blockMenuTriggerEl.title = t.blockMenuButtonDisabled
        ? 'Block actions (select within a single block)'
        : 'More options';
    }
  }

  #updateButton(item: ToolbarButton, btn: HTMLButtonElement): void {
    const isActive = this.#activeMap.get(item.name) ?? false;
    const isDisabled = this.#disabledMap.get(item.name) ?? false;
    btn.classList.toggle('dm-toolbar-button--active', isActive);
    btn.disabled = isDisabled;
    btn.setAttribute('aria-pressed', String(isActive));
    this.#setIconHtml(btn, resolveIcon(item.icon, this.#icons));
  }

  /** Writes icon markup only when it differs from what was written last. */
  #setIconHtml(el: HTMLElement, html: string): void {
    if (this.#iconHtml.get(el) === html) return;
    this.#iconHtml.set(el, html);
    el.innerHTML = html;
  }

  #updateDropdownTrigger(dd: ToolbarDropdown, trigger: HTMLButtonElement): void {
    const dropdownActive = dd.items.some((sub) => this.#activeMap.get(sub.name) ?? false);
    const activeChild = dd.dynamicIcon
      ? dd.items.find((sub) => this.#activeMap.get(sub.name) ?? false)
      : undefined;
    const html = resolveIcon(activeChild?.icon ?? dd.icon, this.#icons) + DROPDOWN_CARET;
    trigger.classList.toggle('dm-toolbar-button--active', dropdownActive);
    trigger.setAttribute('aria-expanded', String(this.#openDropdown === dd.name));
    this.#setIconHtml(trigger, html);
  }

  /** Builds the open dropdown's panel, or refreshes the marks on an open one. */
  #syncDropdownPanel(): void {
    const open = this.#openDropdown;
    if (open === null) {
      if (this.#dropdownPanelEl) this.#detachDropdown();
      return;
    }

    const dd = this.#resolvedItems.find(
      (item): item is ToolbarDropdown => item.type === 'dropdown' && item.name === open,
    );
    if (!dd) return;

    const panel = this.#dropdownPanelEl;
    if (panel?.isConnected === true) {
      for (const sub of dd.items) {
        const subBtn = panel.querySelector<HTMLElement>(`[data-dropdown-item="${sub.name}"]`);
        subBtn?.classList.toggle(
          'dm-toolbar-dropdown-item--active',
          this.#activeMap.get(sub.name) ?? false,
        );
      }
      return;
    }

    const trigger = this.#buttonEls.get(open);
    const wrapper = trigger?.parentElement;
    if (!trigger || !wrapper) return;
    const fresh = this.#createDropdownPanel(dd);
    wrapper.appendChild(fresh);
    this.#dropdownPanelEl = fresh;
    this.#attachDropdownListeners(trigger, fresh);
  }

  // === Event handlers ===

  #onButtonClick(item: ToolbarButton, event: MouseEvent): void {
    if (this.#openDropdown) this.closeDropdown();

    if (item.emitEvent) {
      const anchor =
        (event.currentTarget as HTMLElement | null) ??
        (event.target as HTMLElement | null);
      (this.#editor.emit as (e: string, d: unknown) => void)(
        item.emitEvent,
        { anchorElement: anchor },
      );
      return;
    }
    ToolbarController.executeItem(this.#editor as never, item);
  }

  #onDropdownToggle(dd: ToolbarDropdown): void {
    if (this.#openDropdown === dd.name) {
      this.closeDropdown();
      return;
    }

    // Switching from another open dropdown - emit close for the previous one.
    if (this.#openDropdown !== null) {
      const prev = this.#openDropdown;
      this.#detachDropdown();
      this.dispatchEvent(new CustomEvent('dropdownclose', { detail: { name: prev } }));
    }

    this.#openDropdown = dd.name;
    this.dispatchEvent(new CustomEvent('dropdownopen', { detail: { name: dd.name } }));
    // Re-render to insert the panel under the new trigger.
    this.#render();
  }

  #onDropdownItemClick(sub: ToolbarButton): void {
    this.closeDropdown();
    ToolbarController.executeItem(this.#editor as never, sub);
    refocusEditorAfterCommand(this.#editor.view);
  }

  // === Dropdown lifecycle ===

  #attachDropdownListeners(trigger: HTMLButtonElement, panel: HTMLDivElement): void {
    // Position the panel relative to its trigger.
    this.#cleanupDropdownFloating?.();
    this.#cleanupDropdownFloating = positionFloatingOnce(trigger, panel, {
      placement: 'bottom-start',
      offsetValue: 4,
    });

    // Scoped AbortController for outside-click / Escape / cooperative dismissal
    this.#dropdownAbortCtl?.abort();
    this.#dropdownAbortCtl = new AbortController();
    const { signal } = this.#dropdownAbortCtl;

    document.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (panel.contains(target)) return;
        if (trigger.contains(target)) return;
        this.closeDropdown();
      },
      { signal },
    );

    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeDropdown();
        }
      },
      { signal },
    );

    // Cooperative dismissal - other overlays announce, we listen and close.
    // We do NOT dispatch this ourselves - the bubble menu plugin listens
    // for it and would hide, taking our trigger with it.
    const editorEl = this.#editor.view.dom.closest<HTMLElement>('.dm-editor');
    editorEl?.addEventListener(
      'dm:dismiss-overlays',
      () => { this.closeDropdown(); },
      { signal },
    );
  }

  #detachDropdown(): void {
    this.#cleanupDropdownFloating?.();
    this.#cleanupDropdownFloating = null;
    this.#dropdownAbortCtl?.abort();
    this.#dropdownAbortCtl = null;
    this.#dropdownPanelEl?.remove();
    this.#dropdownPanelEl = null;
  }
}
