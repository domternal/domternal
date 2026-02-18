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
  DualIconSet,
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
              [innerHTML]="getIcon(asButton(item).icon)"
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
                [innerHTML]="getIcon(asDropdown(item).icon) + dropdownCaret"
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
                      [innerHTML]="getIcon(sub.icon) + ' ' + sub.label"
                      (mousedown)="$event.preventDefault()"
                      (click)="onDropdownItemClick(asDropdown(item), sub)"
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
  readonly iconWeight = input<'regular' | 'fill'>('regular');
  readonly icons = input<DualIconSet | IconSet | null>(null);

  /** Exposed state signals for template */
  readonly groups = signal<ToolbarGroup[]>([]);
  readonly focusedIndex = signal(0);
  readonly openDropdown = signal<string | null>(null);

  private activeMap = signal(new Map<string, boolean>());
  private controller: ToolbarController | null = null;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  private ngZone = inject(NgZone);
  private elRef = inject(ElementRef);

  readonly dropdownCaret = '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
    return this.activeMap().get(name) ?? false;
  }

  isDropdownActive(dropdown: ToolbarDropdown): boolean {
    return dropdown.items.some((item) => this.isActive(item.name));
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

  getIcon(name: string): string {
    const customIcons = this.icons();
    const weight = this.iconWeight();

    if (customIcons) {
      if ('regular' in customIcons && 'fill' in customIcons) {
        return (customIcons as DualIconSet)[weight]?.[name] ?? '';
      }
      return (customIcons as IconSet)[name] ?? '';
    }

    return defaultIcons[weight]?.[name] ?? '';
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
    this.syncState();
  }

  onDropdownToggle(dropdown: ToolbarDropdown): void {
    this.controller?.toggleDropdown(dropdown.name);
    this.syncState();
  }

  onDropdownItemClick(_dropdown: ToolbarDropdown, item: ToolbarButton): void {
    this.controller?.executeCommand(item);
    this.controller?.closeDropdown();
    this.syncState();
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
    this.groups.set([...this.controller.groups]);
    this.focusedIndex.set(this.controller.focusedIndex);
    this.openDropdown.set(this.controller.openDropdown);
    this.activeMap.set(new Map(this.controller.activeMap));
  }

  private focusCurrentButton(): void {
    this.syncState();
    const idx = this.controller?.focusedIndex ?? 0;
    const buttons = this.elRef.nativeElement.querySelectorAll(
      '.dm-toolbar-button'
    ) as NodeListOf<HTMLButtonElement>;
    buttons[idx]?.focus();
  }
}
