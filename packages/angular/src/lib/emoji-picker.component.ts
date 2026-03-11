import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  OnDestroy,
  input,
  signal,
  computed,
  effect,
  inject,
  NgZone,
  ElementRef,
  untracked,
} from '@angular/core';

import { Editor, positionFloatingOnce } from '@domternal/core';

export interface EmojiPickerItem {
  emoji: string;
  name: string;
  group: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Smileys & Emotion': '\u{1F600}',
  'People & Body': '\u{1F44B}',
  'Animals & Nature': '\u{1F431}',
  'Food & Drink': '\u{1F355}',
  'Travel & Places': '\u{1F697}',
  'Activities': '\u{26BD}',
  'Objects': '\u{1F4A1}',
  'Symbols': '\u{1F523}',
  'Flags': '\u{1F3C1}',
};

@Component({
  selector: 'domternal-emoji-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'class': 'dm-emoji-picker-host' },
  template: `
    @if (isOpen()) {
      <div class="dm-emoji-picker">
        <div class="dm-emoji-picker-search">
          <input
            #searchInput
            type="text"
            placeholder="Search emoji..."
            [value]="searchQuery()"
            (input)="onSearch($event)"
            (keydown.escape)="close()"
          />
        </div>

        <div class="dm-emoji-picker-tabs" role="tablist">
          @for (cat of categoryNames(); track cat) {
            <button
              type="button"
              class="dm-emoji-picker-tab"
              [class.dm-emoji-picker-tab--active]="activeCategory() === cat"
              [title]="cat"
              (mousedown)="$event.preventDefault()"
              (click)="scrollToCategory(cat)"
            >{{ categoryIcon(cat) }}</button>
          }
        </div>

        <div class="dm-emoji-picker-grid" #grid (scroll)="onGridScroll()">
          @if (searchQuery()) {
            @for (item of filteredEmojis(); track item.name) {
              <button
                type="button"
                class="dm-emoji-swatch"
                [title]="formatName(item.name)"
                (mousedown)="$event.preventDefault()"
                (click)="selectEmoji(item)"
              >{{ item.emoji }}</button>
            }
            @empty {
              <div class="dm-emoji-picker-empty">No emoji found</div>
            }
          } @else {
            @if (frequentlyUsed().length) {
              <div class="dm-emoji-picker-category-label">Frequently Used</div>
              @for (item of frequentlyUsed(); track item.name) {
                <button
                  type="button"
                  class="dm-emoji-swatch"
                  [title]="formatName(item.name)"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectEmoji(item)"
                >{{ item.emoji }}</button>
              }
            }
            @for (cat of categoryNames(); track cat) {
              <div class="dm-emoji-picker-category-label" [attr.data-category]="cat">{{ cat }}</div>
              @for (item of getCategory(cat); track item.name) {
                <button
                  type="button"
                  class="dm-emoji-swatch"
                  [title]="formatName(item.name)"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectEmoji(item)"
                >{{ item.emoji }}</button>
              }
            }
          }
        </div>
      </div>
    }
  `,
})
export class DomternalEmojiPickerComponent implements OnDestroy {
  readonly editor = input.required<Editor>();
  readonly emojis = input.required<EmojiPickerItem[]>();

  readonly isOpen = signal(false);
  readonly searchQuery = signal('');
  readonly activeCategory = signal('');

  private anchorEl: HTMLElement | null = null;
  private ngZone = inject(NgZone);
  private elRef = inject(ElementRef);
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private eventHandler: ((...args: unknown[]) => void) | null = null;
  private cleanupFloating: (() => void) | null = null;

  readonly categories = computed(() => {
    const map = new Map<string, EmojiPickerItem[]>();
    for (const item of this.emojis()) {
      let list = map.get(item.group);
      if (!list) {
        list = [];
        map.set(item.group, list);
      }
      list.push(item);
    }
    return map;
  });

  readonly categoryNames = computed(() => [...this.categories().keys()]);

