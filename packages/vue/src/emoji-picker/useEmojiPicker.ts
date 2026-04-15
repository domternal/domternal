import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ShallowRef } from 'vue';
import { positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';

export interface EmojiPickerItem {
  emoji: string;
  name: string;
  group: string;
}

/**
 * Delay before focusing a swatch after scrollTo - prevents onGridScroll from
 * overwriting activeCategory during the browser's native scroll settle.
 */
const SCROLL_SETTLE_MS = 50;

export function useEmojiPicker(editor: ShallowRef<Editor | null>, emojis: EmojiPickerItem[]) {
  const isOpen = ref(false);
  const searchQuery = ref('');
  const activeCategory = ref('');

  const pickerRef = ref<HTMLDivElement>();
  let anchorEl: HTMLElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  let clickOutsideHandler: ((e: Event) => void) | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  const categories = computed(() => {
    const map = new Map<string, EmojiPickerItem[]>();
    for (const item of emojis) {
      let list = map.get(item.group);
      if (!list) { list = []; map.set(item.group, list); }
      list.push(item);
    }
    return map;
  });

  const categoryNames = computed(() => [...categories.value.keys()]);

  const filteredEmojis = computed(() => {
    const query = searchQuery.value.toLowerCase();
    if (!query) return [];
    const storage = getEmojiStorage(editor.value);
    const searchFn = storage?.['searchEmoji'] as ((q: string) => EmojiPickerItem[]) | undefined;
    if (searchFn) return searchFn(query);
    return emojis.filter(
      (item) => item.name.includes(query) || item.group.toLowerCase().includes(query),
    );
  });

  const frequentlyUsed = computed(() => {
    if (!isOpen.value) return [];
    const storage = getEmojiStorage(editor.value);
    const getFreq = storage?.['getFrequentlyUsed'] as (() => string[]) | undefined;
    if (!getFreq) return [];
    const names = getFreq();
    if (!names.length) return [];
    const nameMap = storage!['_nameMap'] as Map<string, EmojiPickerItem> | undefined;
    if (!nameMap) return [];
    return names.slice(0, 16).map((n) => nameMap.get(n)).filter(Boolean) as EmojiPickerItem[];
  });

  function removeGlobalListeners() {
    if (clickOutsideHandler) {
      document.removeEventListener('mousedown', clickOutsideHandler);
      clickOutsideHandler = null;
    }
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  }

  function close() {
    cleanupFloating?.();
    cleanupFloating = null;
    isOpen.value = false;
    setStorageOpen(editor.value, false);
    searchQuery.value = '';
    anchorEl = null;
    removeGlobalListeners();
    editor.value?.view.focus();
  }

  function addGlobalListeners() {
    clickOutsideHandler = (e: Event) => {
      const target = e.target as Node;
      if (
        pickerRef.value &&
        !pickerRef.value.contains(target) &&
        target !== anchorEl &&
        !anchorEl?.contains(target)
      ) {
        requestAnimationFrame(() => close());
      }
    };
    document.addEventListener('mousedown', clickOutsideHandler);

    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }

  // Listen to insertEmoji event
  watch(
    editor,
    (ed, _oldEd, onCleanup) => {
      if (!ed || ed.isDestroyed) return;

      const handler = (...args: unknown[]) => {
        const data = args[0] as { anchorElement?: HTMLElement } | undefined;

        if (isOpen.value) {
          close();
          return;
        }

        anchorEl = data?.anchorElement ?? null;
        isOpen.value = true;
        setStorageOpen(ed, true);
        searchQuery.value = '';

        if (categoryNames.value.length > 0 && categoryNames.value[0]) {
          activeCategory.value = categoryNames.value[0];
        }

        addGlobalListeners();

        requestAnimationFrame(() => {
          const panel = pickerRef.value?.querySelector('.dm-emoji-picker') as HTMLElement | null;
          if (panel && anchorEl) {
            cleanupFloating?.();
            cleanupFloating = positionFloatingOnce(anchorEl, panel, {
              placement: 'bottom',
              offsetValue: 4,
            });
          }
          const input = pickerRef.value?.querySelector('.dm-emoji-picker-search input') as HTMLInputElement | null;
          input?.focus({ preventScroll: true });
        });
      };

      (ed.on as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);

      onCleanup(() => {
        removeGlobalListeners();
        (ed.off as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);
      });
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    removeGlobalListeners();
    cleanupFloating?.();
    cleanupFloating = null;
  });

  function selectEmoji(item: EmojiPickerItem) {
    const ed = editor.value;
    if (!ed) return;
    const cmd = ed.commands as Record<string, (...args: unknown[]) => boolean>;
    if (cmd['insertEmoji']) {
      cmd['insertEmoji'](item.name);
    }
    close();
  }

  function onSearch(event: Event) {
    searchQuery.value = (event.target as HTMLInputElement).value;
  }

  function scrollToCategory(cat: string) {
    searchQuery.value = '';
    activeCategory.value = cat;
    requestAnimationFrame(() => {
      const grid = pickerRef.value?.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
      if (!grid) return;
      const label = grid.querySelector(`[data-category="${cat}"]`) as HTMLElement | null;
      if (label) {
        grid.scrollTo({ top: label.offsetTop - grid.offsetTop });
        // Defer focus until after scroll completes to avoid onGridScroll
        // resetting activeCategory while the scroll animation is in progress.
        setTimeout(() => {
          const firstSwatch = label.nextElementSibling;
          if (firstSwatch instanceof HTMLElement && firstSwatch.classList.contains('dm-emoji-swatch')) {
            firstSwatch.focus();
          }
        }, SCROLL_SETTLE_MS);
      }
    });
  }

  function onGridScroll() {
    if (searchQuery.value) return;
    const grid = pickerRef.value?.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
    if (!grid) return;

    const labels = Array.from(grid.querySelectorAll('.dm-emoji-picker-category-label[data-category]')) as HTMLElement[];
    let currentCat = '';
    for (const label of labels) {
      if (label.offsetTop - grid.offsetTop <= grid.scrollTop + 20) {
        currentCat = label.getAttribute('data-category') ?? '';
      }
    }
    if (currentCat && currentCat !== activeCategory.value) {
      activeCategory.value = currentCat;
    }
  }

  return {
    isOpen,
    searchQuery,
    activeCategory,
    categories,
    categoryNames,
    filteredEmojis,
    frequentlyUsed,
    pickerRef,
    selectEmoji,
    onSearch,
    scrollToCategory,
    onGridScroll,
    close,
  };
}

function getEmojiStorage(editor: Editor | null): Record<string, unknown> | null {
  if (!editor) return null;
  const storage = editor.storage as Record<string, unknown>;
  return (storage['emoji'] as Record<string, unknown>) ?? null;
}

function setStorageOpen(editor: Editor | null, open: boolean): void {
  if (!editor) return;
  const storage = getEmojiStorage(editor);
  if (storage) storage['isOpen'] = open;
  editor.view.dispatch(editor.view.state.tr);
}
