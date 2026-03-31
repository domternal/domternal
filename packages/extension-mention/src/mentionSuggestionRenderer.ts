/**
 * Default mention suggestion renderer - vanilla DOM dropdown.
 *
 * Framework-agnostic: creates a positioned dropdown near the cursor
 * that displays matching mention items with keyboard navigation.
 *
 * @example
 * ```ts
 * import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';
 *
 * const editor = new Editor({
 *   extensions: [
 *     Mention.configure({
 *       suggestion: {
 *         char: '@',
 *         name: 'user',
 *         items: ({ query }) => users.filter(u => u.label.includes(query)),
 *         render: createMentionSuggestionRenderer(),
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
import type { MentionSuggestionProps, MentionSuggestionRenderer, MentionItem } from './mentionSuggestionPlugin.js';
import { positionFloatingOnce } from '@domternal/core';

const MAX_ITEMS = 8;

/**
 * Creates a render factory for the mention suggestion plugin.
 * Returns a function that produces a `MentionSuggestionRenderer` instance.
 */
export function createMentionSuggestionRenderer(): () => MentionSuggestionRenderer {
  return () => {
    let container: HTMLDivElement | null = null;
    let currentProps: MentionSuggestionProps | null = null;
    let selectedIndex = 0;
    let cleanupFloating: (() => void) | null = null;

    function render(): void {
      if (!container || !currentProps) return;

      const { items, command } = currentProps;
      const visible = items.slice(0, MAX_ITEMS);

      container.innerHTML = '';

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-mention-suggestion-empty';
        empty.textContent = 'No results';
        container.appendChild(empty);
        return;
      }

      visible.forEach((item: MentionItem, i: number) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'dm-mention-suggestion-item' +
          (i === selectedIndex ? ' dm-mention-suggestion-item--selected' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(i === selectedIndex));

        const labelSpan = document.createElement('span');
        labelSpan.className = 'dm-mention-suggestion-label';
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        btn.addEventListener('mousedown', (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener('click', () => {
          command(item);
        });
        btn.addEventListener('mouseenter', () => {
          if (selectedIndex === i) return;
          const prev = container?.querySelector('.dm-mention-suggestion-item--selected');
          if (prev) {
            prev.classList.remove('dm-mention-suggestion-item--selected');
            prev.setAttribute('aria-selected', 'false');
          }
          selectedIndex = i;
          btn.classList.add('dm-mention-suggestion-item--selected');
          btn.setAttribute('aria-selected', 'true');
        });

        container?.appendChild(btn);
      });
    }

    function updatePosition(): void {
      if (!container || !currentProps?.clientRect) return;

      cleanupFloating?.();

      const virtualEl = {
        getBoundingClientRect: () => {
          const rect = currentProps?.clientRect?.();
          return rect ?? new DOMRect(0, 0, 0, 0);
        },
      };

      cleanupFloating = positionFloatingOnce(virtualEl, container, {
        placement: 'bottom-start',
        offsetValue: 4,
      });
    }

    return {
      onStart(props: MentionSuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;

        container = document.createElement('div');
        container.className = 'dm-mention-suggestion';
        container.setAttribute('role', 'listbox');

        const editorEl = props.element.closest('.dm-editor');
        const appendTarget = editorEl ?? document.body;
        appendTarget.appendChild(container);

        render();
        updatePosition();
      },

      onUpdate(props: MentionSuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;
        render();
        updatePosition();
      },

      onExit(): void {
        cleanupFloating?.();
        cleanupFloating = null;
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