  readonly filteredEmojis = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return [];
    const storage = this.getEmojiStorage();
    const searchFn = storage?.['searchEmoji'] as ((q: string) => EmojiPickerItem[]) | undefined;
    if (searchFn) {
      return searchFn(query);
    }
    return this.emojis().filter(
      (item) =>
        item.name.includes(query) ||
        item.group.toLowerCase().includes(query),
    );
  });

  readonly frequentlyUsed = computed(() => {
    // Re-evaluate when panel opens (isOpen changes)
    this.isOpen();
    const storage = this.getEmojiStorage();
    const getFreq = storage?.['getFrequentlyUsed'] as (() => string[]) | undefined;
    if (!getFreq) return [];
    const names = getFreq();
    if (!names.length) return [];
    const nameMap = storage!['_nameMap'] as Map<string, EmojiPickerItem> | undefined;
    if (!nameMap) return [];
    return names.slice(0, 16).map((n) => nameMap.get(n)).filter(Boolean) as EmojiPickerItem[];
  });

  constructor() {
    effect(() => {
      const editor = this.editor();
      untracked(() => this.setupEventListener(editor));
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  getCategory(cat: string): EmojiPickerItem[] {
    return this.categories().get(cat) ?? [];
  }

  categoryIcon(cat: string): string {
    return CATEGORY_ICONS[cat] ?? cat.charAt(0);
  }

  formatName(name: string): string {
    return name.replace(/_/g, ' ');
  }

  onSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  selectEmoji(item: EmojiPickerItem): void {
    const editor = this.editor();
    const cmd = editor.commands as Record<string, (...args: unknown[]) => boolean>;
    if (cmd['insertEmoji']) {
      cmd['insertEmoji'](item.name);
    }
    this.close();
  }

  scrollToCategory(cat: string): void {
    this.searchQuery.set('');
    this.activeCategory.set(cat);

    // Wait for search to clear and DOM to update
    requestAnimationFrame(() => {
      const grid = this.elRef.nativeElement.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
      if (!grid) return;
      const label = grid.querySelector(`[data-category="${cat}"]`) as HTMLElement | null;
      if (label) {
        // Use manual scrollTop instead of scrollIntoView to avoid scrolling the page
        grid.scrollTo({ top: label.offsetTop - grid.offsetTop, behavior: 'smooth' });
      }
    });
  }

  onGridScroll(): void {
    const grid = this.elRef.nativeElement.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
    if (!grid || this.searchQuery()) return;

    const labels = Array.from(grid.querySelectorAll('.dm-emoji-picker-category-label[data-category]')) as HTMLElement[];

    let currentCat = '';
    for (const label of labels) {
      if (label.offsetTop - grid.offsetTop <= grid.scrollTop + 20) {
        currentCat = label.getAttribute('data-category') ?? '';
      }
    }

    if (currentCat && currentCat !== this.activeCategory()) {
      this.activeCategory.set(currentCat);
    }
  }

  close(): void {
    this.cleanupFloating?.();
    this.cleanupFloating = null;
    this.isOpen.set(false);
    this.setStorageOpen(false);
    this.searchQuery.set('');
    this.anchorEl = null;
    this.removeGlobalListeners();
  }

  private setupEventListener(editor: Editor): void {
    this.cleanup();

    this.eventHandler = (...args: unknown[]) => {
      const data = args[0] as { anchorElement?: HTMLElement } | undefined;
      this.ngZone.run(() => {
        if (this.isOpen()) {
          this.close();
          return;
        }

        this.anchorEl = data?.anchorElement ?? null;
        this.isOpen.set(true);
        this.setStorageOpen(true);
        this.searchQuery.set('');

        // Set initial active category
        const names = this.categoryNames();
        if (names.length > 0) {
          this.activeCategory.set(names[0]);
        }

        this.addGlobalListeners();

        // Position panel and focus search input after render
        requestAnimationFrame(() => {
          const panel = this.elRef.nativeElement.querySelector('.dm-emoji-picker') as HTMLElement | null;
          if (panel && this.anchorEl) {
            this.cleanupFloating?.();
            this.cleanupFloating = positionFloatingOnce(this.anchorEl, panel, {
              placement: 'bottom',
              offsetValue: 4,
            });
          }
          const input = this.elRef.nativeElement.querySelector('.dm-emoji-picker-search input') as HTMLInputElement | null;
          input?.focus();
        });
      });
    };

    (editor.on as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', this.eventHandler);
  }

  private addGlobalListeners(): void {
    this.clickOutsideHandler = (e: Event) => {
      const target = e.target as Node;
      if (
        this.isOpen() &&
        !this.elRef.nativeElement.contains(target) &&
        target !== this.anchorEl &&
        !this.anchorEl?.contains(target)
      ) {
        this.ngZone.run(() => this.close());
      }
    };
    document.addEventListener('mousedown', this.clickOutsideHandler);

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        this.ngZone.run(() => this.close());
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
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
  }

  private setStorageOpen(open: boolean): void {
    const storage = this.getEmojiStorage();
    if (storage) storage['isOpen'] = open;
    // Dispatch a no-op transaction so the toolbar's transaction handler
    // re-evaluates isActiveFn and shows the button as active/inactive.
    const editor = this.editor();
    editor.view.dispatch(editor.view.state.tr);
  }

  private getEmojiStorage(): Record<string, unknown> | null {
    const storage = this.editor().storage as Record<string, unknown>;
    return (storage['emoji'] as Record<string, unknown>) ?? null;
  }

  private cleanup(): void {
    this.removeGlobalListeners();
    if (this.eventHandler) {
      const editor = this.editor();
      (editor.off as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', this.eventHandler);
      this.eventHandler = null;
    }
  }
}
