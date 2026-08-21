/**
 * Notion-style color picker popover. Listens for the `notionColorOpen` event
 * emitted by the bubble-menu's "A" trigger and renders a two-section dropdown
 * (Text color / Background color).
 *
 * Drives `setTextColorToken` / `setBackgroundColorToken` on click.
 */
import type { OnDestroy } from '@angular/core';
import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  input,
  signal,
  effect,
  inject,
  NgZone,
  ElementRef,
  untracked,
} from '@angular/core';

import type { Editor } from '@domternal/core';
import { positionFloating } from '@domternal/core';

interface NotionColorPickerStorage {
  isOpen: boolean;
}

function paletteFromExtensionOptions(options: unknown): string[] {
  if (typeof options !== 'object' || options === null || !('palette' in options)) return [];
  const palette: unknown = options.palette;
  if (!Array.isArray(palette) || !palette.every((token: unknown) => typeof token === 'string')) {
    return [];
  }
  return [...palette];
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

@Component({
  selector: 'domternal-notion-color-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (isOpen()) {
      <div
        class="dm-notion-color-picker"
        data-show
        data-dm-editor-ui
        role="dialog"
        aria-label="Text and background color"
        aria-modal="false"
        (keydown)="onPanelKeydown($event)"
      >
        <div class="dm-ncp-section">
          <div class="dm-ncp-label">Text color</div>
          <div class="dm-ncp-grid">
            <button
              type="button"
              class="dm-ncp-swatch dm-ncp-swatch--text"
              [class.dm-ncp-active]="currentTextToken() === null"
              [attr.aria-pressed]="currentTextToken() === null"
              data-color="null"
              title="Default text color"
              aria-label="Default text color"
              (mousedown)="$event.preventDefault()"
              (click)="applyText(null)"
            ></button>
            @for (t of palette(); track t) {
              <button
                type="button"
                class="dm-ncp-swatch dm-ncp-swatch--text"
                [class.dm-ncp-active]="currentTextToken() === t"
                [attr.aria-pressed]="currentTextToken() === t"
                [attr.data-color]="t"
                [title]="tokenLabel(t)"
                [attr.aria-label]="tokenLabel(t) + ' text'"
                (mousedown)="$event.preventDefault()"
                (click)="applyText(t)"
              ></button>
            }
          </div>
        </div>

        <div class="dm-ncp-section">
          <div class="dm-ncp-label">Background color</div>
          <div class="dm-ncp-grid">
            <button
              type="button"
              class="dm-ncp-swatch dm-ncp-swatch--bg"
              [class.dm-ncp-active]="currentBgToken() === null"
              [attr.aria-pressed]="currentBgToken() === null"
              data-color="null"
              title="Default background"
              aria-label="Default background"
              (mousedown)="$event.preventDefault()"
              (click)="applyBg(null)"
            ></button>
            @for (t of palette(); track t) {
              <button
                type="button"
                class="dm-ncp-swatch dm-ncp-swatch--bg"
                [class.dm-ncp-active]="currentBgToken() === t"
                [attr.aria-pressed]="currentBgToken() === t"
                [attr.data-color]="t"
                [title]="tokenLabel(t) + ' background'"
                [attr.aria-label]="tokenLabel(t) + ' background'"
                (mousedown)="$event.preventDefault()"
                (click)="applyBg(t)"
              ></button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class DomternalNotionColorPickerComponent implements OnDestroy {
  readonly editor = input.required<Editor>();

  readonly isOpen = signal(false);
  readonly currentTextToken = signal<string | null>(null);
  readonly currentBgToken = signal<string | null>(null);
  readonly palette = signal<string[]>([]);

  private anchorEl: HTMLElement | null = null;
  // Reference to the picker panel after it has been reparented into
  // `.dm-editor`. After reparenting `elRef.nativeElement.contains(panel)`
  // returns false, so any inside-click detection must consult `panelEl`
  // directly rather than walking up from the component host.
  private panelEl: HTMLElement | null = null;
  private ngZone = inject(NgZone);
  private elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  private eventHandler: ((...args: unknown[]) => void) | null = null;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private selectionHandler: (() => void) | null = null;
  private cleanupFloating: (() => void) | null = null;

  constructor() {
    effect(() => {
      const editor = this.editor();
      untracked(() => {
        this.setupEventListener(editor);
      });
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  tokenLabel(token: string): string {
    return TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
  }

  applyText(token: string | null): void {
    const editor = this.editor();
    editor.commands.setTextColorToken(token);
    // Picker stays open so the user can chain picks; close mirrors the bubble
    // menu (outside-click / Escape / empty selection).
    this.syncFromSelection();
  }

  applyBg(token: string | null): void {
    const editor = this.editor();
    editor.commands.setBackgroundColorToken(token);
    this.syncFromSelection();
  }

  /**
   * Arrow-key navigation across the 5-column swatch grids. Arrows move
   * within and across rows, Home/End jump to grid boundaries, Tab leaves
   * the picker (browser default), Enter/Space activates the focused swatch.
   * Focus moves sequentially through Text color → Background color so
   * keyboard users can reach any swatch without re-grabbing Tab.
   */
  onPanelKeydown(event: KeyboardEvent): void {
    const cols = 5;
    // Query off the tracked panel; after reparenting into `.dm-editor` the
    // swatches are no longer descendants of the component host element.
    const root = this.panelEl ?? this.elRef.nativeElement;
    const swatches = Array.from(root.querySelectorAll<HTMLElement>('.dm-ncp-swatch'));
    if (!swatches.length) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? swatches.indexOf(active) : -1;
    if (idx === -1) return;

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

  close(opts: { refocus?: boolean } = {}): void {
    if (!this.isOpen()) return;
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    this.isOpen.set(false);
    this.setStorageOpen(false);
    this.anchorEl = null;
    this.panelEl = null;
    this.removeGlobalListeners();
    if (opts.refocus) {
      this.editor().view.focus();
    }
  }

  private setupEventListener(editor: Editor): void {
    this.cleanup();

    this.eventHandler = (...args: unknown[]) => {
      const data = args[0] as { anchorElement?: HTMLElement } | undefined;
      this.ngZone.run(() => {
        const anchor = data?.anchorElement;
        if (!anchor) return;

        // Toggle: clicking the same anchor while open closes the picker.
        if (this.isOpen() && this.anchorEl === anchor) {
          this.close({ refocus: true });
          return;
        }

        this.anchorEl = anchor;
        this.palette.set(this.readPalette());
        this.syncFromSelection();
        this.isOpen.set(true);
        this.setStorageOpen(true);

        this.addGlobalListeners();

        // Position panel against the trigger after Angular renders the DOM.
        // Focus management (move into the first/active swatch) runs on a
        // second rAF so positioning + paint has flushed; focusing during the
        // same frame as mount can race with the bubble-menu's blur handler
        // and momentarily hide the floating layer Playwright observes.
        requestAnimationFrame(() => {
          const panel =
            this.elRef.nativeElement.querySelector<HTMLElement>('.dm-notion-color-picker');
          if (panel && this.anchorEl) {
            // Reparent into `.dm-editor` so the panel inherits the editor's
            // CSS custom properties (`--dm-block-bg-*`, `--dm-block-text-*`,
            // surface/border tokens). All variables in @domternal/theme are
            // scoped to `.dm-editor`; without reparenting the picker would
            // sit as a sibling and render with bare fallbacks.
            const editorEl = this.anchorEl.closest<HTMLElement>('.dm-editor');
            if (editorEl && panel.parentElement !== editorEl) {
              editorEl.appendChild(panel);
            }
            this.panelEl = panel;

            this.cleanupFloating?.();
            this.cleanupFloating = positionFloating(this.anchorEl, panel, {
              placement: 'bottom-start',
              offsetValue: 4,
            });
          }
          requestAnimationFrame(() => {
            if (!this.isOpen()) return; // bailed out between frames
            // Use the tracked panel reference: after reparenting into
            // `.dm-editor` the panel is no longer a descendant of the
            // component host, so `elRef.nativeElement.querySelector` returns
            // null and focus never lands.
            const p = this.panelEl;
            if (!p) return;
            const active = p.querySelector<HTMLElement>('.dm-ncp-swatch.dm-ncp-active');
            const fallback = p.querySelector<HTMLElement>(
              '.dm-ncp-swatch--text[data-color="null"]'
            );
            (active ?? fallback)?.focus({ preventScroll: true });
          });
        });
      });
    };

    (editor.on as (e: string, h: (...args: unknown[]) => void) => void)(
      'notionColorOpen',
      this.eventHandler
    );
  }

  private addGlobalListeners(): void {
    this.clickOutsideHandler = (e: Event) => {
      if (!this.isOpen()) return;
      const target = e.target as Node;
      // Clicks inside the reparented panel or on the anchor (which toggles
      // via the event handler) must not trigger outside-close. The panel
      // has been moved out of `elRef.nativeElement` to inherit editor CSS
      // vars, so we cannot rely on the host element for containment.
      if (this.panelEl?.contains(target)) return;
      if (this.elRef.nativeElement.contains(target)) return;
      if (this.anchorEl?.contains(target)) return;
      this.ngZone.run(() => {
        this.close({ refocus: false });
      });
    };
    document.addEventListener('mousedown', this.clickOutsideHandler);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        this.ngZone.run(() => {
          this.close({ refocus: true });
        });
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    // Empty selection (user clicked elsewhere) closes the picker since the
    // bubble-menu anchor it sits on is about to vanish anyway.
    this.selectionHandler = () => {
      if (!this.isOpen()) return;
      // Defensive: bubble menu may have vanished between transactions
      // (hideout, route change). Positioning against a detached anchor is
      // a no-op; close instead. Matches React/Vue behaviour.
      if (this.anchorEl && !this.anchorEl.isConnected) {
        this.ngZone.run(() => {
          this.close({ refocus: false });
        });
        return;
      }
      if (this.editor().state.selection.empty) {
        this.ngZone.run(() => {
          this.close({ refocus: false });
        });
      } else {
        // Selection changed but stays non-empty (e.g. shift+arrow): refresh
        // the active-state indicators against the new mark set.
        this.syncFromSelection();
      }
    };
    (this.editor().on as (e: string, h: () => void) => void)(
      'selectionUpdate',
      this.selectionHandler
    );
  }

  private removeGlobalListeners(): void {
    if (this.clickOutsideHandler) {
      document.removeEventListener('mousedown', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.selectionHandler) {
      (this.editor().off as (e: string, h: () => void) => void)(
        'selectionUpdate',
        this.selectionHandler
      );
      this.selectionHandler = null;
    }
  }

  private syncFromSelection(): void {
    const editor = this.editor();
    const { selection } = editor.state;

    // Empty cursor: stored-marks semantics (what newly-typed text inherits).
    // Non-empty: scan the range for the first text node carrying a textStyle
    // mark. `$from.nodeAfter` can land on a block (paragraph) when the
    // selection starts at a block boundary (e.g. AllSelection / selectAll),
    // so walking text nodes is necessary for correct active-state detection.
    let mark: { attrs: Record<string, unknown> } | null = null;
    if (selection.empty) {
      mark = selection.$from.marks().find((m) => m.type.name === 'textStyle') ?? null;
    } else {
      editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
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
    this.currentTextToken.set(attrs.colorToken ?? null);
    this.currentBgToken.set(attrs.backgroundColorToken ?? null);
  }

  private readPalette(): string[] {
    const ext = this.editor().extensionManager.extensions.find(
      (e) => e.name === 'notionColorPicker'
    );
    return paletteFromExtensionOptions(ext?.options);
  }

  private getStorage(): NotionColorPickerStorage | null {
    const storage = this.editor().storage;
    const slot = storage['notionColorPicker'];
    if (!slot || typeof slot !== 'object') return null;
    return slot as NotionColorPickerStorage;
  }

  private setStorageOpen(open: boolean): void {
    const storage = this.getStorage();
    if (storage) storage.isOpen = open;
  }

  private cleanup(): void {
    this.removeGlobalListeners();
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    if (this.eventHandler) {
      const editor = this.editor();
      (editor.off as (e: string, h: (...args: unknown[]) => void) => void)(
        'notionColorOpen',
        this.eventHandler
      );
      this.eventHandler = null;
    }
  }
}
