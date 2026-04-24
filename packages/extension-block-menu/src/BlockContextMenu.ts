/**
 * BlockContextMenu Extension
 *
 * Popup menu that opens when the user clicks the BlockHandle `⋮⋮` drag
 * handle without dragging. Offers block-level operations for the target:
 *
 * - **Delete**    — remove the block
 * - **Duplicate** — insert an identical copy below
 * - **Turn into** — change the block type (paragraph, heading, quote, etc.)
 *
 * Triggered by the `dm:block-context-menu-open` custom event dispatched
 * from BlockHandle; payload carries `{ blockPos, anchorElement }`.
 *
 * Implementation mirrors FloatingMenu / SlashCommand styling conventions
 * so theming is consistent: `role="menu"` container, `role="menuitem"`
 * buttons, `data-show` for visibility, positioned via `positionFloatingOnce`.
 */
import { Extension, defaultIcons, positionFloatingOnce } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { Attrs } from '@domternal/pm/model';
import {
  deleteBlock,
  duplicateBlock,
  turnIntoBlock,
} from './helpers/blockOperations.js';
import { findTopLevelBlock } from './helpers/findTopLevelBlock.js';

export const blockContextMenuPluginKey = new PluginKey('blockContextMenu');

/**
 * A target type the user can convert the current block into via the
 * "Turn into" submenu.
 */
export interface TurnIntoTarget {
  /** Display label, e.g. "Heading 1". */
  label: string;
  /** Icon key resolved against `defaultIcons`. */
  icon: string;
  /** Schema node name, e.g. "heading", "paragraph", "blockquote". */
  nodeType: string;
  /** Optional node attributes (e.g. `{ level: 1 }` for Heading 1). */
  attrs?: Attrs;
}

const DEFAULT_TURN_INTO: TurnIntoTarget[] = [
  { label: 'Paragraph', icon: 'textT', nodeType: 'paragraph' },
  { label: 'Heading 1', icon: 'textHOne', nodeType: 'heading', attrs: { level: 1 } },
  { label: 'Heading 2', icon: 'textHTwo', nodeType: 'heading', attrs: { level: 2 } },
  { label: 'Heading 3', icon: 'textHThree', nodeType: 'heading', attrs: { level: 3 } },
  { label: 'Quote', icon: 'quotes', nodeType: 'blockquote' },
  { label: 'Code block', icon: 'codeBlock', nodeType: 'codeBlock' },
  { label: 'Bullet list', icon: 'listBullets', nodeType: 'bulletList' },
  { label: 'Ordered list', icon: 'listNumbers', nodeType: 'orderedList' },
  { label: 'To-do list', icon: 'listChecks', nodeType: 'taskList' },
];

export interface BlockContextMenuOptions {
  /**
   * Show the "Turn into" section of the menu. Disable to limit operations
   * to Delete + Duplicate.
   * @default true
   */
  turnIntoEnabled?: boolean;
  /**
   * Block types offered by "Turn into". Override to curate the list or
   * add project-specific block types.
   * @default DEFAULT_TURN_INTO
   */
  turnIntoTargets?: TurnIntoTarget[];
}

export interface CreateBlockContextMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  turnIntoEnabled: boolean;
  turnIntoTargets: TurnIntoTarget[];
}

/**
 * Shape of the custom event dispatched by BlockHandle when the user
 * clicks the drag handle without starting a drag.
 */
interface BlockContextMenuOpenDetail {
  blockPos: number;
  anchorElement: HTMLElement;
}

/**
 * Creates the BlockContextMenu ProseMirror plugin. Builds an absolutely
 * positioned popup DOM, listens for `dm:block-context-menu-open` on the
 * `.dm-editor` container, and executes block operations via the shared
 * helpers in `helpers/blockOperations.ts`.
 */
