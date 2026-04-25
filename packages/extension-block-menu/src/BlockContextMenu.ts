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
import { Extension, defaultIcons, positionFloatingOnce, writeToClipboard } from '@domternal/core';
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

/**
 * Shape of the `uniqueID` extension's options. We only read the two fields
 * we care about; duplicating the full `UniqueIDOptions` type here avoids
 * importing it from core (which would couple an otherwise-optional feature).
 */
interface UniqueIDOptionsShape {
  attributeName?: string;
  generateID?: () => string;
}

/**
 * Same pattern for `blockColor` — we peek at the palette + types list but
 * don't import `BlockColorOptions` directly because the Colors UI degrades
 * gracefully when the extension isn't loaded.
 */
interface BlockColorOptionsShape {
  types?: string[];
  bgColors?: string[];
  textColors?: string[];
}

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
  /**
   * Show "Copy link" when the target block has an id attribute AND the
   * `UniqueID` extension is loaded in the editor. Without UniqueID this
   * option has no effect — the item never appears regardless of value.
   * @default true
   */
  copyLinkEnabled?: boolean;
  /**
   * Build the URL written to the clipboard when the user clicks "Copy link".
   * Receives the block's id and the editor; returns a full URL. Default
   * appends `#<id>` to the current pathname+search, which works for static
   * pages. Frameworks with client-side routing should provide a callback
   * matching their URL scheme.
   */
  onCopyLink?: (blockId: string, editor: Editor) => string;
  /**
   * Show the Colors section (text color + background) when the `BlockColor`
   * extension is loaded and the target block is in its `types` list.
   * Without BlockColor this option has no effect.
   * @default true
   */
  blockColorEnabled?: boolean;
}

export interface CreateBlockContextMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  turnIntoEnabled: boolean;
  turnIntoTargets: TurnIntoTarget[];
  copyLinkEnabled: boolean;
  onCopyLink: (blockId: string, editor: Editor) => string;
  blockColorEnabled: boolean;
}

/**
 * Default URL template for "Copy link to block" — appends `#<blockId>` to
 * the current pathname+search. Works for static sites; SPA hosts should
 * override via the `onCopyLink` option.
 */
