import { positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';

interface NotionColorPickerStorage {
  isOpen: boolean;
}

interface NotionColorPickerExtensionOptions {
  palette?: readonly string[];
}

interface NotionColorOpenDetail {
  anchorElement?: HTMLElement;
}

/**
 * Display labels for the named-token palette. Used in tooltips / aria labels;
 * unknown tokens fall back to a title-cased version of the raw key.
 */
const TOKEN_LABELS: Record<string, string> = {
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
};

export interface DomternalNotionColorPickerOptions {
  /** The editor instance the picker binds to. */
  editor: Editor;
}

/**
 * `DomternalNotionColorPicker` - vanilla DOM Notion-style color picker.
 *
 * Listens for the `notionColorOpen` editor event (emitted by the bubble menu's
 * "A" trigger) and renders an inline panel positioned against the trigger.
 * Two sections (Text color / Background color), each with a 5-column grid of
 * named-token swatches plus a default reset swatch.
 *
 * The panel is appended into the `.dm-editor` host so CSS variables
 * (`--dm-block-text-{token}`, `--dm-block-bg-{token}`) cascade naturally
 * from the editor's theme scope. **Requires the editor view to be inside a
 * `.dm-editor` host** (matches `@domternal/theme` convention). When that
 * ancestor is missing the picker silently no-ops on open.
 *
 * Unlike other `@domternal/vanilla` components, this class does NOT take a
 * `host` element argument - it auto-resolves the `.dm-editor` parent. The
 * resolved host is exposed via the `host` getter for power-user inspection.
 *
 * @example
 * ```ts
 * import { DomternalNotionColorPicker } from '@domternal/vanilla';
 *
 * const picker = new DomternalNotionColorPicker({ editor });
 *
 * // picker.open(anchor) opens programmatically; usually called by the
 * // bubble menu's "A" trigger via the `notionColorOpen` editor event.
 *
 * picker.destroy();
 * ```
 *
 * **Events dispatched** (CustomEvent, `detail` shape in brackets):
 * - `openchange` - `{ isOpen: boolean }`
 * - `apply` - `{ kind: 'text' | 'bg', token: string | null }`
 */
export class DomternalNotionColorPicker extends EventTarget {
  /** The picker's panel element (created on first open, persistent for reuse). */
  get panel(): HTMLDivElement | null {
    return this.#panel;
  }

  /**
   * The `.dm-editor` host into which the panel mounts. Auto-resolved from
   * `editor.view.dom.closest('.dm-editor')`. Returns `null` when the editor
   * view is not inside a `.dm-editor` ancestor (in which case the picker
   * silently no-ops on `open()`).
   */
  get host(): HTMLElement | null {
    return this.#host;
  }

  get editor(): Editor {
    return this.#editor;
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  get currentTextToken(): string | null {
    return this.#currentTextToken;
  }

  get currentBgToken(): string | null {
    return this.#currentBgToken;
  }

  get palette(): readonly string[] {
    return this.#palette;
  }

  #editor: Editor;
  #destroyed = false;

  #isOpen = false;
  #anchor: HTMLElement | null = null;
  #host: HTMLElement | null = null;
  #panel: HTMLDivElement | null = null;
  #currentTextToken: string | null = null;
  #currentBgToken: string | null = null;
  #palette: readonly string[] = [];

  #onOpen: ((...args: unknown[]) => void) | null = null;
  #onSelectionUpdate: (() => void) | null = null;
  /** Global listeners (mousedown + keydown + selectionUpdate) bound while open. */
  #openAbortCtl: AbortController | null = null;
  #cleanupFloating: (() => void) | null = null;
  #rafIds: number[] = [];

  constructor(options: DomternalNotionColorPickerOptions) {
    super();
    assertBrowser('DomternalNotionColorPicker');

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!options.editor) {
      throw new TypeError('[DomternalNotionColorPicker] options.editor is required.');
    }

    this.#editor = options.editor;
    this.#host = this.#editor.view.dom.closest<HTMLElement>('.dm-editor');

    // Read palette from extension options (immutable per editor lifetime)
    const ext = this.#editor.extensionManager.extensions.find(
      (e) => e.name === 'notionColorPicker',
    );
    const extOpts = (ext?.options ?? null) as NotionColorPickerExtensionOptions | null;
    this.#palette = extOpts?.palette ? [...extOpts.palette] : [];

    // Subscribe to editor events (not AbortSignal-aware; explicit off in destroy).
    // Toggle logic lives in `open()` so the public API and event handler
    // behave identically for same-anchor re-opens.
    this.#onOpen = (...args: unknown[]): void => {
      const detail = args[0] as NotionColorOpenDetail | undefined;
      const incoming = detail?.anchorElement;
      if (!incoming) return;
      this.open(incoming);
    };
    this.#onSelectionUpdate = (): void => {
      if (!this.#isOpen) return;
      // Anchor vanished (bubble menu hidden by selection change). Close defensively.
      // Matches commit fbef072 which brought this defense to Angular too.
      if (!this.#anchor?.isConnected) {
        this.close();
        return;
      }
      if (this.#editor.state.selection.empty) {
        this.close();
      } else {
        // Selection moved but stays non-empty - refresh active state.
        this.#syncFromSelection();
        this.#updateActiveClasses();
      }
    };
    this.#editor.on('notionColorOpen', this.#onOpen);
    this.#editor.on('selectionUpdate', this.#onSelectionUpdate);
  }

  // === Public API ===

  /**
   * Open the picker against the given anchor element. Typically called
   * implicitly via the `notionColorOpen` editor event, but exposed publicly
   * for power users who emit the open from custom UI.
   *
   * Toggle semantics: calling `open(anchor)` with the SAME anchor while the
   * picker is already open closes the picker (with refocus). Calling with a
   * different anchor re-anchors against the new element.
   */
  open(anchor: HTMLElement): void {
    if (this.#destroyed) return;
    // Toggle: same-anchor click while open closes (mirrors bubble menu "A"
    // button click-to-close behaviour). We accept BOTH exact DOM identity
    // OR class-based identity (`.dm-ncp-trigger`) because the bubble menu
    // rebuilds its trigger button on every transaction - the new instance
    // is a different DOM node but logically the same trigger.
    if (this.#isOpen && this.#isSameTrigger(anchor)) {
      this.close({ refocus: true });
      return;
    }
    // Lazy host resolution - in case editor view wasn't in DOM at construction.
    this.#host ??= this.#editor.view.dom.closest<HTMLElement>('.dm-editor');
    this.#anchor = anchor;
    this.#syncFromSelection();
    this.#isOpen = true;
    this.#setStorageOpen(true);
    this.#renderOrUpdatePanel();
    this.#positionAndFocus();
    this.#attachGlobalListeners();
    this.dispatchEvent(new CustomEvent('openchange', { detail: { isOpen: true } }));
  }

  /**
   * Close the picker. When `refocus` is `true`, returns focus to the editor
   * view (NOT the anchor button - the anchor is on the bubble menu which
   * vanishes on focus return).
   */
  close(opts: { refocus?: boolean } = {}): void {
    if (!this.#isOpen) return;
    this.#isOpen = false;
    this.#setStorageOpen(false);
    this.#detachGlobalListeners();
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#cancelPendingRafs();
    if (this.#panel) {
      this.#panel.remove();
      // Keep `#panel` for reuse on next open; just detach from DOM.
    }
    this.#anchor = null;
    if (opts.refocus && !this.#editor.isDestroyed) {
      this.#editor.view.focus();
    }
    this.dispatchEvent(new CustomEvent('openchange', { detail: { isOpen: false } }));
  }

  /** Apply a text color token to the current selection. Picker stays open. */
  applyText(token: string | null): void {
    if (this.#destroyed) return;
    (this.#editor.commands as unknown as {
      setTextColorToken: (t: string | null) => boolean;
    }).setTextColorToken(token);
    this.#syncFromSelection();
    this.#updateActiveClasses();
    this.dispatchEvent(
      new CustomEvent('apply', { detail: { kind: 'text', token } }),
    );
  }

  /** Apply a background color token to the current selection. Picker stays open. */
  applyBg(token: string | null): void {
    if (this.#destroyed) return;
    (this.#editor.commands as unknown as {
      setBackgroundColorToken: (t: string | null) => boolean;
    }).setBackgroundColorToken(token);
    this.#syncFromSelection();
    this.#updateActiveClasses();
    this.dispatchEvent(
      new CustomEvent('apply', { detail: { kind: 'bg', token } }),
    );
  }

  /** Display label for a palette token (title-case fallback). */
  tokenLabel(token: string): string {
    return TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#detachGlobalListeners();
    this.#cleanupFloating?.();
    this.#cleanupFloating = null;
    this.#cancelPendingRafs();

    if (this.#onOpen) {
      this.#editor.off('notionColorOpen', this.#onOpen);
      this.#onOpen = null;
    }
    if (this.#onSelectionUpdate) {
      this.#editor.off('selectionUpdate', this.#onSelectionUpdate);
      this.#onSelectionUpdate = null;
    }
    if (this.#isOpen) this.#setStorageOpen(false);
    this.#panel?.remove();
    this.#panel = null;
    this.#isOpen = false;
    this.#anchor = null;
  }

  // === Internal ===

  /**
   * Test whether the incoming anchor is functionally the same trigger as
   * the currently stored anchor.
   *
   * - Exact DOM identity is preferred (cheap + unambiguous).
   * - Fallback: both anchors are `.dm-ncp-trigger` buttons inside the SAME
   *   `.dm-bubble-menu` host. The bubble menu rebuilds its trigger button
   *   on every transaction (new DOM node, same logical trigger), so the
   *   ancestor check lets toggle-on-second-click work across rebuilds
   *   without conflating with custom triggers in other host elements.
   */
  #isSameTrigger(incoming: HTMLElement): boolean {
    if (this.#anchor === incoming) return true;
    if (!incoming.classList.contains('dm-ncp-trigger')) return false;
    if (!(this.#anchor?.classList.contains('dm-ncp-trigger') ?? false)) return false;
    const currentBubble = this.#anchor?.closest('.dm-bubble-menu') ?? null;
    const incomingBubble = incoming.closest('.dm-bubble-menu');
    return currentBubble !== null && currentBubble === incomingBubble;
  }

  /**
   * Inspect the current selection and update the active text/bg tokens.
   * Empty selection: read stored marks. Non-empty: walk text nodes (because
   * `$from.nodeAfter` can land on a block at boundary positions).
   */
  #syncFromSelection(): void {
    const { selection } = this.#editor.state;
    let mark: { attrs: Record<string, unknown> } | null = null;

    if (selection.empty) {
      mark =
        selection.$from.marks().find((m) => m.type.name === 'textStyle') ?? null;
    } else {
      this.#editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
        if (mark) return false;
        if (node.isText) {
          const found = node.marks.find((m) => m.type.name === 'textStyle');
          if (found) mark = found;
        }
        return true;
      });
    }

    const attrs = (mark?.attrs ?? {}) as {
      colorToken?: string | null;
      backgroundColorToken?: string | null;
    };
    this.#currentTextToken = attrs.colorToken ?? null;
    this.#currentBgToken = attrs.backgroundColorToken ?? null;
  }

  #setStorageOpen(open: boolean): void {
    const slot = this.#editor.storage['notionColorPicker'];
    if (slot && typeof slot === 'object') {
      (slot as NotionColorPickerStorage).isOpen = open;
    }
  }

  #renderOrUpdatePanel(): void {
    if (!this.#host) return;
    if (!this.#panel) {
      this.#panel = this.#createPanel();
    } else {
      // Refresh content (active classes) in case panel was reused.
      this.#panel.replaceChildren(...this.#renderSections());
    }
    // Append (or re-append) panel to host
    this.#host.appendChild(this.#panel);
  }

  #createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'dm-notion-color-picker';
    panel.setAttribute('data-show', '');
    panel.setAttribute('data-dm-editor-ui', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Text and background color');
    panel.setAttribute('aria-modal', 'false');
    panel.addEventListener('keydown', (e) => { this.#onPanelKeydown(e); });
    panel.append(...this.#renderSections());
    return panel;
  }

  #renderSections(): Node[] {
    return [
      this.#createSection({
        label: 'Text color',
        variant: 'text',
        activeToken: this.#currentTextToken,
        onApply: (t) => { this.applyText(t); },
      }),
      this.#createSection({
        label: 'Background color',
        variant: 'bg',
        activeToken: this.#currentBgToken,
        onApply: (t) => { this.applyBg(t); },
      }),
    ];
  }

  #createSection(opts: {
    label: string;
    variant: 'text' | 'bg';
    activeToken: string | null;
    onApply: (token: string | null) => void;
  }): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'dm-ncp-section';

    const heading = document.createElement('div');
    heading.className = 'dm-ncp-label';
    heading.textContent = opts.label;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'dm-ncp-grid';

    // Default swatch (null token)
    grid.appendChild(
      this.#createSwatch({
        token: null,
        variant: opts.variant,
        label: opts.variant === 'text' ? 'Default text color' : 'Default background',
        activeToken: opts.activeToken,
        onApply: opts.onApply,
      }),
    );

    // Named token swatches
    for (const t of this.#palette) {
      const label =
        opts.variant === 'text'
          ? `${this.tokenLabel(t)} text`
          : `${this.tokenLabel(t)} background`;
      grid.appendChild(
        this.#createSwatch({
          token: t,
          variant: opts.variant,
          label,
          activeToken: opts.activeToken,
          onApply: opts.onApply,
        }),
      );
    }

    section.appendChild(grid);
    return section;
  }

  #createSwatch(opts: {
    token: string | null;
    variant: 'text' | 'bg';
    label: string;
    activeToken: string | null;
    onApply: (token: string | null) => void;
  }): HTMLButtonElement {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `dm-ncp-swatch dm-ncp-swatch--${opts.variant}`;
    if (opts.activeToken === opts.token) swatch.classList.add('dm-ncp-active');
    swatch.setAttribute('aria-pressed', String(opts.activeToken === opts.token));
    swatch.dataset['color'] = opts.token ?? 'null';
    swatch.title =
      opts.token === null
        ? (opts.variant === 'text' ? 'Default text color' : 'Default background')
        : this.tokenLabel(opts.token);
    swatch.setAttribute('aria-label', opts.label);
    swatch.addEventListener('mousedown', (e) => { e.preventDefault(); });
    swatch.addEventListener('click', () => { opts.onApply(opts.token); });
    return swatch;
  }

  /** Update only active-class state without rebuilding DOM. */
  #updateActiveClasses(): void {
    if (!this.#panel) return;
    const textSwatches = Array.from(
      this.#panel.querySelectorAll<HTMLButtonElement>('.dm-ncp-swatch--text'),
    );
    const bgSwatches = Array.from(
      this.#panel.querySelectorAll<HTMLButtonElement>('.dm-ncp-swatch--bg'),
    );
    for (const sw of textSwatches) {
      const token = sw.dataset['color'] === 'null' ? null : (sw.dataset['color'] ?? null);
      const isActive = token === this.#currentTextToken;
      sw.classList.toggle('dm-ncp-active', isActive);
      sw.setAttribute('aria-pressed', String(isActive));
    }
    for (const sw of bgSwatches) {
      const token = sw.dataset['color'] === 'null' ? null : (sw.dataset['color'] ?? null);
      const isActive = token === this.#currentBgToken;
      sw.classList.toggle('dm-ncp-active', isActive);
      sw.setAttribute('aria-pressed', String(isActive));
    }
  }

  /**
   * Position + two-rAF focus chain. Floating-UI positions immediately; second
   * rAF waits for paint so focus doesn't race the bubble-menu blur. Focuses
   * the active swatch or falls back to the first default text swatch.
   */
  #positionAndFocus(): void {
    if (!this.#anchor || !this.#panel) return;
    this.#cleanupFloating?.();
    // Use `positionFloatingOnce` (no auto-track + no hide middleware) instead
    // of `positionFloating`: the bubble menu rebuilds its A button on every
    // transaction, which orphans our anchor reference. `positionFloating`'s
    // `hide` middleware reacts to the orphan by setting `visibility: hidden`
    // on the panel, which propagates to swatches and breaks `focus()`.
    this.#cleanupFloating = positionFloatingOnce(this.#anchor, this.#panel, {
      placement: 'bottom-start',
      offsetValue: 4,
    });

    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        if (!this.#panel?.isConnected) return;
        const active = this.#panel.querySelector<HTMLElement>('.dm-ncp-swatch.dm-ncp-active');
        const fallback = this.#panel.querySelector<HTMLElement>(
          '.dm-ncp-swatch--text[data-color="null"]',
        );
        (active ?? fallback)?.focus({ preventScroll: true });
      });
      this.#rafIds.push(id2);
    });
    this.#rafIds.push(id1);
  }

  #cancelPendingRafs(): void {
    for (const id of this.#rafIds) cancelAnimationFrame(id);
    this.#rafIds = [];
  }

  #attachGlobalListeners(): void {
    this.#openAbortCtl?.abort();
    this.#openAbortCtl = new AbortController();
    const { signal } = this.#openAbortCtl;

    document.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (this.#panel?.contains(target)) return;
        if (this.#anchor?.contains(target)) return;
        this.close();
      },
      { signal },
    );

    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.#isOpen) {
          e.preventDefault();
          this.close({ refocus: true });
        }
      },
      { signal },
    );
  }

  #detachGlobalListeners(): void {
    this.#openAbortCtl?.abort();
    this.#openAbortCtl = null;
  }

  /**
   * Arrow / Home / End nav across the 5-column swatch grid. Sequential focus
   * walks both Text and Background sections so keyboard users can reach any
   * swatch without re-grabbing Tab.
   */
  #onPanelKeydown(event: KeyboardEvent): void {
    const cols = 5;
    if (!this.#panel) return;
    const swatches = Array.from(
      this.#panel.querySelectorAll<HTMLElement>('.dm-ncp-swatch'),
    );
    if (!swatches.length) return;

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const idx = swatches.indexOf(active);
    if (idx === -1) return;

    let next = idx;
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
      case 'Home':
        event.preventDefault();
        next = 0;
        break;
      case 'End':
        event.preventDefault();
        next = swatches.length - 1;
        break;
      default:
        return;
    }
    swatches[next]?.focus();
  }
}
