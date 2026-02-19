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
} from '@domternal/core';
import type {
  ToolbarItem,
  ToolbarButton,
  ToolbarDropdown,
  ToolbarControllerEditor,
  IconSet,
  ToolbarGroup,
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
        @for (item of group.items; track $index) {
          @if (item.type === 'button') {
            <button
              type="button"
              class="dm-toolbar-button"
              [class.dm-toolbar-button--active]="isActive(item.name)"
              [attr.aria-pressed]="isActive(item.name)"
              [attr.aria-label]="asButton(item).label"
              [title]="getTooltip(asButton(item))"
              [tabindex]="getFlatIndex(item.name) === focusedIndex() ? 0 : -1"
              [innerHTML]="getCachedIcon(asButton(item).icon)"
              (mousedown)="$event.preventDefault()"
              (click)="onButtonClick(asButton(item))"
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
                [innerHTML]="getCachedTriggerIcon(asDropdown(item).icon)"
                (mousedown)="$event.preventDefault()"
                (click)="onDropdownToggle(asDropdown(item))"
                (focus)="onButtonFocus(item.name)"
              ></button>
              @if (openDropdown() === asDropdown(item).name) {
                <div class="dm-toolbar-dropdown-panel" role="menu">
                  @for (sub of asDropdown(item).items; track sub.name) {
                    <button
                      type="button"
                      class="dm-toolbar-dropdown-item"
                      [class.dm-toolbar-dropdown-item--active]="isActive(sub.name)"
                      role="menuitem"
                      [attr.aria-label]="sub.label"
                      [innerHTML]="getCachedItemIcon(sub.icon, sub.label)"
                      (mousedown)="$event.preventDefault()"
                      (click)="onDropdownItemClick(sub)"
                    ></button>
                  }
                </div>
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

  /** Exposed state signals for template */
  readonly groups = signal<ToolbarGroup[]>([]);
  readonly focusedIndex = signal(0);
  readonly openDropdown = signal<string | null>(null);
  /** Bumped on active state changes to trigger re-evaluation of isActive() */
  readonly activeVersion = signal(0);

  private controller: ToolbarController | null = null;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
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

  isDropdownActive(dropdown: ToolbarDropdown): boolean {
    this.activeVersion(); // subscribe to changes
    return dropdown.items.some((item) => this.controller?.activeMap.get(item.name) ?? false);
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

  getCachedTriggerIcon(iconName: string): SafeHtml {
    const key = `t:${iconName}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(this.resolveIconSvg(iconName) + this.dropdownCaret);
      this.htmlCache.set(key, cached);
    }
    return cached;
  }

  getCachedItemIcon(iconName: string, label: string): SafeHtml {
    const key = `d:${iconName}:${label}`;
    let cached = this.htmlCache.get(key);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(this.resolveIconSvg(iconName) + ' ' + label);
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

  // === Event handlers ===

  onButtonClick(item: ToolbarButton): void {
    this.controller?.executeCommand(item);
  }

  onDropdownToggle(dropdown: ToolbarDropdown): void {
    this.controller?.toggleDropdown(dropdown.name);
  }

  onDropdownItemClick(item: ToolbarButton): void {
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

    this.controller = new ToolbarController(editor as unknown as ToolbarControllerEditor, () => {
      this.ngZone.run(() => this.syncState());
    });
    this.controller.subscribe();
    this.syncState();

    // Click outside to close dropdown
    this.clickOutsideHandler = (e: Event) => {
      if (this.openDropdown() && !this.elRef.nativeElement.contains(e.target as Node)) {
        this.controller?.closeDropdown();
        this.ngZone.run(() => this.syncState());
      }
    };
    document.addEventListener('mousedown', this.clickOutsideHandler);
  }

  private destroyController(): void {
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

  private focusCurrentButton(): void {
    const idx = this.controller?.focusedIndex ?? 0;
    const buttons = this.elRef.nativeElement.querySelectorAll(
      '.dm-toolbar-button'
    ) as NodeListOf<HTMLButtonElement>;
    buttons[idx]?.focus();
  }
}
