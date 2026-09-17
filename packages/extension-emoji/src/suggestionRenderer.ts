/**
 * Default emoji suggestion renderer - vanilla DOM dropdown.
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
import { positionFloatingOnce, localizeMessage, resolveEmojiLabel } from '@domternal/core';

import { emojiMessages } from './messages.js';

const MAX_ITEMS = 10;

// Below this the dropdown flips above the caret instead of shrinking further:
// about five rows plus the dropdown chrome.
const MIN_MENU_HEIGHT = 160;

/**
 * Creates a render factory for the emoji suggestion plugin.
 * Returns a function that produces a `SuggestionRenderer` instance.
 */
export function createEmojiSuggestionRenderer(): () => SuggestionRenderer {
  return () => {
    let container: HTMLDivElement | null = null;
    let currentProps: SuggestionProps | null = null;
    let selectedIndex = 0;
    let unsubscribeI18n: (() => void) | undefined;
    let boundI18n: SuggestionProps['i18n'];
    let cleanupFloating: (() => void) | null = null;

    let updatingLabels = false;
    function updateLabels(): void {
      if (updatingLabels) return;
      updatingLabels = true;
      try {
        let revision: number | undefined;
        do {
          revision = currentProps?.i18n?.getSnapshot().revision;
          paintLabels();
        } while (revision !== currentProps?.i18n?.getSnapshot().revision);
      } finally {
        updatingLabels = false;
      }
    }

    function paintLabels(): void {
      if (!container || !currentProps) return;
      const label = localizeMessage(currentProps.i18n, emojiMessages.suggestionLabel);
      container.setAttribute('aria-label', label.text); container.lang = label.language;
      const empty = container.querySelector<HTMLElement>('.dm-emoji-suggestion-empty');
      if (empty) {
        const emptyLabel = localizeMessage(currentProps.i18n, emojiMessages.suggestionEmpty);
        empty.textContent = emptyLabel.text; empty.lang = emptyLabel.language;
      }
      const names = container.querySelectorAll<HTMLElement>('.dm-emoji-suggestion-name');
      names.forEach((element, index) => {
        const item = currentProps?.items[index];
        if (!item) return;
        const itemLabel = resolveEmojiLabel(currentProps?.i18n, item);
        const text = element.firstChild;
        if (text?.nodeType === 3 && text === element.lastChild) {
          if (text.nodeValue !== itemLabel.text) text.nodeValue = itemLabel.text;
        } else {
          element.textContent = itemLabel.text;
        }
        element.lang = itemLabel.language ?? '';
      });
    }

    function bindI18n(): void {
      if (boundI18n === currentProps?.i18n) return;
      unsubscribeI18n?.();
      boundI18n = currentProps?.i18n;
      unsubscribeI18n = boundI18n?.subscribe(updateLabels);
    }

    function render(): void {
      if (!container || !currentProps) return;

      const { items, command } = currentProps;
      const visible = items.slice(0, MAX_ITEMS);

      container.innerHTML = '';

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-emoji-suggestion-empty';
        container.appendChild(empty);
        updateLabels();
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

        btn.appendChild(emojiSpan);
        btn.appendChild(nameSpan);

        btn.addEventListener('mousedown', (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener('click', () => {
          command(item);
        });
        // mousemove, not mouseenter: re-rendering the list under a resting
        // pointer fires a synthetic mouseenter that would steal the selection
        // back from keyboard navigation. Real hovering always produces
        // mousemove, so hover-to-select still works.
        btn.addEventListener('mousemove', () => {
          if (selectedIndex === i) return;
          const prev = container?.querySelector('.dm-emoji-suggestion-item--selected');
          if (prev) {
            prev.classList.remove('dm-emoji-suggestion-item--selected');
            prev.setAttribute('aria-selected', 'false');
          }
          selectedIndex = i;
          btn.classList.add('dm-emoji-suggestion-item--selected');
          btn.setAttribute('aria-selected', 'true');
        });

        container?.appendChild(btn);
      });

      // Keep the keyboard selection visible in the scrollable list. Manual
      // scrollTop math instead of `scrollIntoView`: that walks ancestors and
      // would yank the page while the dropdown still sits at its natural flow
      // position, before positioning runs.
      updateLabels();
      const selected = container.querySelector<HTMLButtonElement>(
        '.dm-emoji-suggestion-item--selected',
      );
      if (selected) {
        const btnTop = selected.offsetTop;
        const btnBottom = btnTop + selected.offsetHeight;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        if (btnTop < viewTop) container.scrollTop = btnTop;
        else if (btnBottom > viewBottom) container.scrollTop = btnBottom - container.clientHeight;
      }
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
        constrainHeight: { minHeight: MIN_MENU_HEIGHT },
      });
    }

    return {
      onStart(props: SuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;

        container = document.createElement('div');
        container.className = 'dm-emoji-suggestion';
        container.setAttribute('role', 'listbox');
        bindI18n();

        // Append inside .dm-editor (which has position:relative) so the
        // dropdown scrolls with the editor content via CSS - zero jitter
        // for both page scroll and internal editor scroll scenarios.
        const editorEl = props.element.closest('.dm-editor');
        const appendTarget = editorEl ?? document.body;
        appendTarget.appendChild(container);

        render();
        updatePosition();
      },

      onUpdate(props: SuggestionProps): void {
        currentProps = props;
        bindI18n();
        if (props.updateReason === 'locale') {
          updateLabels();
          return;
        }
        selectedIndex = 0;
        render();
        updatePosition();
      },

      onExit(): void {
        unsubscribeI18n?.();
        unsubscribeI18n = undefined;
        boundI18n = undefined;
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
