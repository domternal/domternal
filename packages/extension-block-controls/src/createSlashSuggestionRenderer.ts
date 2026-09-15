/**
 * Default DOM renderer factory for SlashCommand. Returns suggestion callbacks
 * that build and manage a grouped popup anchored at the cursor, mirroring the
 * Mention/Emoji renderer pattern.
 *
 * The popup reuses FloatingMenu's accessibility vocabulary: `role="menu"`
 * container, `role="group"` sections, `role="menuitem"` buttons with
 * icon + label + shortcut layout. The `dm-slash-command-menu` root scopes SCSS.
 */
import {
  defaultIcons,
  coreMessages,
  groupFloatingMenuItems,
  positionFloatingOnce,
} from '@domternal/core';
import type { FloatingMenuItem, IconSet } from '@domternal/core';
import { blockControlsMessages } from './messages.js';
import type { SlashCommandProps, SlashCommandRenderer } from './SlashCommand.js';

// Unique id suffixes so `aria-activedescendant` on the menu root can announce
// the selection to screen readers as the user arrow-keys through items.
let idCounter = 0;

// Below this the menu flips above the caret instead of shrinking further:
// three two-line rows plus the menu chrome.
const MIN_MENU_HEIGHT = 160;

export function createSlashSuggestionRenderer(icons?: IconSet): SlashCommandRenderer {
  let root: HTMLDivElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  // Flat list of rendered menuitem buttons, parallel to filtered item list.
  let itemButtons: HTMLButtonElement[] = [];
  let groupElements: HTMLElement[] = [];
  let groupLabels: (HTMLElement | null)[] = [];
  let groupNames: string[] = [];
  let nextItemId = 0;
  let flatItems: FloatingMenuItem[] = [];
  let selectedIndex = 0;
  let currentCommand: SlashCommandProps['command'] | null = null;
  // Set during onExit so a pending queued event (e.g. trailing mousedown+click
  // mid-teardown) can bail instead of dispatching into a destroyed editor.
  let destroyed = false;
  // What the buttons on screen were built from; see `renderPopup`.
  let renderedRows: string | null = null;
  const rendererId = `dm-slash-${String(++idCounter)}`;

  // Stable row structure determines DOM identity. Text and language are patched
  // separately so localization cannot detach a pressed or focused button.
  const rowsOf = (groups: ReturnType<typeof groupFloatingMenuItems>): string =>
    groups
      .map((group) =>
        [
          group.name,
          String(Boolean(group.label ?? group.name)),
          ...group.items.map((item) =>
            [item.name, item.icon ?? ''].join(
              '\u0000',
            ),
          ),
        ].join('\u0001'),
      )
      .join('\u0002');

  const setLanguage = (element: HTMLElement, language?: string): void => {
    if (language) element.lang = language;
    else element.removeAttribute('lang');
  };

  const refreshLabels = (props: SlashCommandProps, groups: ReturnType<typeof groupFloatingMenuItems>): void => {
    if (!root) return;
    const menuLabel = props.editor.i18n.resolve(coreMessages.floatingMenuLabel);
    root.setAttribute('aria-label', menuLabel.text);
    root.lang = menuLabel.language;
    const empty = root.querySelector<HTMLElement>('.dm-slash-command-empty');
    if (empty) {
      const message = props.editor.i18n.resolve(blockControlsMessages.noMatches);
      empty.textContent = message.text;
      empty.lang = message.language;
    }
    groups.forEach((group, index) => {
      const element = groupElements[index];
      const label = groupLabels[index];
      const text = group.label ?? group.name;
      if (element) {
        if (text) element.setAttribute('aria-label', text);
        else element.removeAttribute('aria-label');
        setLanguage(element, group.labelLanguage);
      }
      if (label) {
        label.textContent = text;
        setLanguage(label, group.labelLanguage);
      }
    });
    flatItems.forEach((item, index) => {
      const button = itemButtons[index];
      if (!button) return;
      button.setAttribute('aria-label', item.label);
      setLanguage(button, item.labelLanguage);
      const label = button.querySelector<HTMLElement>('.dm-slash-command-item-label');
      if (label) {
        label.textContent = item.label;
        setLanguage(label, item.labelLanguage);
      }
      const text = button.querySelector('.dm-slash-command-item-text');
      let description = button.querySelector<HTMLElement>('.dm-slash-command-item-description');
      if (item.description && text) {
        if (!description) {
          description = document.createElement('span');
          description.className = 'dm-slash-command-item-description';
          text.appendChild(description);
        }
        description.textContent = item.description;
        setLanguage(description, item.descriptionLanguage);
      } else description?.remove();
      let shortcut = button.querySelector<HTMLElement>('.dm-slash-command-item-shortcut');
      if (item.shortcut) {
        if (!shortcut) {
          shortcut = document.createElement('span');
          shortcut.className = 'dm-slash-command-item-shortcut';
          shortcut.setAttribute('aria-hidden', 'true');
          button.appendChild(shortcut);
        }
        shortcut.textContent = item.shortcut;
      } else shortcut?.remove();
    });
  };

  const createItemButton = (item: FloatingMenuItem): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dm-slash-command-item';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.id = `${rendererId}-item-${String(nextItemId++)}`;

    // Only trusted icon SVG is HTML. Translated copy is patched as text.
    const iconHTML = item.icon ? (icons?.[item.icon] ?? defaultIcons[item.icon] ?? '') : '';
    if (iconHTML) {
      const icon = document.createElement('span');
      icon.className = 'dm-slash-command-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = iconHTML;
      button.appendChild(icon);
    }
    const text = document.createElement('span');
    text.className = 'dm-slash-command-item-text';
    const label = document.createElement('span');
    label.className = 'dm-slash-command-item-label';
    text.appendChild(label);
    button.appendChild(text);

    button.addEventListener('mousedown', (event: MouseEvent) => { event.preventDefault(); });
    button.addEventListener('mouseenter', () => { selectItem(flatItems.findIndex(candidate => candidate.name === item.name)); });
    button.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault();
      if (destroyed) return;
      // Identity survives locale filtering and ranking. A removed button must
      // never execute whichever action has taken its former array position.
      const current = flatItems.find(candidate => candidate.name === item.name);
      if (current) currentCommand?.(current);
    });
    return button;
  };

  const reconcileChildren = (parent: HTMLElement, children: HTMLElement[]): void => {
    const wanted = new Set(children);
    for (const child of Array.from(parent.children)) {
      if (!wanted.has(child as HTMLElement)) child.remove();
    }
    children.forEach((child, index) => {
      const current = parent.children[index];
      if (current !== child) parent.insertBefore(child, current ?? null);
    });
  };

  const renderPopup = (props: SlashCommandProps): void => {
    if (!root) return;
    const groups = groupFloatingMenuItems(props.items);
    const rows = rowsOf(groups);
    if (rows === renderedRows) {
      flatItems = groups.flatMap((group) => group.items);
      refreshLabels(props, groups);
      return;
    }
    renderedRows = rows;

    const selectedName = flatItems[selectedIndex]?.name;
    const focused = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const previousButtons = new Map(flatItems.map((item, index) => [item.name, { item, button: itemButtons[index] }]));
    const previousGroups = new Map(groupNames.map((name, index) => [name, { element: groupElements[index], label: groupLabels[index] }]));
    itemButtons = [];
    groupElements = [];
    groupLabels = [];
    groupNames = [];
    flatItems = [];
    const children: HTMLElement[] = [];

    if (props.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dm-slash-command-empty';
      empty.setAttribute('role', 'status');
      empty.setAttribute('aria-live', 'polite');
      reconcileChildren(root, [empty]);
      refreshLabels(props, groups);
      highlight(selectedIndex);
      return;
    }

    for (const group of groups) {
      const previous = previousGroups.get(group.name);
      let groupLabel: HTMLElement | null = null;
      if (group.label ?? group.name) {
        groupLabel = previous?.label ?? document.createElement('div');
        groupLabel.className = 'dm-slash-command-group-label';
        children.push(groupLabel);
      }
      const groupElement = previous?.element ?? document.createElement('div');
      groupElement.className = 'dm-slash-command-group';
      groupElement.setAttribute('role', 'group');
      groupNames.push(group.name);
      groupElements.push(groupElement);
      groupLabels.push(groupLabel);
      const buttons: HTMLButtonElement[] = [];
      for (const item of group.items) {
        const previousButton = previousButtons.get(item.name);
        const button = previousButton?.button && previousButton.item.icon === item.icon
          ? previousButton.button
          : createItemButton(item);
        buttons.push(button);
        itemButtons.push(button);
        flatItems.push(item);
      }
      reconcileChildren(groupElement, buttons);
      children.push(groupElement);
    }
    reconcileChildren(root, children);

    const retainedIndex = flatItems.findIndex(item => item.name === selectedName);
    selectedIndex = retainedIndex >= 0 ? retainedIndex : Math.min(selectedIndex, Math.max(0, flatItems.length - 1));
    refreshLabels(props, groups);
    highlight(selectedIndex);
    // Moving an existing focused button can blur it on older DOM engines.
    if (focused && root.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };

  const highlight = (index: number): void => {
    for (const [i, btn] of itemButtons.entries()) {
      if (i === index) {
        btn.setAttribute('data-selected', '');
      } else {
        btn.removeAttribute('data-selected');
      }
    }
    const selected = itemButtons[index];
    // Scroll within the popup only, never via `scrollIntoView`: that walks
    // ancestors and would yank the page during `renderPopup`, which runs before
    // `positionFloatingOnce` while the popup is still at its natural flow
    // position at the bottom of `.dm-editor`.
    if (root && selected) {
      const btnTop = selected.offsetTop;
      const btnBottom = btnTop + selected.offsetHeight;
      const viewTop = root.scrollTop;
      const viewBottom = viewTop + root.clientHeight;
      if (btnTop < viewTop) root.scrollTop = btnTop;
      else if (btnBottom > viewBottom) root.scrollTop = btnBottom - root.clientHeight;
      root.setAttribute('aria-activedescendant', selected.id);
    } else {
      root?.removeAttribute('aria-activedescendant');
    }
  };

  const selectItem = (index: number): void => {
    if (index < 0 || index >= itemButtons.length) return;
    selectedIndex = index;
    highlight(index);
  };

  const reposition = (props: SlashCommandProps): void => {
    if (!root) return;
    cleanupFloating?.();
    // Callable virtualRef so floating-ui's autoUpdate reads fresh cursor coords
    // every tick. Capturing a single rect would freeze the anchor and drift on
    // scroll. Mirrors the emoji suggestion renderer.
    const virtualRef = {
      getBoundingClientRect: (): DOMRect => props.clientRect() ?? new DOMRect(),
    };
    cleanupFloating = positionFloatingOnce(
      virtualRef,
      root,
      {
        placement: 'bottom-start',
        offsetValue: 4,
        constrainHeight: { minHeight: MIN_MENU_HEIGHT },
      },
    );
  };

  return {
    onStart(props): void {
      currentCommand = props.command;
      selectedIndex = 0;
      destroyed = false;
      renderedRows = null; // A fresh root holds no buttons.

      root = document.createElement('div');
      root.className = 'dm-slash-command-menu';
      root.setAttribute('role', 'menu');
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
      destroyed = true;
      cleanupFloating?.();
      cleanupFloating = null;
      root?.remove();
      root = null;
      itemButtons = [];
      groupElements = [];
      groupLabels = [];
      groupNames = [];
      flatItems = [];
      selectedIndex = 0;
      currentCommand = null;
      renderedRows = null;
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
