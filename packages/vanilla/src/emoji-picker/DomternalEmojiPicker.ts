import { positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';

export interface EmojiPickerItem {
  emoji: string;
  name: string;
  group: string;
}

/** Display glyph for each top-level emoji category (matches Angular wrapper). */
const CATEGORY_ICONS: Record<string, string> = {
  'Smileys & Emotion': '\u{1F600}',
  'People & Body': '\u{1F44B}',
  'Animals & Nature': '\u{1F431}',
  'Food & Drink': '\u{1F355}',
  'Travel & Places': '\u{1F697}',
  Activities: '\u{26BD}',
  Objects: '\u{1F4A1}',
  Symbols: '\u{1F523}',
  Flags: '\u{1F3C1}',
};

/**
 * Delay before focusing a swatch after scrollTo - prevents onGridScroll from
 * overwriting activeCategory during the browser's native scroll settle.
 */
const SCROLL_SETTLE_MS = 50;

export interface DomternalEmojiPickerOptions {
  /** The editor instance the picker binds to. */
  editor: Editor;
  /** Full emoji set with `{ emoji, name, group }` entries. Required. */
  emojis: EmojiPickerItem[];
}

/**
 * `DomternalEmojiPicker` - vanilla DOM emoji picker.
 *
 * Listens for the `insertEmoji` editor event (emitted by the toolbar's emoji
 * trigger or via custom code) and renders a panel with search input, category
 * tabs, and an 8-column grid of swatches. Frequently-used emojis come from
 * the `Emoji` extension's storage if available.
 *
 * @example
 * ```ts
 * import { DomternalEmojiPicker } from '@domternal/vanilla';
 * import { emojis } from '@domternal/extension-emoji';
 *
 * const picker = new DomternalEmojiPicker(host, { editor, emojis });
 *
 * // picker.open(anchor) opens programmatically; usually triggered
 * // implicitly by the `insertEmoji` editor event.
 *
 * picker.destroy();
 * ```
 *
 * **Events dispatched** (CustomEvent, `detail` shape in brackets):
 * - `openchange` - `{ isOpen: boolean }`
 * - `select` - `{ name: string; emoji: string }`
 */
export class DomternalEmojiPicker extends EventTarget {
  readonly host: HTMLElement;

  get editor(): Editor {
    return this.#editor;
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  get searchQuery(): string {
    return this.#searchQuery;
  }

  get activeCategory(): string {
    return this.#activeCategory;
  }

  #editor: Editor;
  #emojis: EmojiPickerItem[];
  #categories: Map<string, EmojiPickerItem[]>;
  #categoryNames: string[];

  #destroyed = false;
  #isOpen = false;
  #searchQuery = '';
  #activeCategory = '';
  #anchor: HTMLElement | null = null;

  #panel: HTMLDivElement | null = null;
  #cleanupFloating: (() => void) | null = null;
  #openAbortCtl: AbortController | null = null;
  #eventHandler: ((...args: unknown[]) => void) | null = null;

  constructor(host: HTMLElement, options: DomternalEmojiPickerOptions) {
    super();
    assertBrowser('DomternalEmojiPicker');

    if (!(host instanceof HTMLElement)) {
      throw new TypeError(
        '[DomternalEmojiPicker] host must be an HTMLElement. ' +
          'Pass a DOM node (e.g. document.querySelector("#emoji-host")).'
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.editor) {
      throw new TypeError('[DomternalEmojiPicker] options.editor is required.');
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.emojis) {
      throw new TypeError('[DomternalEmojiPicker] options.emojis is required.');
    }

    this.host = host;
    this.#editor = options.editor;
    this.#emojis = options.emojis;

    // Group emojis by their `group` property (immutable per construction).
    this.#categories = new Map<string, EmojiPickerItem[]>();
    for (const item of this.#emojis) {
      let list = this.#categories.get(item.group);
      if (!list) {
        list = [];
        this.#categories.set(item.group, list);
      }
      list.push(item);
    }
    this.#categoryNames = [...this.#categories.keys()];

    this.host.classList.add('dm-emoji-picker-host');

    // Subscribe to insertEmoji event (not AbortSignal-aware; explicit off in destroy)
    this.#eventHandler = (...args: unknown[]): void => {
      const data = args[0] as { anchorElement?: HTMLElement } | undefined;
      if (this.#isOpen) {
        this.close();
        return;
      }
      this.open(data?.anchorElement ?? null);
    };
    (this.#editor.on as (e: string, h: (...args: unknown[]) => void) => void)(
      'insertEmoji',
      this.#eventHandler
    );
  }

  // === Public API ===

  /**
   * Open the picker. If `anchor` is provided, panel positions against it;
   * otherwise the panel renders un-positioned inside the host (consumer's CSS
   * responsibility).
   */
  open(anchor: HTMLElement | null): void {
    if (this.#destroyed || this.#isOpen) return;
    this.#anchor = anchor;
    this.#isOpen = true;
    this.#searchQuery = '';
    if (this.#categoryNames[0]) {
      this.#activeCategory = this.#categoryNames[0];
    }
    this.#setStorageOpen(true);

    this.#renderPanel();
    this.#attachGlobalListeners();
    this.#positionAndFocus();
    this.dispatchEvent(new CustomEvent('openchange', { detail: { isOpen: true } }));
  }

  /**
   * Close the picker. Returns focus to the editor view (so the caret stays
   * visible). Idempotent.
   */
  close(): void {
    if (!this.#isOpen) return;
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#isOpen = false;
    this.#setStorageOpen(false);
    this.#searchQuery = '';
    this.#anchor = null;
    this.#detachGlobalListeners();
    this.#panel?.remove();
    this.#panel = null;
    if (!this.#editor.isDestroyed) {
      this.#editor.view.focus();
    }
    this.dispatchEvent(new CustomEvent('openchange', { detail: { isOpen: false } }));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#detachGlobalListeners();
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;

    if (this.#eventHandler) {
      (this.#editor.off as (e: string, h: (...args: unknown[]) => void) => void)(
        'insertEmoji',
        this.#eventHandler
      );
      this.#eventHandler = null;
    }
    if (this.#isOpen) this.#setStorageOpen(false);
    this.#panel?.remove();
    this.#panel = null;
    this.#isOpen = false;
  }

  // === Internal ===

  /** Title-cased emoji name for tooltip/aria-label (replaces underscores). */
  #formatName(name: string): string {
    return name.replace(/_/g, ' ');
  }

  /** Display glyph for a category tab. Falls back to first character. */
  #categoryIcon(cat: string): string {
    return CATEGORY_ICONS[cat] ?? cat.charAt(0);
  }

  #getEmojiStorage(): Record<string, unknown> | null {
    const storage = this.#editor.storage;
    return (storage['emoji'] as Record<string, unknown> | undefined) ?? null;
  }

  #setStorageOpen(open: boolean): void {
    const storage = this.#getEmojiStorage();
    if (storage) storage['isOpen'] = open;
    // No-op transaction so toolbar's transaction handler re-evaluates
    // `isActiveFn` and marks the emoji button as active/inactive.
    if (!this.#editor.isDestroyed) {
      this.#editor.view.dispatch(this.#editor.view.state.tr);
    }
  }

  #getFilteredEmojis(): EmojiPickerItem[] {
    const query = this.#searchQuery.toLowerCase();
    if (!query) return [];
    const storage = this.#getEmojiStorage();
    const searchFn = storage?.['searchEmoji'] as ((q: string) => EmojiPickerItem[]) | undefined;
    if (searchFn) return searchFn(query);
    return this.#emojis.filter(
      (item) => item.name.includes(query) || item.group.toLowerCase().includes(query)
    );
  }

  #getFrequentlyUsed(): EmojiPickerItem[] {
    const storage = this.#getEmojiStorage();
    if (!storage) return [];
    const getFreq = storage['getFrequentlyUsed'] as (() => string[]) | undefined;
    if (!getFreq) return [];
    const names = getFreq();
    if (!names.length) return [];
    const nameMap = storage['_nameMap'] as Map<string, EmojiPickerItem> | undefined;
    if (!nameMap) return [];
    return names
      .slice(0, 16)
      .map((n) => nameMap.get(n))
      .filter((v): v is EmojiPickerItem => Boolean(v));
  }

  /** Render or refresh the picker panel inside `host`. */
  #renderPanel(): void {
    if (!this.#panel) {
      this.#panel = this.#createPanel();
      this.host.appendChild(this.#panel);
    } else {
      this.#panel.replaceChildren(...this.#renderPanelChildren());
    }
  }

  #createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'dm-emoji-picker';
    panel.append(...this.#renderPanelChildren());
    return panel;
  }

  #renderPanelChildren(): Node[] {
    return [this.#renderSearch(), this.#renderTabs(), this.#renderGrid()];
  }

  #renderSearch(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dm-emoji-picker-search';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search emoji...';
    input.value = this.#searchQuery;
    input.setAttribute('aria-label', 'Search emoji');
    input.addEventListener('input', (e) => {
      this.#searchQuery = (e.target as HTMLInputElement).value;
      this.#refreshGrid();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  #renderTabs(): HTMLDivElement {
    const tabs = document.createElement('div');
    tabs.className = 'dm-emoji-picker-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const cat of this.#categoryNames) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'dm-emoji-picker-tab';
      if (this.#activeCategory === cat) {
        tab.classList.add('dm-emoji-picker-tab--active');
      }
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this.#activeCategory === cat));
      tab.title = cat;
      tab.setAttribute('aria-label', cat);
      tab.textContent = this.#categoryIcon(cat);
      tab.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      tab.addEventListener('click', () => {
        this.#scrollToCategory(cat);
      });
      tabs.appendChild(tab);
    }
    return tabs;
  }

  #renderGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'dm-emoji-picker-grid';
    grid.addEventListener('scroll', () => {
      this.#onGridScroll();
    });
    grid.addEventListener('keydown', (e) => {
      this.#onGridKeydown(e);
    });

    if (this.#searchQuery) {
      const filtered = this.#getFilteredEmojis();
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-emoji-picker-empty';
        empty.textContent = 'No emoji found';
        grid.appendChild(empty);
      } else {
        for (const item of filtered) {
          grid.appendChild(this.#createSwatch(item));
        }
      }
      return grid;
    }

    // Default view: frequently used + categories
    const freq = this.#getFrequentlyUsed();
    if (freq.length) {
      const freqLabel = document.createElement('div');
      freqLabel.className = 'dm-emoji-picker-category-label';
      freqLabel.textContent = 'Frequently Used';
      grid.appendChild(freqLabel);
      for (const item of freq) {
        grid.appendChild(this.#createSwatch(item));
      }
    }

    for (const cat of this.#categoryNames) {
      const label = document.createElement('div');
      label.className = 'dm-emoji-picker-category-label';
      label.dataset['category'] = cat;
      label.textContent = cat;
      grid.appendChild(label);
      const items = this.#categories.get(cat) ?? [];
      for (const item of items) {
        grid.appendChild(this.#createSwatch(item));
      }
    }
    return grid;
  }

  #createSwatch(item: EmojiPickerItem): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-emoji-swatch';
    btn.tabIndex = -1;
    btn.title = this.#formatName(item.name);
    btn.setAttribute('aria-label', this.#formatName(item.name));
    btn.textContent = item.emoji;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('click', () => {
      this.#selectEmoji(item);
    });
    return btn;
  }

  /**
   * Update `searchQuery` field AND sync the DOM input value. Centralised
   * so all callers see a consistent state - field is the source of truth
   * but the input element doesn't track it automatically.
   */
  #setSearchQuery(value: string): void {
    this.#searchQuery = value;
    const input = this.#panel?.querySelector<HTMLInputElement>('.dm-emoji-picker-search input');
    if (input && input.value !== value) input.value = value;
  }

  /** Replace grid contents only (used when searchQuery changes). */
  #refreshGrid(): void {
    if (!this.#panel) return;
    const oldGrid = this.#panel.querySelector('.dm-emoji-picker-grid');
    const newGrid = this.#renderGrid();
    oldGrid?.replaceWith(newGrid);
  }

  #refreshTabs(): void {
    if (!this.#panel) return;
    const oldTabs = this.#panel.querySelector('.dm-emoji-picker-tabs');
    const newTabs = this.#renderTabs();
    oldTabs?.replaceWith(newTabs);
  }

  #selectEmoji(item: EmojiPickerItem): void {
    const cmd = this.#editor.commands as Record<string, (...args: unknown[]) => boolean>;
    cmd['insertEmoji']?.(item.name);
    this.dispatchEvent(
      new CustomEvent('select', { detail: { name: item.name, emoji: item.emoji } })
    );
    this.close();
  }

  #scrollToCategory(cat: string): void {
    // Clear search to ensure category view is rendered (not filtered)
    if (cat !== this.#activeCategory) this.#setSearchQuery('');
    this.#activeCategory = cat;
    this.#refreshTabs();
    this.#refreshGrid();

    // Wait for grid to be in DOM, then scroll + focus
    requestAnimationFrame(() => {
      const grid = this.#panel?.querySelector<HTMLElement>('.dm-emoji-picker-grid');
      if (!grid) return;
      const label = grid.querySelector<HTMLElement>(`[data-category="${cat}"]`);
      if (!label) return;
      grid.scrollTo({ top: label.offsetTop - grid.offsetTop });
      setTimeout(() => {
        const first = label.nextElementSibling;
        if (first instanceof HTMLElement && first.classList.contains('dm-emoji-swatch')) {
          first.focus();
        }
      }, SCROLL_SETTLE_MS);
    });
  }

  #onGridScroll(): void {
    if (this.#searchQuery) return;
    const grid = this.#panel?.querySelector<HTMLElement>('.dm-emoji-picker-grid');
    if (!grid) return;
    const labels = Array.from(
      grid.querySelectorAll<HTMLElement>('.dm-emoji-picker-category-label[data-category]')
    );
    let currentCat = '';
    for (const label of labels) {
      if (label.offsetTop - grid.offsetTop <= grid.scrollTop + 20) {
        currentCat = label.getAttribute('data-category') ?? '';
      }
    }
    if (currentCat && currentCat !== this.#activeCategory) {
      this.#activeCategory = currentCat;
      this.#refreshTabs();
    }
  }

  #onGridKeydown(event: KeyboardEvent): void {
    const grid = this.#panel?.querySelector<HTMLElement>('.dm-emoji-picker-grid');
    if (!grid) return;
    const swatches = Array.from(grid.querySelectorAll<HTMLElement>('.dm-emoji-swatch'));
    if (!swatches.length) return;

    const active = document.activeElement;
    const idx = active instanceof HTMLElement ? swatches.indexOf(active) : -1;
    if (idx === -1) {
      // Focus is somewhere else (e.g. grid container) - enter the grid
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        swatches[0]?.focus();
      }
      return;
    }
    const cols = 8;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        next = Math.min(idx + 1, swatches.length - 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        next = Math.max(idx - 1, 0);
        break;
      case 'ArrowDown':
        event.preventDefault();
        next = Math.min(idx + cols, swatches.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        next = Math.max(idx - cols, 0);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        swatches[idx]?.click();
        return;
      default:
        return;
    }
    swatches[next]?.focus();
  }

  #positionAndFocus(): void {
    requestAnimationFrame(() => {
      if (!this.#panel || this.#destroyed) return;
      if (this.#anchor) {
        this.#cleanupFloating?.();
        this.#cleanupFloating = positionFloatingOnce(this.#anchor, this.#panel, {
          placement: 'bottom',
          offsetValue: 4,
        });
      }
      const input = this.#panel.querySelector<HTMLInputElement>('.dm-emoji-picker-search input');
      input?.focus({ preventScroll: true });
    });
  }

  #attachGlobalListeners(): void {
    this.#openAbortCtl?.abort();
    this.#openAbortCtl = new AbortController();
    const { signal } = this.#openAbortCtl;

    document.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        const target = e.target as Node | null;
        if (!target || !this.#isOpen) return;
        if (this.#panel?.contains(target)) return;
        if (target === this.#anchor) return;
        if (this.#anchor?.contains(target)) return;
        // Defer close so the click handler on a panel descendant fires first
        requestAnimationFrame(() => {
          this.close();
        });
      },
      { signal }
    );

    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.#isOpen) {
          e.preventDefault();
          this.close();
        }
      },
      { signal }
    );
  }

  #detachGlobalListeners(): void {
    this.#openAbortCtl?.abort();
    this.#openAbortCtl = null;
  }
}
