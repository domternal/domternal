import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';

export interface EmojiPickerItem {
  emoji: string;
  name: string;
  group: string;
}

export function useEmojiPicker(editor: Editor | null, emojis: EmojiPickerItem[]) {
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
    const getFreq = storage?.['getFrequentlyUsed'] as (() => string[]) | undefined;
    if (!getFreq) return [];
    const names = getFreq();
    if (!names.length) return [];
    const nameMap = storage!['_nameMap'] as Map<string, EmojiPickerItem> | undefined;
    if (!nameMap) return [];
    return names.slice(0, 16).map((n) => nameMap.get(n)).filter(Boolean) as EmojiPickerItem[];
  }, [isOpen, editor]);

  const removeGlobalListeners = useCallback(() => {
    if (clickOutsideRef.current) {
      document.removeEventListener('mousedown', clickOutsideRef.current);
      clickOutsideRef.current = null;
    }
    if (keydownRef.current) {
      document.removeEventListener('keydown', keydownRef.current);
      keydownRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
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

  const addGlobalListeners = useCallback(() => {
    clickOutsideRef.current = (e: Event) => {
      const target = e.target as Node;
      if (
        pickerRef.current &&
        !pickerRef.current.contains(target) &&
        target !== anchorRef.current &&
        !anchorRef.current?.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', clickOutsideRef.current);

    keydownRef.current = (e: KeyboardEvent) => {
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

    const handler = (...args: unknown[]) => {
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
        const panel = pickerRef.current?.querySelector('.dm-emoji-picker') as HTMLElement | null;
        if (panel && anchorRef.current) {
          cleanupFloatingRef.current?.();
          cleanupFloatingRef.current = positionFloatingOnce(anchorRef.current, panel, {
            placement: 'bottom',
            offsetValue: 4,
          });
        }
        const input = pickerRef.current?.querySelector('.dm-emoji-picker-search input') as HTMLInputElement | null;
        input?.focus();
      });
    };

    (editor.on as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);

    return () => {
      removeGlobalListeners();
      (editor.off as (e: string, h: (...args: unknown[]) => void) => void)('insertEmoji', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const selectEmoji = useCallback((item: EmojiPickerItem) => {
    if (!editor) return;
    const cmd = editor.commands as Record<string, (...args: unknown[]) => boolean>;
    if (cmd['insertEmoji']) {
      cmd['insertEmoji'](item.name);
    }
    close();
  }, [editor, close]);

  const onSearch = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const scrollToCategory = useCallback((cat: string) => {
    setSearchQuery('');
    setActiveCategory(cat);
    requestAnimationFrame(() => {
      const grid = pickerRef.current?.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
      if (!grid) return;
      const label = grid.querySelector(`[data-category="${cat}"]`) as HTMLElement | null;
      if (label) {
        grid.scrollTo({ top: label.offsetTop - grid.offsetTop, behavior: 'smooth' });
      }
    });
  }, []);

  const onGridScroll = useCallback(() => {
    if (searchQuery) return;
    const grid = pickerRef.current?.querySelector('.dm-emoji-picker-grid') as HTMLElement | null;
    if (!grid) return;

    const labels = Array.from(grid.querySelectorAll('.dm-emoji-picker-category-label[data-category]')) as HTMLElement[];
    let currentCat = '';
    for (const label of labels) {
      if (label.offsetTop - grid.offsetTop <= grid.scrollTop + 20) {
        currentCat = label.getAttribute('data-category') ?? '';
      }
    }
    if (currentCat && currentCat !== activeCategory) {
      setActiveCategory(currentCat);
    }
  }, [searchQuery, activeCategory]);

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
