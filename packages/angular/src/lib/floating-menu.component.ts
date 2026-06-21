import type { OnDestroy, ElementRef } from '@angular/core';
import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  PluginKey,
  FloatingMenuController,
  createFloatingMenuPlugin,
  defaultIcons,
  refocusEditorAfterCommand,
} from '@domternal/core';
import type {
  Editor,
  FloatingMenuItem,
  FloatingMenuItemsOverride,
  FloatingMenuKeymap,
  FloatingMenuOptions,
  IconSet,
} from '@domternal/core';

/**
 * Block-insert floating menu for Angular.
 *
 * Renders defaults collected from the editor's extensions via
 * `addFloatingMenuItems()`; use `items` to override the list and `icons`
 * to swap the icon set.
 */
@Component({
  selector: 'domternal-floating-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      #menuEl
      class="dm-floating-menu"
      role="menu"
      aria-label="Insert block"
      data-dm-editor-ui=""
      (keydown)="onKeyDown($event)"
    >
      @for (group of groups(); track group.name || $index; let gi = $index) {
        @if (group.name) {
          <div class="dm-floating-menu-group-label" [id]="'dm-fm-g' + gi">{{ group.name }}</div>
        }
        <div
          class="dm-floating-menu-group"
          role="group"
          [attr.aria-labelledby]="group.name ? 'dm-fm-g' + gi : null"
        >
          @for (item of group.items; track item.name) {
            <button
              type="button"
              role="menuitem"
              class="dm-floating-menu-item"
              [attr.data-floating-menu-item]="item.name"
              [attr.data-floating-menu-index]="flatIndexOf(item.name)"
              [attr.tabindex]="tabIndexFor(item.name)"
              [attr.aria-disabled]="isItemDisabled(item) ? 'true' : null"
              [attr.aria-keyshortcuts]="item.shortcut"
              [disabled]="isItemDisabled(item)"
              (mousedown)="$event.preventDefault()"
              (click)="onItemClick(item)"
            >
              @if (iconHtml(item.icon); as html) {
                <span class="dm-floating-menu-item-icon" aria-hidden="true" [innerHTML]="html"></span>
              }
              <span class="dm-floating-menu-item-label">{{ item.label }}</span>
              @if (item.shortcut) {
                <span class="dm-floating-menu-item-shortcut" aria-hidden="true">{{ item.shortcut }}</span>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`:host { display: contents; }`],
})
export class DomternalFloatingMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<FloatingMenuOptions['shouldShow']>();
  readonly offset = input<number>(0);
  readonly items = input<FloatingMenuItemsOverride | undefined>(undefined);
  readonly keymap = input<FloatingMenuKeymap | undefined>(undefined);
  readonly icons = input<IconSet | undefined>(undefined);
  /**
   * When true, the menu does NOT auto-show on every empty paragraph;
   * it only opens when the BlockHandle `+` button (or any caller of
   * `showFloatingMenu`) explicitly triggers it. Notion-style behaviour
   * - empty rows show a placeholder, the slash menu is the keyboard
   * trigger, the `+` button is the gutter trigger.
   * @default false
   */
  readonly requireExplicitTrigger = input<boolean>(false);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private ngZone = inject(NgZone);
  private sanitizer = inject(DomSanitizer);
  private pluginKey: PluginKey;

  private controller: FloatingMenuController | null = null;

  // Signal that bumps on every controller change - templates read it to
  // re-run @for tracking. OnPush components need explicit change triggers.
  private version = signal(0);
  private iconCache = new Map<string, SafeHtml>();

  readonly groups = computed(() => {
    // Read version to subscribe to controller updates.
    void this.version();
    return this.controller?.groups ?? [];
  });

  private flatNames = computed(() => {
    void this.version();
    return this.groups().flatMap((g) => g.items.map((i) => i.name));
  });

  private focusedIndex = computed(() => {
    void this.version();
    return this.controller?.focusedIndex ?? -1;
  });

  constructor() {
    // Prefer crypto.randomUUID for collision-free uniqueness (Math.random
    // across simultaneous mounts may collide; SSR can share the seed).
    // Matches the bubble-menu component's pattern.
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const suffix =
      cryptoRef?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8);
    this.pluginKey = new PluginKey('angularFloatingMenu-' + suffix);

    afterNextRender(() => {
      const editor = this.editor();
      const shouldShow = this.shouldShow();
      const keymap = this.keymap();
      const plugin = createFloatingMenuPlugin({
        pluginKey: this.pluginKey,
        editor,
        element: this.menuEl().nativeElement,
        ...(shouldShow && { shouldShow }),
        offset: this.offset(),
        ...(keymap && { keymap }),
        requireExplicitTrigger: this.requireExplicitTrigger(),
      });
      editor.registerPlugin(plugin);

      // Create controller for default rendering. ProseMirror transactions
      // fire outside Angular zone, so signal updates inside the onChange
      // callback must be wrapped to trigger OnPush change detection.
      const controller = new FloatingMenuController(
        editor,
        () => {
          this.ngZone.run(() => { this.version.update((v) => v + 1); });
        },
        this.items(),
      );
      controller.subscribe();
      this.controller = controller;
      // Controller is a plain field, not a signal - bumping `version` is
      // what tells the `groups`/`focusedIndex` computeds to re-evaluate
      // and pick up the freshly assigned controller instance.
      this.version.update((v) => v + 1);
    });

    // Imperatively focus the active menuitem on focusedIndex change.
    effect(() => {
      const idx = this.focusedIndex();
      if (idx < 0) return;
      queueMicrotask(() => {
        const target = this.menuEl().nativeElement.querySelector<HTMLElement>(
          `[data-floating-menu-index="${String(idx)}"]`,
        );
        target?.focus();
      });
    });
  }

  ngOnDestroy(): void {
    this.controller?.destroy();
    this.controller = null;
    const editor = this.editor();
    if (!editor.isDestroyed) {
      editor.unregisterPlugin(this.pluginKey);
    }
  }

  // === Template helpers ===

  flatIndexOf(name: string): number {
    return this.flatNames().indexOf(name);
  }

  tabIndexFor(name: string): 0 | -1 {
    const flat = this.flatIndexOf(name);
    const focused = this.focusedIndex();
    if (flat === focused) return 0;
    // When menu not yet entered, first item is tabbable so external focus
    // (e.g. Tab traversal) lands naturally.
    if (focused < 0 && flat === 0) return 0;
    return -1;
  }

  isItemDisabled(item: FloatingMenuItem): boolean {
    return this.controller?.isDisabled(item) ?? false;
  }

  iconHtml(name?: string): SafeHtml | null {
    if (!name) return null;
    const existing = this.iconCache.get(name);
    if (existing) return existing;
    const raw = this.icons()?.[name] ?? defaultIcons[name] ?? '';
    if (!raw) return null;
    const sanitized = this.sanitizer.bypassSecurityTrustHtml(raw);
    this.iconCache.set(name, sanitized);
    return sanitized;
  }

  onItemClick(item: FloatingMenuItem): void {
    const editor = this.editor();
    const ctl = this.controller;
    if (!ctl) return;
    ctl.execute(item);
    refocusEditorAfterCommand(editor.view);
  }

  onKeyDown(e: KeyboardEvent): void {
    const ctl = this.controller;
    if (!ctl) return;
    const focused = ctl.focusedItem();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        ctl.next();
        return;
      case 'ArrowUp':
        e.preventDefault();
        ctl.prev();
        return;
      case 'Home':
        e.preventDefault();
        ctl.first();
        return;
      case 'End':
        e.preventDefault();
        ctl.last();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        ctl.leaveMenu();
        this.editor().view.focus();
        return;
      case 'Enter':
      case ' ':
        if (focused) {
          e.preventDefault();
          this.onItemClick(focused);
        }
        return;
      default:
        return;
    }
  }
}
