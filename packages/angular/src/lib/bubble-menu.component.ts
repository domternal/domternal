import type { OnDestroy, ElementRef } from '@angular/core';
import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  input,
  signal,
  computed,
  effect,
  inject,
  NgZone,
  viewChild,
  afterNextRender,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import {
  PluginKey,
  ToolbarController,
  buildBubbleItemMaps,
  createBubbleMenuPlugin,
  createBubbleShouldShow,
  defaultBubbleContexts,
  defaultIcons,
  positionFloatingOnce,
  refocusEditorAfterCommand,
  resolveBubbleMenuItems,
  resolveBubbleNames,
} from '@domternal/core';
import type {
  BubbleContexts,
  BubbleItemMaps,
  BubbleMenuItem,
  BubbleMenuOptions,
  IconSet,
  SelectionShape,
  ToolbarButton,
  ToolbarDropdown,
  Editor,
} from '@domternal/core';

/* The item pipeline (which list this selection gets, what the schema allows,
   which separators survive) is core's. This component renders the answer and
   owns nothing about how it is reached. */

@Component({
  selector: 'domternal-bubble-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div #menuEl class="dm-bubble-menu" role="toolbar" aria-label="Text formatting">
      @for (item of resolvedItems(); track item.name) {
        @if (item.type === 'separator') {
          <span class="dm-toolbar-separator" role="separator"></span>
        } @else if (item.type === 'dropdown') {
          <div class="dm-toolbar-dropdown-wrapper" [attr.data-dropdown-wrapper]="asDropdown(item).name">
            <button type="button"
              class="dm-toolbar-button dm-toolbar-dropdown-trigger"
              [class.dm-toolbar-button--active]="isDropdownActive(asDropdown(item))"
              [attr.aria-expanded]="openDropdown() === asDropdown(item).name"
              [attr.aria-haspopup]="'true'"
              [attr.aria-label]="asDropdown(item).label"
              [title]="asDropdown(item).label"
              [attr.data-dropdown]="asDropdown(item).name"
              [innerHTML]="getDropdownTriggerHtml(asDropdown(item))"
              (mousedown)="$event.preventDefault()"
              (click)="onDropdownToggle(asDropdown(item), $event)"></button>
            @if (openDropdown() === asDropdown(item).name) {
              <div class="dm-toolbar-dropdown-panel" role="menu"
                   data-dm-editor-ui
                   [attr.data-dropdown-panel]="asDropdown(item).name">
                @for (sub of asDropdown(item).items; track sub.name) {
                  <button type="button"
                    class="dm-toolbar-dropdown-item"
                    [class.dm-toolbar-dropdown-item--active]="isSubItemActive(sub.name)"
                    role="menuitem"
                    [attr.aria-label]="sub.label"
                    [innerHTML]="getCachedItemContent(sub.icon, sub.label)"
                    (mousedown)="$event.preventDefault()"
                    (click)="onDropdownItemClick(sub)"></button>
                }
              </div>
            }
          </div>
        } @else {
          <button type="button" class="dm-toolbar-button"
            [class.dm-toolbar-button--active]="isItemActive(asButton(item))"
            [attr.aria-pressed]="isItemActive(asButton(item))"
            [disabled]="isItemDisabled(asButton(item))"
            [title]="asButton(item).label"
            [attr.aria-label]="asButton(item).label"
            [innerHTML]="getCachedIcon(asButton(item).icon)"
            (mousedown)="$event.preventDefault()"
            (click)="executeCommand(asButton(item), $event)"></button>
        }
      }
      @if (showColorTrigger()) {
        @if (resolvedItems().length > 0) {
          <span class="dm-toolbar-separator" role="separator"></span>
        }
        <button #colorBtn type="button" class="dm-toolbar-button dm-ncp-trigger"
          [class.dm-toolbar-button--active]="hasAnyColor()"
          title="Text and background color"
          aria-label="Text and background color"
          aria-haspopup="dialog"
          (mousedown)="$event.preventDefault()"
          (click)="openColorPicker(colorBtn)">
          <span class="dm-ncp-trigger-glyph"
            [style.color]="currentTextColorVar()">A</span>
          <span class="dm-ncp-trigger-underline"
            [style.background-color]="currentBgColorVar()"></span>
        </button>
      }
      @if (showBlockTrigger()) {
        @if (resolvedItems().length > 0 || showColorTrigger()) {
          <span class="dm-toolbar-separator" role="separator"></span>
        }
        <button #blockMenuBtn type="button" class="dm-toolbar-button"
          [disabled]="blockMenuButtonDisabled()"
          [title]="blockMenuButtonDisabled() ? 'Block actions (select within a single block)' : 'More options'"
          aria-label="More options"
          aria-haspopup="menu"
          [innerHTML]="getCachedIcon('dotsThree')"
          (mousedown)="$event.preventDefault()"
          (click)="openBlockContextMenu(blockMenuBtn)"></button>
      }
      <ng-content />
    </div>
  `,
  styles: [`:host { display: contents; }`],
})
export class DomternalBubbleMenuComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly shouldShow = input<BubbleMenuOptions['shouldShow']>();
  readonly placement = input<'top' | 'bottom'>('top');
  readonly offset = input<number>(8);
  readonly updateDelay = input(0);

  /** Fixed item names (e.g. ['bold', 'italic', 'code']). Omit for auto mode (all format items). */
  readonly items = input<string[] | undefined>(undefined);

  /**
   * Context-aware: map context names to item arrays, `true` for all valid
   * items, or `null` to disable.
   *
   * Typed through core's `BubbleContexts` rather than the same shape written
   * out here. Angular emits an input's declared type into the package types,
   * and an inline union came out of that emit as `Record<string, true |
   * string[]>`: the `null` that disables a context was missing from the
   * published type, so the documented way to switch one off did not
   * type-check. A named type survives the trip intact.
   */
  readonly contexts = input<BubbleContexts | undefined>(undefined);

  /**
   * Custom icon overrides. Falls back to default Phosphor icons for unmapped keys.
   * For nullable bindings, use `iconsSignal() ?? {}` to satisfy strict template checks.
   */
  readonly icons = input<IconSet | undefined>(undefined);

  /**
   * Returns the effective contexts map: the explicit `contexts` input
   * when provided, the standard default when neither `contexts` nor
   * `items` is set, or `undefined` (items-mode) when only `items` is set.
   * The standard default is richer when the editor sits inside
   * `.dm-notion-mode`.
   */
  private resolveContexts(editor: Editor): BubbleContexts | undefined {
    const explicit = this.contexts();
    if (explicit !== undefined) return explicit;
    if (this.items() !== undefined) return undefined;
    return defaultBubbleContexts(editor);
  }

  /** Internal - updated on transactions. Not meant to be set from outside. */
  readonly resolvedItems = signal<BubbleMenuItem[]>([]);

  /**
   * The list core hands back, stored once. A default or fallback list comes
   * back by reference and a signal set to its current value notifies nobody,
   * so those passes cost nothing; a list resolved from names is rebuilt each
   * time, as it always was.
   */
  private setResolvedItems(items: BubbleMenuItem[]): void {
    this.resolvedItems.set(items);
  }

  /** Internal - true when the BlockContextMenu extension is loaded; toggles the "..." trailing button. */
  readonly showBlockMenuButton = signal(false);

  /** Internal - true when the selection spans more than one top-level block; the "..." trigger is disabled in that case because block-level commands have no unambiguous target. */
  readonly blockMenuButtonDisabled = signal(false);

  /** Internal - true when the current selection is a NodeSelection (image, HR). The text-color and block-context triggers are hidden in that case: a node has no inline text to color and its bubble menu already exposes node-specific actions. */
  readonly isNodeSelection = signal(false);

  /** Internal - true when the NotionColorPicker extension is loaded; toggles the "A" color trigger. */
  readonly showColorPickerButton = signal(false);
  /**
   * The trailing triggers, resolved once for the template: each is read twice,
   * for the button and for the separator that may lead it.
   */
  readonly showColorTrigger = computed(
    () => this.showColorPickerButton() && !this.isNodeSelection(),
  );
  readonly showBlockTrigger = computed(
    () => this.showBlockMenuButton() && !this.isNodeSelection(),
  );
  /** notionColorPicker extension loaded (immutable per editor). */
  private hasNotionColorPicker = false;

  /** Current text color CSS variable expression for the trigger glyph (null = default). */
  readonly currentTextColorVar = signal<string | null>(null);

  /** Current background color CSS variable expression for the trigger underline (null = transparent). */
  readonly currentBgColorVar = signal<string | null>(null);

  /** Internal - true when the selection has any token-based text or background color applied. */
  readonly hasAnyColor = signal(false);

  private menuEl = viewChild.required<ElementRef<HTMLElement>>('menuEl');
  private pluginKey: PluginKey;

  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);

  private activeVersion = signal(0);
  /** Rebuilt per editor by `setupItemTracking`; empty until then. */
  private maps: BubbleItemMaps = {
    itemMap: new Map<string, ToolbarButton>(),
    dropdownMap: new Map<string, ToolbarDropdown>(),
    bubbleDefaults: new Map<string, BubbleMenuItem[]>(),
  };
  private activeMap = new Map<string, boolean>();
  private disabledMap = new Map<string, boolean>();
  private htmlCache = new Map<string, SafeHtml>();
  private transactionHandler: (() => void) | null = null;

  // Dropdown state for bubble-menu-embedded dropdowns (e.g. text-align).
  readonly openDropdown = signal<string | null>(null);
  private dropdownCleanupFloating: (() => void) | null = null;
  private dropdownOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private dropdownKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private dropdownDismissHandler: (() => void) | null = null;

  private readonly dropdownCaret =
    '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
    '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  constructor() {
    // Each component instance needs a unique plugin key so that multiple bubble-
    // menus mounted in the same editor do not collide.
    const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const suffix =
      crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8);
    this.pluginKey = new PluginKey('angularBubbleMenu-' + suffix);

    // Cache keys do not include icon-set identity, so flush on swap.
    effect(() => {
      this.icons();
      this.htmlCache.clear();
    });

    afterNextRender(() => {
      const editor = this.editor();

      /* Item tracking first, and the order is load-bearing: it is what builds
         `this.maps`, and the visibility rule below reads that object once.
         With the plugin registered first the rule closed over an empty map,
         and `bubbleDefaults.has(...)` was false for every node selection, so
         an image never got a menu at all. */
      this.setupItemTracking(editor);

      const ctxs = this.resolveContexts(editor);
      const shouldShowFn =
        this.shouldShow() ??
        createBubbleShouldShow(this.maps, ctxs);

      const plugin = createBubbleMenuPlugin({
        pluginKey: this.pluginKey,
        editor,
        element: this.menuEl().nativeElement,
        shouldShow: shouldShowFn,
        placement: this.placement(),
        offset: this.offset(),
        updateDelay: this.updateDelay(),
      });
      editor.registerPlugin(plugin);
    });
  }

  ngOnDestroy(): void {
    const editor = this.editor();
    if (this.transactionHandler) {
      editor.off('transaction', this.transactionHandler);
    }
    if (!editor.isDestroyed) {
      editor.unregisterPlugin(this.pluginKey);
    }
  }

  // === Template helpers ===

  isItemActive(item: ToolbarButton): boolean {
    this.activeVersion();
    return this.activeMap.get(item.name) ?? false;
  }

  isItemDisabled(item: ToolbarButton): boolean {
    this.activeVersion();
    return this.disabledMap.get(item.name) ?? false;
  }

  getCachedIcon(name: string): SafeHtml {
    let cached = this.htmlCache.get(name);
    if (!cached) {
      const custom = this.icons();
      cached = this.sanitizer.bypassSecurityTrustHtml(custom?.[name] ?? defaultIcons[name] ?? '');
      this.htmlCache.set(name, cached);
    }
    return cached;
  }

  executeCommand(item: ToolbarButton, event?: Event): void {
    if (item.emitEvent) {
      // Forward the clicked button as the anchor so listeners (LinkPopover,
      // image popover, emoji picker) can position their panels against it
      // - matches `openColorPicker(anchor)` and the toolbar's executeItem.
      const anchor =
        (event?.currentTarget as HTMLElement | undefined) ??
        (event?.target as HTMLElement | undefined) ?? null;
      // emitEvent is a dynamic string; cast needed to bypass strict EventEmitter<EditorEvents> typing
      (this.editor().emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      return;
    }
    ToolbarController.executeItem(this.editor() as never, item);
  }

  /**
   * Emit the `notionColorOpen` event with the trigger button as the anchor.
   * The framework popover component (DomternalNotionColorPickerComponent)
   * listens for this event and positions itself against the anchor.
   */
  openColorPicker(anchor: HTMLElement): void {
    (this.editor().emit as (e: string, d: unknown) => void)(
      'notionColorOpen',
      { anchorElement: anchor },
    );
  }

  /**
   * Open the BlockContextMenu against the cursor's containing block. Skips
   * the textblock for nested cases (cursor in `listItem > paragraph` targets
   * the listItem, not the paragraph) so Delete / Turn into operate on the
   * "visual block" the user is editing.
   */
  openBlockContextMenu(anchor: HTMLElement): void {
    const editor = this.editor();
    const $from = editor.state.selection.$from;
    if ($from.depth < 1) return;
    // Walk one level up to use the container when the cursor's textblock
    // isn't a direct doc child; otherwise use the textblock itself.
    const depth = $from.depth > 1 && $from.node($from.depth - 1).type.name !== 'doc'
      ? $from.depth - 1
      : $from.depth;
    const blockPos = $from.before(depth);
    const editorEl = editor.view.dom.closest<HTMLElement>('.dm-editor');
    editorEl?.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
      bubbles: false,
      detail: { blockPos, anchorElement: anchor },
    }));
  }

  // === Internal ===

  private setupItemTracking(editor: Editor): void {
    /* One pipeline, built once per editor. Every renderer asks core the same
       question, so none of them answers it. */
    this.maps = buildBubbleItemMaps(editor);
    this.showBlockMenuButton.set(
      editor.extensionManager.extensions.some((e) => e.name === 'blockContextMenu'),
    );
    // Presence cached; the show decision needs a live listener (per sync below).
    this.hasNotionColorPicker =
      editor.extensionManager.extensions.some((e) => e.name === 'notionColorPicker');

    const fallbackItems = resolveBubbleNames(
      this.items() ?? ['bold', 'italic', 'underline'],
      this.maps.itemMap,
      this.maps.dropdownMap,
    );
    const refreshItems = (): void => {
      this.setResolvedItems(
        resolveBubbleMenuItems({
          editor,
          maps: this.maps,
          contexts: this.resolveContexts(editor),
          fallbackItems,
        }),
      );
    };

    refreshItems();

    this.transactionHandler = () => {
      this.ngZone.run(() => {
        const sel = editor.state.selection as unknown as SelectionShape;
        this.isNodeSelection.set(!!sel.node);
        refreshItems();
        this.updateStates(editor);
        this.syncTrailingButtonsState(editor);
        this.activeVersion.update((v) => v + 1);
      });
    };
    editor.on('transaction', this.transactionHandler);
    this.updateStates(editor);
    this.syncTrailingButtonsState(editor);
  }

  /**
   * Refresh state for the optional trailing buttons (A color trigger,
   * "..." block menu) and the isNodeSelection flag. Called from both
   * setupItemTracking init and the per-transaction handler so the two
   * paths stay in sync.
   */
  private syncTrailingButtonsState(editor: Editor): void {
    this.isNodeSelection.set(
      !!(editor.state.selection as unknown as SelectionShape).node,
    );
    // Hidden without a live notionColorOpen listener: the trigger would be dead.
    this.showColorPickerButton.set(
      this.hasNotionColorPicker && editor.listenerCount('notionColorOpen') > 0,
    );
    if (this.showColorPickerButton()) this.syncColorTriggerState(editor);
    if (this.showBlockMenuButton()) this.syncBlockMenuButtonState(editor);
  }

  /**
   * Disable the "..." trigger when the selection spans more than one
   * top-level block. The block context menu targets the block at $from, so
   * a multi-block selection has no unambiguous target.
   */
  private syncBlockMenuButtonState(editor: Editor): void {
    const { $from, $to } = editor.state.selection;
    // depth(1) addresses the top-level child of doc; if either end is
    // shallower we can't compare blocks meaningfully.
    if ($from.depth < 1 || $to.depth < 1) {
      this.blockMenuButtonDisabled.set(true);
      return;
    }
    this.blockMenuButtonDisabled.set($from.before(1) !== $to.before(1));
  }

  /**
   * Update the trigger's indicator colors to mirror the current selection.
   * Used by the "A" button so the underline matches whatever the user has
   * applied at the cursor (Notion-style live preview).
   */
  private syncColorTriggerState(editor: Editor): void {
    const $from = editor.state.selection.$from;
    const mark = $from.marks().find((m) => m.type.name === 'textStyle');
    const attrs = (mark?.attrs ?? {}) as {
      colorToken?: string | null;
      backgroundColorToken?: string | null;
    };
    const textToken = attrs.colorToken ?? null;
    const bgToken = attrs.backgroundColorToken ?? null;
    this.currentTextColorVar.set(
      textToken ? `var(--dm-block-text-${textToken})` : null,
    );
    this.currentBgColorVar.set(
      bgToken ? `var(--dm-block-bg-${bgToken})` : null,
    );
    this.hasAnyColor.set(textToken !== null || bgToken !== null);
  }

  private updateStates(editor: Editor): void {
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try { canProxy = editor.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch { /* ignore */ }

    const trackButton = (btn: ToolbarButton): void => {
      this.activeMap.set(btn.name, ToolbarController.resolveActive(editor as never, btn));
      try {
        const canCmd = typeof btn.command === 'string' ? canProxy?.[btn.command] : undefined;
        this.disabledMap.set(btn.name, canCmd
          ? !(btn.commandArgs?.length ? canCmd(...btn.commandArgs) : canCmd())
          : false);
      } catch { this.disabledMap.set(btn.name, false); }
    };

    for (const item of this.resolvedItems()) {
      if (item.type === 'separator') continue;
      if (item.type === 'dropdown') {
        // Track each child so dynamicIcon + isActive lookups work.
        for (const sub of item.items) trackButton(sub);
        continue;
      }
      trackButton(item);
    }
  }

  // === Dropdown helpers (shared shape with toolbar.component.ts) ===

  asButton(item: BubbleMenuItem): ToolbarButton {
    return item as ToolbarButton;
  }

  asDropdown(item: BubbleMenuItem): ToolbarDropdown {
    return item as ToolbarDropdown;
  }

  isDropdownActive(dropdown: ToolbarDropdown): boolean {
    this.activeVersion();
    return dropdown.items.some((sub) => this.activeMap.get(sub.name) ?? false);
  }

  /** Trigger HTML: swap icon to the active child when `dynamicIcon` is set. */
  getDropdownTriggerHtml(dropdown: ToolbarDropdown): SafeHtml {
    this.activeVersion();
    const activeItem = dropdown.dynamicIcon
      ? dropdown.items.find((sub) => this.activeMap.get(sub.name))
      : undefined;
    const iconName = activeItem?.icon ?? dropdown.icon;
    const key = `t:${iconName}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      const custom = this.icons();
      const svg = custom?.[iconName] ?? defaultIcons[iconName] ?? '';
      cached = this.sanitizer.bypassSecurityTrustHtml(svg + this.dropdownCaret);
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  getCachedItemContent(iconName: string, label: string): SafeHtml {
    const key = `dc:${iconName}:${label}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      const custom = this.icons();
      const svg = custom?.[iconName] ?? defaultIcons[iconName] ?? '';
      cached = this.sanitizer.bypassSecurityTrustHtml(`${svg} ${label}`);
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  isSubItemActive(name: string): boolean {
    this.activeVersion();
    return this.activeMap.get(name) ?? false;
  }

  onDropdownToggle(dropdown: ToolbarDropdown, event?: MouseEvent): void {
    const isOpening = this.openDropdown() !== dropdown.name;
    this.cleanupDropdown();

    if (!isOpening) return;
    this.openDropdown.set(dropdown.name);

    // NOTE: we deliberately do NOT broadcast `dm:dismiss-overlays` here. The
    // bubble menu plugin in core listens for that event and would hide itself -
    // taking our just-opened dropdown's trigger with it.
    const editorElBroadcast = this.menuEl().nativeElement.closest<HTMLElement>('.dm-editor');

    // Position the panel against the trigger after Angular renders it. We
    // deliberately keep the panel INSIDE `.dm-bubble-menu` so it inherits the
    // bubble-menu-scoped button tokens (--dm-button-active-bg / --dm-button-
    requestAnimationFrame(() => {
      const trigger = (event?.currentTarget as HTMLElement | null)
        ?? this.menuEl().nativeElement.querySelector<HTMLElement>(`[data-dropdown="${dropdown.name}"]`);
      const panel = this.menuEl().nativeElement.querySelector<HTMLElement>(
        `[data-dropdown-panel="${dropdown.name}"]`,
      );
      if (!trigger || !panel) return;

      this.dropdownCleanupFloating?.();
      this.dropdownCleanupFloating = positionFloatingOnce(trigger, panel, {
        placement: 'bottom-start',
        offsetValue: 4,
      });
    });

    // Click-outside dismissal. mousedown is used so the dropdown closes
    // BEFORE the bubble menu's blur handler runs.
    const onOutside = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      const panel = document.querySelector<HTMLElement>(
        `[data-dropdown-panel="${dropdown.name}"]`,
      );
      const trigger = this.menuEl().nativeElement.querySelector<HTMLElement>(
        `[data-dropdown="${dropdown.name}"]`,
      );
      if (panel?.contains(target)) return;
      if (trigger?.contains(target)) return;
      this.cleanupDropdown();
    };
    document.addEventListener('mousedown', onOutside);
    this.dropdownOutsideHandler = onOutside;

    // Escape closes the dropdown.
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cleanupDropdown();
      }
    };
    document.addEventListener('keydown', onKeydown);
    this.dropdownKeydownHandler = onKeydown;

    // Listen for cooperative dismissals from other overlays opening.
    const onDismiss = (): void => { this.cleanupDropdown(); };
    if (editorElBroadcast) {
      editorElBroadcast.addEventListener('dm:dismiss-overlays', onDismiss);
      this.dropdownDismissHandler = (): void => {
        editorElBroadcast.removeEventListener('dm:dismiss-overlays', onDismiss);
      };
    }
  }

  onDropdownItemClick(item: ToolbarButton): void {
    this.cleanupDropdown();
    ToolbarController.executeItem(this.editor() as never, item);
    refocusEditorAfterCommand(this.editor().view);
  }

  private cleanupDropdown(): void {
    if (this.dropdownOutsideHandler) {
      document.removeEventListener('mousedown', this.dropdownOutsideHandler);
      this.dropdownOutsideHandler = null;
    }
    if (this.dropdownKeydownHandler) {
      document.removeEventListener('keydown', this.dropdownKeydownHandler);
      this.dropdownKeydownHandler = null;
    }
    if (this.dropdownDismissHandler) {
      this.dropdownDismissHandler();
      this.dropdownDismissHandler = null;
    }
    this.dropdownCleanupFloating?.();
    this.dropdownCleanupFloating = null;
    this.openDropdown.set(null);
  }

}
