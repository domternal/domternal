/**
 * Notion-style color picker popover. Listens for the `notionColorOpen` event
 * emitted by the bubble-menu's "A" trigger and renders a 3-section dropdown
 * (Recently used / Text color / Background color).
 *
 * Drives `setTextColorToken` / `setBackgroundColorToken` on click and pushes
 * each pick into the NotionColorPicker extension's recent list.
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

interface RecentEntry {
  kind: 'text' | 'bg';
  token: string | null;
}

interface NotionColorPickerStorage {
  recent: RecentEntry[];
  isOpen: boolean;
}

/**
 * The named-token palette must match `DEFAULT_NOTION_COLOR_PALETTE` in
 * `@domternal/core`. The picker reads the actual palette from the loaded
 * extension's options so consumer-configured palettes are respected, but
 * this constant provides the legend (token → display label) used in tooltips.
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
      <div class="dm-notion-color-picker" data-show role="dialog" aria-label="Text and background color">
        @if (recent().length > 0) {
          <div class="dm-ncp-section">
            <div class="dm-ncp-label">Recently used</div>
            <div class="dm-ncp-grid">
              @for (r of recent(); track recentKey(r)) {
                <button
                  type="button"
                  class="dm-ncp-swatch"
                  [class.dm-ncp-swatch--text]="r.kind === 'text'"
                  [class.dm-ncp-swatch--bg]="r.kind === 'bg'"
                  [attr.data-color]="r.token ?? 'null'"
                  [title]="recentTitle(r)"
                  [attr.aria-label]="recentTitle(r)"
                  (mousedown)="$event.preventDefault()"
                  (click)="applyRecent(r)"
                ></button>
              }
            </div>
          </div>
        }

        <div class="dm-ncp-section">
          <div class="dm-ncp-label">Text color</div>
          <div class="dm-ncp-grid">
            <button
              type="button"
              class="dm-ncp-swatch dm-ncp-swatch--text"
              [class.dm-ncp-active]="currentTextToken() === null"
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
  styles: [`:host { display: contents; }`],
})
export class DomternalNotionColorPickerComponent implements OnDestroy {
  readonly editor = input.required<Editor>();

  readonly isOpen = signal(false);
  readonly recent = signal<RecentEntry[]>([]);
  readonly currentTextToken = signal<string | null>(null);
  readonly currentBgToken = signal<string | null>(null);
  readonly palette = signal<string[]>([]);

  private anchorEl: HTMLElement | null = null;
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
      untracked(() => { this.setupEventListener(editor); });
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  // ===========================================================================
  // Template helpers
  // ===========================================================================

  recentKey(r: RecentEntry): string {
    return `${r.kind}-${String(r.token)}`;
  }

  recentTitle(r: RecentEntry): string {
    const label = r.token === null ? 'Default' : (TOKEN_LABELS[r.token] ?? r.token);
    return r.kind === 'text' ? `${label} text` : `${label} background`;
  }

  tokenLabel(token: string): string {
    return TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
  }

  // ===========================================================================
  // Apply commands (swatch click handlers)
  // ===========================================================================

  applyText(token: string | null): void {
    const editor = this.editor();
    editor.commands.setTextColorToken(token);
    editor.commands.pushRecentColor({ kind: 'text', token });
    // Refresh local recent signal from storage so the "Recently used" row
    // updates immediately for the next open.
    this.refreshRecent();
    this.close({ refocus: true });
  }

  applyBg(token: string | null): void {
    const editor = this.editor();
    editor.commands.setBackgroundColorToken(token);
    editor.commands.pushRecentColor({ kind: 'bg', token });
    this.refreshRecent();
    this.close({ refocus: true });
  }

  applyRecent(entry: RecentEntry): void {
    if (entry.kind === 'text') this.applyText(entry.token);
    else this.applyBg(entry.token);
  }

  close(opts: { refocus?: boolean } = {}): void {
    if (!this.isOpen()) return;
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    this.isOpen.set(false);
    this.setStorageOpen(false);
    this.anchorEl = null;
    this.removeGlobalListeners();
    if (opts.refocus) {
      this.editor().view.focus();
    }
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

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
        this.refreshRecent();
        this.isOpen.set(true);
        this.setStorageOpen(true);

        this.addGlobalListeners();

        // Position panel against the trigger after Angular renders the DOM.
        requestAnimationFrame(() => {
          const panel = this.elRef.nativeElement.querySelector<HTMLElement>(
            '.dm-notion-color-picker',
          );
          if (panel && this.anchorEl) {
            this.cleanupFloating?.();
            this.cleanupFloating = positionFloating(this.anchorEl, panel, {
              placement: 'bottom-start',
              offsetValue: 4,
            });
          }
        });
      });
    };

    (editor.on as (e: string, h: (...args: unknown[]) => void) => void)(
      'notionColorOpen',
      this.eventHandler,
    );
  }

  private addGlobalListeners(): void {
    this.clickOutsideHandler = (e: Event) => {
      if (!this.isOpen()) return;
      const target = e.target as Node;
      // Clicks inside our own panel or on the anchor (which toggles via the
      // event handler) must not trigger outside-close.
      if (this.elRef.nativeElement.contains(target)) return;
      if (this.anchorEl?.contains(target)) return;
      this.ngZone.run(() => { this.close({ refocus: false }); });
    };
    document.addEventListener('mousedown', this.clickOutsideHandler);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        this.ngZone.run(() => { this.close({ refocus: true }); });
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    // Empty selection (user clicked elsewhere) closes the picker since the
    // bubble-menu anchor it sits on is about to vanish anyway.
    this.selectionHandler = () => {
      if (!this.isOpen()) return;
      if (this.editor().state.selection.empty) {
        this.ngZone.run(() => { this.close({ refocus: false }); });
      } else {
        // Selection changed but stays non-empty (e.g. shift+arrow): refresh
        // the active-state indicators against the new mark set.
        this.syncFromSelection();
      }
    };
    (this.editor().on as (e: string, h: () => void) => void)(
      'selectionUpdate',
      this.selectionHandler,
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
        this.selectionHandler,
      );
      this.selectionHandler = null;
    }
  }

  private syncFromSelection(): void {
    const editor = this.editor();
    const $from = editor.state.selection.$from;
    const mark = $from.marks().find((m) => m.type.name === 'textStyle');
    const attrs = (mark?.attrs ?? {}) as { colorToken?: string | null; backgroundColorToken?: string | null };
    this.currentTextToken.set(attrs.colorToken ?? null);
    this.currentBgToken.set(attrs.backgroundColorToken ?? null);
  }

  private refreshRecent(): void {
    // Read fresh from localStorage (when available) to pick up writes from
    // other editor instances or tabs since this editor was constructed; falls
    // back to the in-memory copy when persistence is disabled or fails.
    const options = this.readOptions();
    const fresh = this.readPersistedRecent(options?.storageKey ?? null);
    if (fresh) {
      const storage = this.getStorage();
      if (storage) storage.recent = fresh;
      this.recent.set(fresh);
      return;
    }
    const storage = this.getStorage();
    this.recent.set([...(storage?.recent ?? [])]);
  }

  private readPersistedRecent(storageKey: string | null): RecentEntry[] | null {
    if (!storageKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (v): v is RecentEntry =>
          typeof v === 'object' && v !== null &&
          ((v as { kind?: unknown }).kind === 'text' || (v as { kind?: unknown }).kind === 'bg') &&
          ((v as { token?: unknown }).token === null || typeof (v as { token?: unknown }).token === 'string'),
      );
    } catch {
      return null;
    }
  }

  private readPalette(): string[] {
    const options = this.readOptions();
    return options?.palette ? [...options.palette] : [];
  }

  private readOptions(): { palette?: readonly string[]; storageKey?: string | null } | null {
    const ext = this.editor().extensionManager.extensions.find((e) => e.name === 'notionColorPicker');
    return (ext?.options ?? null) as { palette?: readonly string[]; storageKey?: string | null } | null;
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
        this.eventHandler,
      );
      this.eventHandler = null;
    }
  }
}