export function createBlockContextMenuPlugin(
  options: CreateBlockContextMenuPluginOptions,
): Plugin {
  const { pluginKey, editor, turnIntoEnabled, turnIntoTargets } = options;

  // --- Build popup DOM once.
  const root = document.createElement('div');
  root.className = 'dm-block-context-menu';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Block options');
  root.setAttribute('data-dm-editor-ui', '');

  let editorEl: HTMLElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  let currentBlockPos: number | null = null;
  // Roving tabindex: which menuitem is currently focused (-1 = none).
  let focusedIndex = 0;
  let menuItemButtons: HTMLButtonElement[] = [];
  // Tracks the rAF id scheduled by `open()` for the initial focus so we
  // can cancel it if the menu closes before the frame fires (otherwise the
  // callback races with teardown and may focus a stale button).
  let initialFocusRaf: number | null = null;

  const isOpen = (): boolean => root.hasAttribute('data-show');

  const hide = (): void => {
    if (initialFocusRaf !== null) {
      cancelAnimationFrame(initialFocusRaf);
      initialFocusRaf = null;
    }
    cleanupFloating?.();
    cleanupFloating = null;
    root.removeAttribute('data-show');
    currentBlockPos = null;
    menuItemButtons = [];
    focusedIndex = 0;
  };

  const focusItem = (index: number): void => {
    if (menuItemButtons.length === 0) return;
    const clamped = Math.max(0, Math.min(index, menuItemButtons.length - 1));
    focusedIndex = clamped;
    menuItemButtons[clamped]?.focus();
  };

  /**
   * Executes a block operation, then closes the menu and returns focus to
   * the editor so the user can continue typing.
   */
  const runAndClose = (apply: (tr: Transaction) => void): void => {
    const tr = editor.view.state.tr;
    try {
      apply(tr);
      editor.view.dispatch(tr.scrollIntoView());
    } finally {
      hide();
      editor.view.focus();
    }
  };

  const runDelete = (): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    runAndClose((tr) => { deleteBlock(tr, pos); });
  };

  const runDuplicate = (): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    runAndClose((tr) => { duplicateBlock(tr, pos); });
  };

  const runTurnInto = (target: TurnIntoTarget): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    const targetType = editor.view.state.schema.nodes[target.nodeType];
    if (!targetType) return;
    runAndClose((tr) => { turnIntoBlock(tr, pos, targetType, target.attrs); });
  };

  /**
   * Re-renders menu items based on the current target block. Hides "Turn
   * into" targets that match the current block's type (no-op conversions)
   * and filters "Turn into" entirely when the target type is not a textblock.
   */
  const renderItems = (blockPos: number): void => {
    root.innerHTML = '';
    menuItemButtons = [];

    const node = editor.view.state.doc.nodeAt(blockPos);
    if (!node) return;

    // --- Primary actions section
    const primaryGroup = document.createElement('div');
    primaryGroup.className = 'dm-block-context-menu-group';
    primaryGroup.setAttribute('role', 'group');

    primaryGroup.appendChild(
      makeItem('Delete', 'trash', runDelete),
    );
    if (node.type.name !== 'horizontalRule') {
      primaryGroup.appendChild(
        makeItem('Duplicate', 'copy', runDuplicate),
      );
    }
    root.appendChild(primaryGroup);

    // --- Turn into section (textblocks only, different from current type)
    if (turnIntoEnabled && node.type.isTextblock) {
      const eligible = turnIntoTargets.filter((target) => {
        const type = editor.view.state.schema.nodes[target.nodeType];
        if (!type?.isTextblock) return false;
        // Skip targets identical to the current block (same node type AND
        // matching attrs — e.g. hide "Heading 1" when already on H1).
        if (type.name !== node.type.name) return true;
        const targetAttrs = target.attrs;
        if (!targetAttrs) return false;
        const nodeAttrs = node.attrs as Record<string, unknown>;
        for (const k of Object.keys(targetAttrs)) {
          if (nodeAttrs[k] !== (targetAttrs as Record<string, unknown>)[k]) return true;
        }
        return false;
      });

      if (eligible.length > 0) {
        const label = document.createElement('div');
        label.className = 'dm-block-context-menu-group-label';
        label.textContent = 'Turn into';
        root.appendChild(label);

        const group = document.createElement('div');
        group.className = 'dm-block-context-menu-group';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Turn into');

        for (const target of eligible) {
          group.appendChild(
            makeItem(target.label, target.icon, () => { runTurnInto(target); }),
          );
        }
        root.appendChild(group);
      }
    }
  };

  /** Helper to construct a menuitem button and register it for nav. */
  const makeItem = (
    label: string,
    iconKey: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-block-context-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-label', label);
    btn.tabIndex = menuItemButtons.length === 0 ? 0 : -1;

    // Build DOM safely: icon SVG is trusted (from our own phosphor set), but
    // `label` may come from user-supplied `turnIntoTargets` config — use
    // textContent for any string that could originate outside this package.
    const iconHTML = defaultIcons[iconKey] ?? '';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'dm-block-context-menu-item-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.innerHTML = iconHTML;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'dm-block-context-menu-item-label';
    labelSpan.textContent = label;

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);

    btn.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); });
    btn.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      onClick();
    });
    menuItemButtons.push(btn);
    return btn;
  };

  /**
   * Opens the menu anchored to `anchorElement`, targeting `blockPos`.
   * Dispatches `dm:dismiss-overlays` first so any other chrome closes.
   */
  const open = (detail: BlockContextMenuOpenDetail): void => {
    if (!editorEl) return;

    const topLevel = findTopLevelBlock(editor.view.state.doc, detail.blockPos);
    if (!topLevel) return;

    currentBlockPos = topLevel.pos;
    renderItems(topLevel.pos);
    if (menuItemButtons.length === 0) return;

    editorEl.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));
    root.setAttribute('data-show', '');

    cleanupFloating?.();
    cleanupFloating = positionFloatingOnce(detail.anchorElement, root, {
      placement: 'right-start',
      offsetValue: 4,
    });

    // Focus first menu item so keyboard users can Arrow through immediately.
    focusedIndex = 0;
    // Wait for layout so the focus call sees the newly visible element.
    // Track the rAF id so `hide()` can cancel it if the menu closes before
    // the frame fires.
    initialFocusRaf = requestAnimationFrame(() => {
      initialFocusRaf = null;
      menuItemButtons[0]?.focus();
    });
  };

  // --- Event handlers
  const onOpen = (event: Event): void => {
    // CustomEvent<T> types detail as T but at runtime it can be undefined
    // if a plain Event was dispatched. Guard via unknown cast.
    const detail = (event as unknown as { detail?: BlockContextMenuOpenDetail }).detail;
    if (!detail) return;
    open(detail);
  };

  const onDismiss = (): void => {
    if (!isOpen()) return;
    hide();
  };

  const onClickOutside = (event: Event): void => {
    if (!isOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (root.contains(target)) return;
    hide();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isOpen()) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem((focusedIndex + 1) % menuItemButtons.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusItem((focusedIndex - 1 + menuItemButtons.length) % menuItemButtons.length);
        return;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        return;
      case 'End':
        event.preventDefault();
        focusItem(menuItemButtons.length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        hide();
        editor.view.focus();
        return;
      default:
        return;
    }
  };

  return new Plugin({
    key: pluginKey,

    view: (editorView) => {
      editorEl = editorView.dom.closest('.dm-editor');
      if (!editorEl) return { destroy: () => { /* noop */ } };

      editorEl.appendChild(root);
      hide();

      editorEl.addEventListener('dm:block-context-menu-open', onOpen);
      editorEl.addEventListener('dm:dismiss-overlays', onDismiss);
      document.addEventListener('mousedown', onClickOutside, true);
      root.addEventListener('keydown', onKeyDown);

      return {
        destroy: () => {
          hide();
          editorEl?.removeEventListener('dm:block-context-menu-open', onOpen);
          editorEl?.removeEventListener('dm:dismiss-overlays', onDismiss);
          document.removeEventListener('mousedown', onClickOutside, true);
          root.removeEventListener('keydown', onKeyDown);
          root.remove();
          editorEl = null;
        },
      };
    },
  });
}

export const BlockContextMenu = Extension.create<BlockContextMenuOptions>({
  name: 'blockContextMenu',

  addOptions() {
    return {
      turnIntoEnabled: true,
      turnIntoTargets: DEFAULT_TURN_INTO,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    if (!editor) return [];
    return [
      createBlockContextMenuPlugin({
        pluginKey: blockContextMenuPluginKey,
        editor,
        turnIntoEnabled: this.options.turnIntoEnabled ?? true,
        turnIntoTargets: this.options.turnIntoTargets ?? DEFAULT_TURN_INTO,
      }),
    ];
  },
});
