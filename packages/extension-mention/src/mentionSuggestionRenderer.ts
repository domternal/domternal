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
import { positionFloatingOnce, localizeMessage } from '@domternal/core';
import { mentionMessages } from './messages.js';

const MAX_ITEMS = 8;

// Below this the dropdown flips above the caret instead of shrinking further:
// about five rows plus the dropdown chrome.
const MIN_MENU_HEIGHT = 160;

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
    let renderedRows: string | null = null;
    let renderedLocaleRevision: number | undefined;
    let buttons: HTMLButtonElement[] = [];

    let rendering = false;
    function render(): void {
      if (rendering) return;
      rendering = true;
      try {
        let revision: number | undefined;
        do {
          revision = currentProps?.i18n?.getSnapshot().revision;
          renderItems();
        } while (revision !== currentProps?.i18n?.getSnapshot().revision);
      } finally {
        rendering = false;
      }
    }

    function renderItems(): void {
      if (!container || !currentProps) return;

      const { items, i18n } = currentProps;
      const visible = items.slice(0, MAX_ITEMS);
      const menuLabel = localizeMessage(i18n, mentionMessages.suggestions);
      container.setAttribute('aria-label', menuLabel.text);
      container.lang = menuLabel.language;
      renderedLocaleRevision = currentProps.localeRevision ?? i18n?.getSnapshot().revision;
      const rows = JSON.stringify(visible.map(item => [item.id, item.label, item.labelLanguage]));

      if (rows !== renderedRows) {
        renderedRows = rows;
        container.replaceChildren();
        buttons = [];
        if (visible.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'dm-mention-suggestion-empty';
          empty.setAttribute('role', 'status');
          empty.setAttribute('aria-live', 'polite');
          container.appendChild(empty);
        }
        visible.forEach((item: MentionItem, i: number) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dm-mention-suggestion-item';
          btn.setAttribute('role', 'option');
          // Names belong to the data source, so they do not inherit UI language.
          btn.lang = item.labelLanguage ?? '';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'dm-mention-suggestion-label';
          labelSpan.textContent = item.label;
          btn.appendChild(labelSpan);
          btn.addEventListener('mousedown', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
          });
          btn.addEventListener('click', () => {
            const current = currentProps?.items.slice(0, MAX_ITEMS).find(candidate => candidate.id === item.id);
            if (current) currentProps?.command(current);
          });
          // Real pointer motion selects a row without rebuilding its DOM.
          btn.addEventListener('mousemove', () => {
            if (selectedIndex === i) return;
            selectedIndex = i;
            render();
          });
          buttons.push(btn);
          container?.appendChild(btn);
        });
      }
      const empty = container.querySelector<HTMLElement>('.dm-mention-suggestion-empty');
      if (empty) {
        const copy = localizeMessage(i18n, mentionMessages.empty);
        empty.textContent = copy.text;
        empty.lang = copy.language;
      }
      buttons.forEach((button, index) => {
        button.classList.toggle('dm-mention-suggestion-item--selected', index === selectedIndex);
        button.setAttribute('aria-selected', String(index === selectedIndex));
      });

      // Keep the keyboard selection visible in the scrollable list. Manual
      // scrollTop math instead of `scrollIntoView`: that walks ancestors and
      // would yank the page while the dropdown still sits at its natural flow
      // position, before positioning runs.
      const selected = container.querySelector<HTMLButtonElement>(
        '.dm-mention-suggestion-item--selected',
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
      onStart(props: MentionSuggestionProps): void {
        currentProps = props;
        selectedIndex = 0;
        renderedRows = null;

        container = document.createElement('div');
        container.className = 'dm-mention-suggestion';
        container.setAttribute('role', 'listbox');
        container.setAttribute('data-dm-editor-ui', '');

        const editorEl = props.element.closest('.dm-editor');
        const appendTarget = editorEl ?? document.body;
        appendTarget.appendChild(container);

        render();
        updatePosition();
      },

      onUpdate(props: MentionSuggestionProps): void {
        const revision = props.localeRevision ?? props.i18n?.getSnapshot().revision;
        const localeOnly = revision !== renderedLocaleRevision && props.query === currentProps?.query;
        currentProps = props;
        if (!localeOnly) selectedIndex = 0;
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
        buttons = [];
        renderedRows = null;
        renderedLocaleRevision = undefined;
      },

      onKeyDown(event: KeyboardEvent): boolean {
        if (!currentProps || event.isComposing) return false;

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
