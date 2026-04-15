import { computed, defineComponent, h } from 'vue';
import type { PropType, ShallowRef } from 'vue';
import type { Editor } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useEmojiPicker, type EmojiPickerItem } from './useEmojiPicker.js';

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

function categoryIcon(cat: string): string {
  return CATEGORY_ICONS[cat] ?? cat.charAt(0);
}

function formatName(name: string): string {
  return name.replace(/_/g, ' ');
}

export interface DomternalEmojiPickerProps {
  editor?: Editor;
  emojis: EmojiPickerItem[];
}

export const DomternalEmojiPicker = defineComponent({
  name: 'DomternalEmojiPicker',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
    emojis: { type: Array as PropType<EmojiPickerItem[]>, required: true },
  },
  setup(props) {
    const { editor: contextEditor } = useCurrentEditor();

    const {
      isOpen,
      searchQuery,
      activeCategory,
      categoryNames,
      filteredEmojis,
      frequentlyUsed,
      pickerRef,
      selectEmoji,
      onSearch,
      scrollToCategory,
      onGridScroll,
      close,
      categories,
    } = useEmojiPicker(
      computed(() => props.editor ?? contextEditor.value) as ShallowRef<Editor | null>,
      props.emojis,
    );

    function onGridKeyDown(event: KeyboardEvent) {
      const grid = event.currentTarget as HTMLElement;
      const swatches = Array.from(grid.querySelectorAll('.dm-emoji-swatch')) as HTMLElement[];
      if (!swatches.length) return;
      const current = document.activeElement as HTMLElement;
      let idx = swatches.indexOf(current);
      if (idx === -1) {
        // Focus is on grid container, not a swatch - enter the grid
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          swatches[0]?.focus();
        }
        return;
      }
      const cols = 8;
      let next = idx;
      switch (event.key) {
        case 'ArrowRight': event.preventDefault(); next = Math.min(idx + 1, swatches.length - 1); break;
        case 'ArrowLeft': event.preventDefault(); next = Math.max(idx - 1, 0); break;
        case 'ArrowDown': event.preventDefault(); next = Math.min(idx + cols, swatches.length - 1); break;
        case 'ArrowUp': event.preventDefault(); next = Math.max(idx - cols, 0); break;
        case 'Enter': case ' ': event.preventDefault(); swatches[idx]?.click(); return;
        default: return;
      }
      swatches[next]?.focus();
    }

    function renderEmojiButton(item: EmojiPickerItem) {
      return h('button', {
        key: item.name,
        type: 'button',
        class: 'dm-emoji-swatch',
        tabindex: -1,
        title: formatName(item.name),
        'aria-label': formatName(item.name),
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick: () => selectEmoji(item),
      }, item.emoji);
    }

    return () => {
      if (!isOpen.value) {
        return h('div', { ref: pickerRef, class: 'dm-emoji-picker-host' });
      }

      return h('div', { ref: pickerRef, class: 'dm-emoji-picker-host' }, [
        h('div', { class: 'dm-emoji-picker' }, [
          // Search
          h('div', { class: 'dm-emoji-picker-search' }, [
            h('input', {
              type: 'text',
              placeholder: 'Search emoji...',
              'aria-label': 'Search emoji',
              value: searchQuery.value,
              onInput: onSearch,
              onKeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); },
            }),
          ]),

          // Category tabs
          h('div', { class: 'dm-emoji-picker-tabs', role: 'tablist' },
            categoryNames.value.map((cat) =>
              h('button', {
                key: cat,
                type: 'button',
                class: ['dm-emoji-picker-tab', activeCategory.value === cat && 'dm-emoji-picker-tab--active'],
                role: 'tab',
                'aria-selected': activeCategory.value === cat,
                title: cat,
                'aria-label': cat,
                onMousedown: (e: MouseEvent) => e.preventDefault(),
                onClick: () => scrollToCategory(cat),
              }, categoryIcon(cat)),
            ),
          ),

          // Grid
          h('div', { class: 'dm-emoji-picker-grid', onScroll: onGridScroll, onKeydown: onGridKeyDown },
            searchQuery.value
              ? (filteredEmojis.value.length > 0
                  ? filteredEmojis.value.map(renderEmojiButton)
                  : [h('div', { class: 'dm-emoji-picker-empty' }, 'No emoji found')]
                )
              : [
                  // Frequently used
                  ...(frequentlyUsed.value.length > 0
                    ? [
                        h('div', { class: 'dm-emoji-picker-category-label' }, 'Frequently Used'),
                        ...frequentlyUsed.value.map(renderEmojiButton),
                      ]
                    : []),
                  // All categories
                  ...categoryNames.value.flatMap((cat) => [
                    h('div', {
                      key: `label-${cat}`,
                      class: 'dm-emoji-picker-category-label',
                      'data-category': cat,
                    }, cat),
                    ...(categories.value.get(cat) ?? []).map(renderEmojiButton),
                  ]),
                ],
          ),
        ]),
      ]);
    };
  },
});
