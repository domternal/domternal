import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';

export interface EmojiPickerItem {
  emoji: string;
  name: string;
  group: string;
}

export interface UseEmojiPickerResult {
  isOpen: boolean;
  searchQuery: string;
  activeCategory: string;
  categories: Map<string, EmojiPickerItem[]>;
  categoryNames: string[];
  filteredEmojis: EmojiPickerItem[];
  frequentlyUsed: EmojiPickerItem[];
  pickerRef: RefObject<HTMLDivElement | null>;
  selectEmoji: (item: EmojiPickerItem) => void;
  onSearch: (event: React.ChangeEvent<HTMLInputElement>) => void;
  scrollToCategory: (cat: string) => void;
  onGridScroll: () => void;
  close: () => void;
}

export function useEmojiPicker(editor: Editor | null, emojis: EmojiPickerItem[]): UseEmojiPickerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  const pickerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const cleanupFloatingRef = useRef<(() => void) | null>(null);
  const clickOutsideRef = useRef<((e: Event) => void) | null>(null);
  const keydownRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const isOpenRef = useRef(false);

  const categories = useMemo(() => {
    const map = new Map<string, EmojiPickerItem[]>();
    for (const item of emojis) {
      let list = map.get(item.group);
      if (!list) { list = []; map.set(item.group, list); }
      list.push(item);
    }
    return map;
  }, [emojis]);

  const categoryNames = useMemo(() => [...categories.keys()], [categories]);

  const filteredEmojis = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return [];
    const storage = getEmojiStorage(editor);
    const searchFn = storage?.['searchEmoji'] as ((q: string) => EmojiPickerItem[]) | undefined;
    if (searchFn) return searchFn(query);
    return emojis.filter(
      (item) => item.name.includes(query) || item.group.toLowerCase().includes(query),
    );
  }, [searchQuery, emojis, editor]);

  const frequentlyUsed = useMemo(() => {
    // Re-evaluate when panel opens
    if (!isOpen) return [];
    const storage = getEmojiStorage(editor);
    if (!storage) return [];
    const getFreq = storage['getFrequentlyUsed'] as (() => string[]) | undefined;
    if (!getFreq) return [];
    const names = getFreq();
    if (!names.length) return [];
    const nameMap = storage['_nameMap'] as Map<string, EmojiPickerItem> | undefined;
    if (!nameMap) return [];
    return names.slice(0, 16).map((n) => nameMap.get(n)).filter(Boolean) as EmojiPickerItem[];
  }, [isOpen, editor]);

  const removeGlobalListeners = useCallback((): void => {
    if (clickOutsideRef.current) {
      document.removeEventListener('mousedown', clickOutsideRef.current);
      clickOutsideRef.current = null;
    }
    if (keydownRef.current) {
      document.removeEventListener('keydown', keydownRef.current);
      keydownRef.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    cleanupFloatingRef.current?.();
    cleanupFloatingRef.current = null;
    isOpenRef.current = false;
    setIsOpen(false);
    setStorageOpen(editor, false);
    setSearchQuery('');
    anchorRef.current = null;
    removeGlobalListeners();
    editor?.view.focus();
  }, [editor, removeGlobalListeners]);

  const addGlobalListeners = useCallback((): void => {
    clickOutsideRef.current = (e: Event): void => {
      const target = e.target as Node;
      if (
        pickerRef.current &&
        !pickerRef.current.contains(target) &&
        target !== anchorRef.current &&
        !anchorRef.current?.contains(target)
      ) {
        // Defer close to next frame so the current mousedown/click cycle
        // completes without React re-rendering and replacing DOM nodes
        // (which would swallow the click event on toolbar buttons).
        requestAnimationFrame(() => { close(); });
      }
    };
    document.addEventListener('mousedown', clickOutsideRef.current);

    keydownRef.current = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', keydownRef.current);
  }, [close]);

  // Listen to insertEmoji event
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handler = (...args: unknown[]): void => {
      const data = args[0] as { anchorElement?: HTMLElement } | undefined;

      if (isOpenRef.current) {
        close();
        return;
      }

      anchorRef.current = data?.anchorElement ?? null;
      isOpenRef.current = true;
      setIsOpen(true);
      setStorageOpen(editor, true);
      setSearchQuery('');

      if (categoryNames.length > 0 && categoryNames[0]) {
        setActiveCategory(categoryNames[0]);
      }

      addGlobalListeners();

      requestAnimationFrame(() => {
        const panel = pickerRef.current?.querySelector<HTMLElement>('.dm-emoji-picker');
        if (panel && anchorRef.current) {
          cleanupFloatingRef.current?.();
          cleanupFloatingRef.current = positionFloatingOnce(anchorRef.current, panel, {
            placement: 'bottom',
            offsetValue: 4,
          });
        }
        const input = pickerRef.current?.querySelector<HTMLInputElement>('.dm-emoji-picker-search input');
        input?.focus({ preventScroll: true });
      });
    };

    (editor.on as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);

    return () => {
      removeGlobalListeners();
      (editor.off as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);
    };
    // Effect re-runs only when the editor instance changes. Picker state
    // (open/closed, items) is held in refs read by the handler closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const selectEmoji = useCallback((item: EmojiPickerItem): void => {
    if (!editor) return;
    const cmd = editor.commands as Record<string, (...args: unknown[]) => boolean>;
    if (cmd['insertEmoji']) {
      cmd['insertEmoji'](item.name);
    }
    close();
  }, [editor, close]);

  const onSearch = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(event.target.value);
  }, []);

  const scrollToCategory = useCallback((cat: string): void => {
    setSearchQuery('');
    setActiveCategory(cat);
    requestAnimationFrame(() => {
      const grid = pickerRef.current?.querySelector<HTMLElement>('.dm-emoji-picker-grid');
      if (!grid) return;
      const label = grid.querySelector<HTMLElement>(`[data-category="${cat}"]`);
      if (label) {
        grid.scrollTo({ top: label.offsetTop - grid.offsetTop });
        // Focus first emoji swatch after scroll completes
        setTimeout(() => {
          const firstSwatch = label.nextElementSibling;
          if (firstSwatch instanceof HTMLElement && firstSwatch.classList.contains('dm-emoji-swatch')) {
            firstSwatch.focus();
          }
        }, 50);
      }
    });
  }, []);

  const activeCategoryRef = useRef(activeCategory);
  activeCategoryRef.current = activeCategory;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const onGridScroll = useCallback((): void => {
    if (searchQueryRef.current) return;
    const grid = pickerRef.current?.querySelector<HTMLElement>('.dm-emoji-picker-grid');
    if (!grid) return;

    const labels = Array.from(grid.querySelectorAll<HTMLElement>('.dm-emoji-picker-category-label[data-category]'));
    let currentCat = '';
    for (const label of labels) {
      if (label.offsetTop - grid.offsetTop <= grid.scrollTop + 20) {
        currentCat = label.getAttribute('data-category') ?? '';
      }
    }
    if (currentCat && currentCat !== activeCategoryRef.current) {
      setActiveCategory(currentCat);
    }
  }, []);

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
  const storage = editor.storage;
  return (storage['emoji'] as Record<string, unknown> | undefined) ?? null;
}

function setStorageOpen(editor: Editor | null, open: boolean): void {
  if (!editor) return;
  const storage = getEmojiStorage(editor);
  if (storage) storage['isOpen'] = open;
  editor.view.dispatch(editor.view.state.tr);
}
