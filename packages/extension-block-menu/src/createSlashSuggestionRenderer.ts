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
import { defaultIcons, positionFloatingOnce } from '@domternal/core';
import type { FloatingMenuItem } from '@domternal/core';
import type { SlashCommandProps, SlashCommandRenderer } from './SlashCommand.js';

interface SlashGroup {
  name: string;
  items: FloatingMenuItem[];
}

function groupItems(items: FloatingMenuItem[]): SlashGroup[] {
  const map = new Map<string, FloatingMenuItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const name = item.group ?? '';
    let list = map.get(name);
    if (!list) {
      list = [];
      map.set(name, list);
      order.push(name);
    }
    list.push(item);
  }
  return order.map((name) => ({
    name,
    items: (map.get(name) ?? []).slice().sort(
      (a, b) => (b.priority ?? 100) - (a.priority ?? 100),
    ),
  }));
}

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

    const groups = groupItems(props.items);
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

        const iconHTML = item.icon ? (defaultIcons[item.icon] ?? '') : '';
        const description = item.description
          ? `<span class="dm-slash-command-item-description">${item.description}</span>`
          : '';
        const shortcut = item.shortcut
          ? `<span class="dm-slash-command-item-shortcut" aria-hidden="true">${item.shortcut}</span>`
          : '';

        btn.innerHTML = `
          ${iconHTML ? `<span class="dm-slash-command-item-icon" aria-hidden="true">${iconHTML}</span>` : ''}
          <span class="dm-slash-command-item-text">
            <span class="dm-slash-command-item-label">${item.label}</span>
            ${description}
          </span>
          ${shortcut}
        `.trim();

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