function defaultCopyLinkUrl(blockId: string): string {
  if (typeof window === 'undefined') return `#${blockId}`;
  const { pathname, search } = window.location;
  return `${pathname}${search}#${blockId}`;
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
  const { pluginKey, editor, turnIntoEnabled, turnIntoTargets, copyLinkEnabled, onCopyLink, blockColorEnabled } = options;

  // Cache optional-extension detection once at plugin construction. The
  // editor's extension list AND its options are immutable for the editor's
  // lifetime, so there's no need to re-check on every menu open. `null`
  // for each means the paired extension isn't loaded (and the matching
  // menu section is hidden).
  const uniqueIDExt = editor.extensionManager.extensions.find((ext) => ext.name === 'uniqueID');
  const uniqueIDAttrName: string | null = uniqueIDExt
    ? ((uniqueIDExt.options as UniqueIDOptionsShape).attributeName ?? 'id')
    : null;
  const uniqueIDGenerate: (() => string) | null = uniqueIDExt
    ? ((uniqueIDExt.options as UniqueIDOptionsShape).generateID ?? null)
    : null;

  const blockColorExt = editor.extensionManager.extensions.find((ext) => ext.name === 'blockColor');
  const blockColorOpts = blockColorExt
    ? (blockColorExt.options as BlockColorOptionsShape)
    : null;
  const blockColorTypes: string[] | null = blockColorOpts?.types ?? null;
  const blockBgPalette: string[] = blockColorOpts?.bgColors ?? [];
  const blockTextPalette: string[] = blockColorOpts?.textColors ?? [];

  // --- Build popup DOM once.
  const root = document.createElement('div');
  root.className = 'dm-block-context-menu';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Block options');
  root.setAttribute('data-dm-editor-ui', '');

  let editorEl: HTMLElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  let currentBlockPos: number | null = null;
  // Roving tabindex: which menuitem is currently focused. Initialised to 0
  // because the menu auto-focuses the first item on open.
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
    // When UniqueID is loaded, regenerate the id on the copy so it doesn't
    // collide with the source. All other attrs (colors, levels, etc.) are
    // preserved by spreading.
    const transformAttrs = uniqueIDAttrName && uniqueIDGenerate
      ? (attrs: Attrs): Attrs => ({ ...attrs, [uniqueIDAttrName]: uniqueIDGenerate() })
      : undefined;
    runAndClose((tr) => { duplicateBlock(tr, pos, transformAttrs); });
  };

  const runCopyLink = (blockId: string): void => {
    const url = onCopyLink(blockId, editor);
    void writeToClipboard(url).then((ok: boolean) => {
      // Semantic event split: `success` fires only when the write actually
      // succeeded, `error` fires otherwise. Host apps listen to one or both.
      // Detail carries the URL and id so the host can format its own message.
      const name = ok ? 'dm:copy-link-success' : 'dm:copy-link-error';
      editorEl?.dispatchEvent(new CustomEvent(name, {
        bubbles: false,
        detail: { url, blockId },
      }));
    });
    hide();
    editor.view.focus();
  };

  const runTurnInto = (target: TurnIntoTarget): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    const targetType = editor.view.state.schema.nodes[target.nodeType];
    if (!targetType) return;
    runAndClose((tr) => { turnIntoBlock(tr, pos, targetType, target.attrs); });
  };

  /**
   * Sets `bgColor` or `textColor` directly on the block at `currentBlockPos`
   * via `setNodeMarkup`. Bypasses the BlockColor command's ancestor walk
   * because the menu already knows which block was targeted.
   */
  const runSetColor = (attr: 'bgColor' | 'textColor', color: string | null): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    runAndClose((tr) => {
      const n = tr.doc.nodeAt(pos);
      if (!n) return;
      tr.setNodeMarkup(pos, undefined, { ...n.attrs, [attr]: color });
    });
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
    // Copy link — only when UniqueID is loaded AND this block has an id attr
    // AND the feature is enabled. Items on paragraphs without an id (legacy
    // content) gracefully skip the item rather than copying an empty hash.
    if (copyLinkEnabled && uniqueIDAttrName) {
      const id = (node.attrs as Record<string, unknown>)[uniqueIDAttrName];
      if (typeof id === 'string' && id.length > 0) {
        primaryGroup.appendChild(
          makeItem('Copy link', 'link', () => { runCopyLink(id); }),
        );
      }
    }
    root.appendChild(primaryGroup);

    // --- Colors section (text color + background)
    // Shown only when BlockColor is loaded AND the target block type is in
    // its `types` list. The picker renders two rows of swatches (bg + text)
    // plus a "clear" swatch that unsets the attribute.
    if (blockColorEnabled && blockColorTypes?.includes(node.type.name)) {
      const label = document.createElement('div');
      label.className = 'dm-block-context-menu-group-label';
      label.textContent = 'Colors';
      root.appendChild(label);

      const currentBg = (node.attrs as Record<string, unknown>)['bgColor'] as string | null;
      const currentText = (node.attrs as Record<string, unknown>)['textColor'] as string | null;

      root.appendChild(
        buildSwatchRow(
          'Text color',
          'text',
          blockTextPalette,
          currentText,
          (color) => { runSetColor('textColor', color); },
        ),
      );
      root.appendChild(
        buildSwatchRow(
          'Background',
          'bg',
          blockBgPalette,
          currentBg,
          (color) => { runSetColor('bgColor', color); },
        ),
      );
    }

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
   * Build a single color-picker swatch. `null` color becomes a "clear"
   * swatch (unset the attribute). Swatches participate in roving-tabindex
   * keyboard nav alongside menu items.
   */
  const makeSwatch = (
    variant: 'bg' | 'text',
    color: string | null,
    current: string | null,
    onClick: (c: string | null) => void,
  ): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dm-block-color-swatch dm-block-color-swatch--${variant}`;
    btn.setAttribute('role', 'menuitem');
    const labelText = color === null
      ? (variant === 'bg' ? 'No background' : 'Default text color')
      : `${variant === 'bg' ? 'Background' : 'Text color'}: ${color}`;
    btn.setAttribute('aria-label', labelText);
    btn.setAttribute('data-color', color ?? 'null');
    if (current === color || (color === null && !current)) {
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.tabIndex = menuItemButtons.length === 0 ? 0 : -1;

    btn.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); });
    btn.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      onClick(color);
    });
    menuItemButtons.push(btn);
    return btn;
  };

  /**
   * Compose a labelled swatch row (a strip of color buttons) for either
   * text color or background. The first entry is always a "clear" swatch
   * that unsets the attribute.
   */
  const buildSwatchRow = (
    rowLabel: string,
    variant: 'bg' | 'text',
    palette: string[],
    current: string | null,
    onClick: (color: string | null) => void,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'dm-block-color-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', rowLabel);

    const visuallyHidden = document.createElement('span');
    visuallyHidden.className = 'dm-block-color-row-label';
    visuallyHidden.textContent = rowLabel;
    row.appendChild(visuallyHidden);

    row.appendChild(makeSwatch(variant, null, current, onClick));
    for (const c of palette) {
      row.appendChild(makeSwatch(variant, c, current, onClick));
    }
    return row;
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
      copyLinkEnabled: true,
      onCopyLink: defaultCopyLinkUrl,
      blockColorEnabled: true,
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
        copyLinkEnabled: this.options.copyLinkEnabled ?? true,
        onCopyLink: this.options.onCopyLink ?? defaultCopyLinkUrl,
        blockColorEnabled: this.options.blockColorEnabled ?? true,
      }),
    ];
  },
});
