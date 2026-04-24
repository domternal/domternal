/**
 * Default DOM renderer factory for SlashCommand.
 *
 * Returns `{ onStart, onUpdate, onExit, onKeyDown }` callbacks that build
 * and manage a grouped popup anchored at the cursor. Mirrors the
 * Mention/Emoji suggestion renderer pattern so consumers already familiar
 * with those APIs have zero learning curve.
 *
 * The popup DOM reuses the same visual vocabulary as FloatingMenu:
 * `role="menu"` container, `role="group"` sections, `role="menuitem"`
 * buttons with `icon + label + shortcut chip` layout. A dedicated
 * `dm-slash-command-menu` root class scopes SCSS overrides.
 */
import {
  defaultIcons,
  groupFloatingMenuItems,
  positionFloatingOnce,
} from '@domternal/core';
import type { FloatingMenuItem } from '@domternal/core';
import type { SlashCommandProps, SlashCommandRenderer } from './SlashCommand.js';

export function createSlashSuggestionRenderer(): SlashCommandRenderer {
  let root: HTMLDivElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  // Flat list of rendered menuitem buttons, parallel to filtered item list.
  let itemButtons: HTMLButtonElement[] = [];
  let flatItems: FloatingMenuItem[] = [];
  let selectedIndex = 0;
  let currentCommand: SlashCommandProps['command'] | null = null;

  const renderPopup = (props: SlashCommandProps): void => {
    if (!root) return;
    root.innerHTML = '';
    itemButtons = [];
    flatItems = [];

    if (props.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dm-slash-command-empty';
      empty.textContent = 'No matches';
      root.appendChild(empty);
      return;
    }

    const groups = groupFloatingMenuItems(props.items);
    for (const group of groups) {
      if (group.name) {
        const label = document.createElement('div');
        label.className = 'dm-slash-command-group-label';
        label.textContent = group.name;
        root.appendChild(label);
      }
      const groupEl = document.createElement('div');
      groupEl.className = 'dm-slash-command-group';
      groupEl.setAttribute('role', 'group');
      if (group.name) groupEl.setAttribute('aria-label', group.name);

      for (const item of group.items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dm-slash-command-item';
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('aria-label', item.label);
        btn.tabIndex = -1;

        // Build DOM safely: only the icon SVG (from our trusted phosphor
        // set) is interpolated as HTML. label / description / shortcut use
        // textContent since FloatingMenuItem fields may come from arbitrary
        // extension authors and could carry unescaped HTML/scripts.
        const iconHTML = item.icon ? (defaultIcons[item.icon] ?? '') : '';
        if (iconHTML) {
          const iconSpan = document.createElement('span');
          iconSpan.className = 'dm-slash-command-item-icon';
          iconSpan.setAttribute('aria-hidden', 'true');
          iconSpan.innerHTML = iconHTML;
          btn.appendChild(iconSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'dm-slash-command-item-text';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'dm-slash-command-item-label';
        labelSpan.textContent = item.label;
        textSpan.appendChild(labelSpan);

        if (item.description) {
          const descSpan = document.createElement('span');
          descSpan.className = 'dm-slash-command-item-description';
          descSpan.textContent = item.description;
          textSpan.appendChild(descSpan);
        }

        btn.appendChild(textSpan);

        if (item.shortcut) {
          const shortcutSpan = document.createElement('span');
          shortcutSpan.className = 'dm-slash-command-item-shortcut';
          shortcutSpan.setAttribute('aria-hidden', 'true');
          shortcutSpan.textContent = item.shortcut;
          btn.appendChild(shortcutSpan);
        }

        const indexForItem = flatItems.length;
        btn.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); });
        btn.addEventListener('mouseenter', () => { selectItem(indexForItem); });
        btn.addEventListener('click', (e: MouseEvent) => {
          e.preventDefault();
          currentCommand?.(item);
        });

        itemButtons.push(btn);
        flatItems.push(item);
        groupEl.appendChild(btn);
      }
      root.appendChild(groupEl);
    }

    if (selectedIndex >= flatItems.length) selectedIndex = 0;
    highlight(selectedIndex);
  };

  const highlight = (index: number): void => {
    for (const [i, btn] of itemButtons.entries()) {
      if (i === index) {
        btn.setAttribute('data-selected', '');
        btn.scrollIntoView({ block: 'nearest' });
      } else {
        btn.removeAttribute('data-selected');
      }
    }
  };

  const selectItem = (index: number): void => {
    if (index < 0 || index >= itemButtons.length) return;
    selectedIndex = index;
    highlight(index);
  };

  const reposition = (props: SlashCommandProps): void => {
    if (!root) return;
    const rect = props.clientRect();
    if (!rect) return;
    cleanupFloating?.();
    cleanupFloating = positionFloatingOnce(
      { getBoundingClientRect: () => rect },
      root,
      { placement: 'bottom-start', offsetValue: 4 },
    );
  };

  return {
    onStart(props): void {
      currentCommand = props.command;
      selectedIndex = 0;

      root = document.createElement('div');
      root.className = 'dm-slash-command-menu';
      root.setAttribute('role', 'menu');
      root.setAttribute('aria-label', 'Insert block');
      root.setAttribute('data-dm-editor-ui', '');

      const editorEl = props.element.closest('.dm-editor');
      (editorEl ?? document.body).appendChild(root);
      root.setAttribute('data-show', '');

      renderPopup(props);
      reposition(props);
    },

    onUpdate(props): void {
      currentCommand = props.command;
      if (!root) return;
      renderPopup(props);
      reposition(props);
    },

    onExit(): void {
      cleanupFloating?.();
      cleanupFloating = null;
      root?.remove();
      root = null;
      itemButtons = [];
      flatItems = [];
      selectedIndex = 0;
      currentCommand = null;
    },

    onKeyDown(event): boolean {
      if (!root || flatItems.length === 0) return false;

      switch (event.key) {
        case 'ArrowDown':
          selectItem((selectedIndex + 1) % flatItems.length);
          return true;
        case 'ArrowUp':
          selectItem((selectedIndex - 1 + flatItems.length) % flatItems.length);
          return true;
        case 'Home':
          selectItem(0);
          return true;
        case 'End':
          selectItem(flatItems.length - 1);
          return true;
        case 'Enter':
        case 'Tab': {
          const item = flatItems[selectedIndex];
          if (item && currentCommand) currentCommand(item);
          return true;
        }
        default:
          return false;
      }
    },
  };
}
