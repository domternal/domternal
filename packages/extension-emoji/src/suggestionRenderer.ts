/**
 * Default emoji suggestion renderer — vanilla DOM dropdown.
 *
 * Framework-agnostic: creates a positioned dropdown near the cursor
 * that displays matching emoji items with keyboard navigation.
 *
 * @example
 * ```ts
 * import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
 *
 * const editor = new Editor({
 *   extensions: [
 *     Emoji.configure({
 *       emojis,
 *       suggestion: {
 *         render: createEmojiSuggestionRenderer(),
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
import type { SuggestionProps, SuggestionRenderer } from './suggestionPlugin.js';
import type { EmojiItem } from './emojis.js';

const MAX_ITEMS = 10;

/**
 * Creates a render factory for the emoji suggestion plugin.
 * Returns a function that produces a `SuggestionRenderer` instance.
 */
export function createEmojiSuggestionRenderer(): () => SuggestionRenderer {
  return () => {
    let container: HTMLDivElement | null = null;
    let currentProps: SuggestionProps | null = null;
    let selectedIndex = 0;

    function render(): void {
      if (!container || !currentProps) return;

      const { items, command } = currentProps;
      const visible = items.slice(0, MAX_ITEMS);

      container.innerHTML = '';

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-emoji-suggestion-empty';
        empty.textContent = 'No emoji found';
        container.appendChild(empty);
        return;
      }

      visible.forEach((item: EmojiItem, i: number) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'dm-emoji-suggestion-item' +
          (i === selectedIndex ? ' dm-emoji-suggestion-item--selected' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(i === selectedIndex));

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'dm-emoji-suggestion-emoji';
        emojiSpan.textContent = item.emoji;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'dm-emoji-suggestion-name';
        nameSpan.textContent = item.name.replace(/_/g, ' ');

        btn.appendChild(emojiSpan);
        btn.appendChild(nameSpan);

        btn.addEventListener('mousedown', (e: Event) => {
          e.preventDefault();
        });
        btn.addEventListener('click', () => {
          command(item);
        });
        btn.addEventListener('mouseenter', () => {
          selectedIndex = i;
          render();
        });

        container!.appendChild(btn);
      });
    }

    function updatePosition(): void {
      if (!container || !currentProps?.clientRect) return;
      const rect = currentProps.clientRect();
      if (!rect) return;

      const gap = 4;
      let top = rect.bottom + gap;

      // Flip above cursor if dropdown overflows viewport bottom
      const menuHeight = container.getBoundingClientRect().height;
      if (top + menuHeight > window.innerHeight - 10) {
        top = rect.top - menuHeight - gap;
      }

      container.style.top = `${String(top)}px`;
      container.style.left = `${String(rect.left)}px`;
    }

    return {
      onStart(props: SuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;

        container = document.createElement('div');
        container.className = 'dm-emoji-suggestion';
        container.setAttribute('role', 'listbox');

        // Append inside the editor DOM tree so CSS variables are inherited.
        // Walk up from ProseMirror's editor element to find .dm-editor.
        const editorEl = props.element.closest('.dm-editor');
        (editorEl ?? document.body).appendChild(container);

        render();
        updatePosition();
      },

      onUpdate(props: SuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;
        render();
        updatePosition();
      },

      onExit(): void {
        container?.remove();
        container = null;
        currentProps = null;
        selectedIndex = 0;
      },

      onKeyDown(event: KeyboardEvent): boolean {
        if (!currentProps) return false;

        const maxIndex = Math.min(currentProps.items.length, MAX_ITEMS) - 1;

        if (event.key === 'ArrowDown') {
          selectedIndex = Math.min(selectedIndex + 1, maxIndex);
          render();
          return true;
        }

        if (event.key === 'ArrowUp') {
          selectedIndex = Math.max(selectedIndex - 1, 0);
          render();
          return true;
        }

        if (event.key === 'Enter') {
          const item = currentProps.items[selectedIndex];
          if (item) currentProps.command(item);
          return true;
        }

        return false;
      },
    };
  };
}
