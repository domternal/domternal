import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  OnDestroy,
  input,
  signal,
  effect,
  inject,
  NgZone,
  ElementRef,
  untracked,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import {
  Editor,
  ToolbarController,
  defaultIcons,
  positionFloatingOnce,
} from '@domternal/core';
import type {
  ToolbarItem,
  ToolbarButton,
  ToolbarDropdown,
  ToolbarControllerEditor,
  IconSet,
  ToolbarGroup,
  ToolbarLayoutEntry,
} from '@domternal/core';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

@Component({
  selector: 'domternal-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    'class': 'dm-toolbar',
    'role': 'toolbar',
    '[attr.aria-label]': '"Editor formatting"',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    @for (group of groups(); track group.name; let gi = $index) {
      @if (gi > 0) {
        <div class="dm-toolbar-separator" role="separator"></div>
      }
      <div class="dm-toolbar-group" role="group" [attr.aria-label]="group.name || 'Tools'">
        @for (item of group.items; track item.name) {
          @if (item.type === 'button') {
            <button
              type="button"
              class="dm-toolbar-button"
              [class.dm-toolbar-button--active]="isActive(item.name)"
              [attr.aria-pressed]="isActive(item.name)"
              [attr.aria-expanded]="getAriaExpanded(asButton(item))"
              [attr.aria-label]="asButton(item).label"
              [title]="getTooltip(asButton(item))"
              [tabindex]="getFlatIndex(item.name) === focusedIndex() ? 0 : -1"
              [disabled]="isDisabled(item.name)"
              [innerHTML]="getCachedIcon(asButton(item).icon)"
              (mousedown)="$event.preventDefault()"
              (click)="onButtonClick(asButton(item), $event)"
              (focus)="onButtonFocus(item.name)"
            ></button>
          }
          @if (item.type === 'dropdown') {
            <div class="dm-toolbar-dropdown-wrapper">
              <button
                type="button"
                class="dm-toolbar-button dm-toolbar-dropdown-trigger"
                [class.dm-toolbar-button--active]="isDropdownActive(asDropdown(item))"
                [attr.aria-expanded]="openDropdown() === asDropdown(item).name"
                [attr.aria-haspopup]="'true'"
                [attr.aria-label]="asDropdown(item).label"
                [title]="asDropdown(item).label"
                [tabindex]="getFlatIndex(item.name) === focusedIndex() ? 0 : -1"
                [disabled]="isDisabled(asDropdown(item).name)"
                [attr.data-dropdown]="asDropdown(item).name"
                [innerHTML]="getDropdownTriggerHtml(asDropdown(item))"
                (mousedown)="$event.preventDefault()"
                (click)="onDropdownToggle(asDropdown(item))"
                (focus)="onButtonFocus(item.name)"
              ></button>
              @if (openDropdown() === asDropdown(item).name) {
                @if (asDropdown(item).layout === 'grid') {
                  <div class="dm-toolbar-dropdown-panel dm-color-palette" role="menu"
                       [attr.style]="getGridStyle(asDropdown(item))">
                    @for (sub of asDropdown(item).items; track sub.name) {
                      @if (sub.color) {
                        <button
                          type="button"
                          class="dm-color-swatch"
                          [class.dm-color-swatch--active]="isActive(sub.name)"
                          role="menuitem"
                          [attr.aria-label]="sub.label"
                          [title]="sub.label"
                          [style.background-color]="sub.color"
                          (mousedown)="$event.preventDefault()"
                          (click)="onDropdownItemClick(sub)"
                        ></button>
                      } @else {
                        <button
                          type="button"
                          class="dm-color-palette-reset"
                          role="menuitem"
                          [attr.aria-label]="sub.label"
                          [innerHTML]="getCachedItemContent(sub.icon, sub.label)"
                          (mousedown)="$event.preventDefault()"
                          (click)="onDropdownItemClick(sub)"
                        ></button>
                      }
                    }
                  </div>
                } @else {
                  <div class="dm-toolbar-dropdown-panel" role="menu"
                       [attr.data-display-mode]="asDropdown(item).displayMode ?? null">
                    @for (sub of asDropdown(item).items; track sub.name) {
                      <button
                        type="button"
                        class="dm-toolbar-dropdown-item"
                        [class.dm-toolbar-dropdown-item--active]="isActive(sub.name)"
                        role="menuitem"
                        [attr.aria-label]="sub.label"
                        [attr.style]="sub.style ?? null"
                        [innerHTML]="getCachedItemContent(sub.icon, sub.label, asDropdown(item).displayMode)"
                        (mousedown)="$event.preventDefault()"
                        (click)="onDropdownItemClick(sub)"
                      ></button>
                    }
                  </div>
                }
              }
            </div>
          }
        }
      </div>
    }
  `,
})
export class DomternalToolbarComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly icons = input<IconSet | null>(null);
  readonly layout = input<ToolbarLayoutEntry[]>();

  /** Exposed state signals for template */
  readonly groups = signal<ToolbarGroup[]>([]);
  readonly focusedIndex = signal(0);
  readonly openDropdown = signal<string | null>(null);
  /** Bumped on active state changes to trigger re-evaluation of isActive() */
  readonly activeVersion = signal(0);

  private controller: ToolbarController | null = null;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  private cleanupFloating: (() => void) | null = null;
  private ngZone = inject(NgZone);
  private elRef = inject(ElementRef);
  private sanitizer = inject(DomSanitizer);

  /** SafeHtml cache — same reference returned for same key, prevents DOM churn */
  private htmlCache = new Map<string, SafeHtml>();

  private readonly dropdownCaret = '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  constructor() {
    effect(() => {
      const editor = this.editor();
      untracked(() => this.setupController(editor));
    });
  }

  ngOnDestroy(): void {
    this.destroyController();
  }

  // === Template helpers ===

  isActive(name: string): boolean {
    this.activeVersion(); // subscribe to changes
    return this.controller?.activeMap.get(name) ?? false;
  }

  isDisabled(name: string): boolean {
    this.activeVersion(); // subscribe to changes
    return this.controller?.disabledMap.get(name) ?? false;
  }

  isDropdownActive(dropdown: ToolbarDropdown): boolean {
    if (dropdown.layout === 'grid') return false; // color dropdowns use bar indicator instead
    if (dropdown.dynamicLabel) return false; // label text already communicates state
    this.activeVersion(); // subscribe to changes
    return dropdown.items.some((item) => this.controller?.activeMap.get(item.name) ?? false);
  }

  /** Returns trigger innerHTML: dynamic icon + caret (+ color indicator for grid dropdowns). */
  getDropdownTriggerHtml(dropdown: ToolbarDropdown): SafeHtml {
    this.activeVersion(); // subscribe to changes
    const activeItem = dropdown.items.find((item) => this.controller?.activeMap.get(item.name));

    if (dropdown.layout === 'grid') {
      const color = activeItem?.color ?? dropdown.defaultIndicatorColor ?? null;
      const key = `tr:${dropdown.icon}:${color ?? ''}`;
      let cached = this.htmlCache.get(key);
      if (!cached) {
        let html = this.resolveIconSvg(dropdown.icon) + this.dropdownCaret;
        if (color) {
          html += `<span class="dm-toolbar-color-indicator" style="background-color: ${color}"></span>`;
        }
        cached = this.sanitizer.bypassSecurityTrustHtml(html);
        this.htmlCache.set(key, cached);
      }
      return cached;
    }

    // Non-grid dropdown — show active sub-item's label as text
    if (dropdown.dynamicLabel) {
      if (activeItem) return this.getCachedTriggerLabel(activeItem.label);

      // Try reading CSS property from DOM (inline or computed depending on property)
      if (dropdown.computedStyleProperty) {
        let computed: string | null;
        if (dropdown.computedStyleProperty === 'font-family') {
          // Font-family: read ONLY inline style (explicit mark), not computed (browser default)
          computed = this.getInlineStyleAtCursor(dropdown.computedStyleProperty);
          if (computed) {
            const first = computed.split(',')[0].replace(/['"]+/g, '').trim();
            computed = first || null;
          }
        } else {
          computed = this.getComputedStyleAtCursor(dropdown.computedStyleProperty);
        }
        if (computed) return this.getCachedTriggerLabel(computed);
      }

      if (dropdown.dynamicLabelFallback) {
        return this.getCachedTriggerLabel(dropdown.dynamicLabelFallback);
      }
      return this.getCachedTriggerLabel(dropdown.icon, true);
    }
    const icon = dropdown.dynamicIcon && activeItem ? activeItem.icon : dropdown.icon;
    return this.getCachedTriggerIcon(icon);
  }

  /**
   * Returns 'true' when an emitEvent button's panel is open, null otherwise.
   * Maps to [attr.aria-expanded] — null removes the attribute entirely.
   */
  getAriaExpanded(item: ToolbarButton): string | null {
    if (!item.emitEvent) return null;
    this.activeVersion(); // subscribe to changes
    return this.controller?.expandedMap.get(item.name) ? 'true' : null;
  }

  getFlatIndex(name: string): number {
    return this.controller?.getFlatIndex(name) ?? -1;
  }

  getTooltip(item: ToolbarButton): string {
    if (item.shortcut) {
      const mod = isMac ? '\u2318' : 'Ctrl';
      const shortcut = item.shortcut
        .replace('Mod', mod)
        .replace('Shift', '\u21E7')
        .replace('Alt', isMac ? '\u2325' : 'Alt');
      return `${item.label} (${shortcut})`;
    }
    return item.label;
  }

  getCachedIcon(name: string): SafeHtml {
    const key = `i:${name}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(this.resolveIconSvg(name));
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  getCachedTriggerLabel(label: string, isIcon?: boolean): SafeHtml {
    const key = `tl:${label}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      const content = isIcon ? this.resolveIconSvg(label) : label;
      cached = this.sanitizer.bypassSecurityTrustHtml(
        `<span class="dm-toolbar-trigger-label">${content}</span>` + this.dropdownCaret,
      );
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  getCachedTriggerIcon(iconName: string): SafeHtml {
    const key = `t:${iconName}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(this.resolveIconSvg(iconName) + this.dropdownCaret);
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  getCachedItemContent(iconName: string, label: string, displayMode?: 'icon-text' | 'text' | 'icon'): SafeHtml {
    const mode = displayMode ?? 'icon-text';
    const key = `dc:${iconName}:${label}:${mode}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      let html: string;
      if (mode === 'text') {
        html = label;
      } else if (mode === 'icon') {
        html = this.resolveIconSvg(iconName);
      } else {
        html = this.resolveIconSvg(iconName) + ' ' + label;
      }
      cached = this.sanitizer.bypassSecurityTrustHtml(html);
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  asButton(item: ToolbarItem): ToolbarButton {
    return item as ToolbarButton;
  }

  asDropdown(item: ToolbarItem): ToolbarDropdown {
    return item as ToolbarDropdown;
  }

  getGridStyle(dropdown: ToolbarDropdown): string {
    return `--dm-palette-columns: ${String(dropdown.gridColumns ?? 10)}`;
  }

  // === Event handlers ===

  onButtonClick(item: ToolbarButton, event?: MouseEvent): void {
    // Close any open dropdown when clicking a regular button
    if (this.openDropdown()) {
      this.cleanupFloating?.();
      this.cleanupFloating = null;
      this.controller?.closeDropdown();
      this.syncState();
    }

    if (item.emitEvent) {
      const anchor = event?.currentTarget as HTMLElement | undefined;
      // emitEvent is a dynamic string; cast needed to bypass strict EventEmitter<EditorEvents> typing
      (this.editor().emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      return;
    }
    this.controller?.executeCommand(item);
  }

  onDropdownToggle(dropdown: ToolbarDropdown): void {
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    this.controller?.toggleDropdown(dropdown.name);
    this.syncState();

    // Position the panel after Angular renders it (tracks resize, not scroll)
    if (this.openDropdown()) {
      requestAnimationFrame(() => {
        const trigger = this.elRef.nativeElement.querySelector(
          `[aria-expanded="true"]`,
        ) as HTMLElement | null;
        const panel = trigger?.parentElement?.querySelector(
          '.dm-toolbar-dropdown-panel',
        ) as HTMLElement | null;
        if (trigger && panel) {
          // List dropdowns align to trigger's left edge; grid/picker dropdowns center
          const placement = dropdown.layout === 'grid' ? 'bottom' : 'bottom-start';
          this.cleanupFloating = positionFloatingOnce(trigger, panel, {
            placement,
            offsetValue: 4,
          });
        }
      });
    }
  }

  onDropdownItemClick(item: ToolbarButton): void {
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    this.controller?.executeCommand(item);
    this.controller?.closeDropdown();
  }

  onButtonFocus(name: string): void {
    const index = this.controller?.getFlatIndex(name) ?? -1;
    if (index >= 0) {
      this.controller?.setFocusedIndex(index);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.controller) return;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.controller.navigateNext();
        this.focusCurrentButton();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.controller.navigatePrev();
        this.focusCurrentButton();
        break;
      case 'Home':
        event.preventDefault();
        this.controller.navigateFirst();
        this.focusCurrentButton();
        break;
      case 'End':
        event.preventDefault();
        this.controller.navigateLast();
        this.focusCurrentButton();
        break;
      case 'Escape':
        if (this.openDropdown()) {
          event.preventDefault();
          this.cleanupFloating?.();
          this.cleanupFloating = null;
          this.controller.closeDropdown();
          this.syncState();
          this.focusCurrentButton();
        }
        break;
    }
  }

  // === Private ===

  private resolveIconSvg(name: string): string {
    const customIcons = this.icons();
    if (customIcons) {
      return customIcons[name] ?? '';
    }
    return defaultIcons[name] ?? '';
  }

  private setupController(editor: Editor): void {
    this.destroyController();

    this.controller = new ToolbarController(
      editor as unknown as ToolbarControllerEditor,
      () => this.ngZone.run(() => this.syncState()),
      this.layout(),
    );
    this.controller.subscribe();
    this.syncState();

    // Click outside to close dropdown
    this.clickOutsideHandler = (e: Event) => {
      if (this.openDropdown() && !this.elRef.nativeElement.contains(e.target as Node)) {
        this.cleanupFloating?.();
        this.cleanupFloating = null;
        this.controller?.closeDropdown();
        this.ngZone.run(() => this.syncState());
      }
    };
    document.addEventListener('mousedown', this.clickOutsideHandler);
  }

  private destroyController(): void {
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    if (this.clickOutsideHandler) {
      document.removeEventListener('mousedown', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    if (this.controller) {
      this.controller.destroy();
      this.controller = null;
    }
  }

  private syncState(): void {
    if (!this.controller) return;

    // Only update groups if they actually changed (initial build or rebuild)
    const controllerGroups = this.controller.groups;
    if (this.groups().length !== controllerGroups.length) {
      this.groups.set(controllerGroups);
    }

    this.focusedIndex.set(this.controller.focusedIndex);
    this.openDropdown.set(this.controller.openDropdown);

    // Bump version to trigger isActive() re-evaluation without creating new objects
    this.activeVersion.update(v => v + 1);
  }

  private getComputedStyleAtCursor(prop: string): string | null {
    try {
      const { from } = this.editor().state.selection;
      const resolved = this.editor().view.domAtPos(from);
      const el = resolved.node instanceof HTMLElement
        ? resolved.node
        : resolved.node.parentElement;
      if (!el) return null;
      // Prefer inline style (explicit mark) over computed style (inherited from heading, etc.)
      return el.style.getPropertyValue(prop)
        || window.getComputedStyle(el).getPropertyValue(prop)
        || null;
    } catch {
      return null;
    }
  }

  /** Read only inline style — no computed fallback (used for font-family). */
  private getInlineStyleAtCursor(prop: string): string | null {
    try {
      const { from } = this.editor().state.selection;
      const resolved = this.editor().view.domAtPos(from);
      const el = resolved.node instanceof HTMLElement
        ? resolved.node
        : resolved.node.parentElement;
      if (!el) return null;
      return el.style.getPropertyValue(prop) || null;
    } catch {
      return null;
    }
  }

  private focusCurrentButton(): void {
    const idx = this.controller?.focusedIndex ?? 0;
    const buttons = this.elRef.nativeElement.querySelectorAll(
      '.dm-toolbar-button'
    ) as NodeListOf<HTMLButtonElement>;
    buttons[idx]?.focus();
  }
}
