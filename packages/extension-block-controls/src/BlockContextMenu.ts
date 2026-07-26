/**
 * Popup menu opened by clicking the BlockHandle drag handle without dragging.
 * Offers Delete, Duplicate, and Turn into (change block type) for the target.
 *
 * Triggered by the `dm:block-context-menu-open` event from BlockHandle, with
 * payload `{ blockPos, anchorElement }`. Mirrors FloatingMenu / SlashCommand
 * styling: `role="menu"`, `role="menuitem"`, `data-show`, positionFloatingOnce.
 */
import { Extension, defaultIcons, liftCurrentListItem, positionFloatingOnce, stripInlineColorConflicts, writeToClipboard } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { Plugin, PluginKey, TextSelection, EditorState } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { Attrs, Node as PMNode } from '@domternal/pm/model';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import {
  deleteBlock,
  duplicateBlock,
  turnIntoBlock,
} from './helpers/blockOperations.js';
import { turnIntoWrapper, type WrapperCommand } from './helpers/turnIntoWrapper.js';

/**
 * Subset of `uniqueID` options we read. Avoids importing `UniqueIDOptions`
 * from core, which would couple this to an otherwise-optional feature.
 */
interface UniqueIDOptionsShape {
  attributeName?: string;
  generateID?: () => string;
}

/** Subset of `blockColor` options. Not imported directly so the Colors UI degrades gracefully when the extension isn't loaded. */
interface BlockColorOptionsShape {
  types?: string[];
  bgColors?: string[];
  textColors?: string[];
}

/**
 * Where a contributed item lands. A CLOSED set owned by this package and
 * rendered in this order, so a contributor can place an item inside the menu
 * but can never reorder the menu itself. `collaboration` is the trailing group,
 * matching Notion, which keeps commenting apart from both the structural
 * actions and the destructive ones.
 */
export type BlockMenuItemGroup = 'primary' | 'colors' | 'turnInto' | 'collaboration';

const GROUP_ORDER: BlockMenuItemGroup[] = ['primary', 'colors', 'turnInto', 'collaboration'];

/** What a contributed item is told about the block the menu was opened on. */
export interface BlockMenuItemContext {
  editor: Editor;
  /** Position of the target block in the document. */
  blockPos: number;
  node: PMNode;
  /**
   * The block's `uniqueID` value, or null when UniqueID is not loaded or has
   * not stamped this block. Resolved here so a contributor never has to know
   * how the id is configured.
   */
  blockId: string | null;
}

/**
 * A menu entry contributed by another extension through `addBlockMenuItems()`.
 *
 * Declarative on purpose: contributors describe an item and this package builds
 * the button, so every entry keeps `role="menuitem"`, the roving tabindex, the
 * arrow-key navigation and the mousedown-preventDefault that holds editor
 * focus. Injecting DOM into the open menu would get all four wrong.
 */
export interface BlockMenuItem {
  /** Stable across renders; used for dedupe and as a test handle. */
  id: string;
  label: string;
  /** Key into the shared icon set, resolved the same way built-in items are. */
  icon: string;
  group: BlockMenuItemGroup;
  /** Within the group, ascending. Defaults to 100; step by 10 to leave room. */
  order?: number;
  /** Hide the item entirely. Use for "this block can never take this action". */
  isAvailable?: (context: BlockMenuItemContext) => boolean;
  /**
   * Show the item but refuse it, with a reason surfaced to the user. Prefer
   * this over hiding when the action is normally possible here: an item that
   * vanishes teaches nothing, while "Comment (this block is empty)" does.
   */
  isEnabled?: (context: BlockMenuItemContext) => true | { disabled: true; reason: string };
  run: (context: BlockMenuItemContext) => void;
}

declare module '@domternal/core' {
  // Type parameters must mirror the original declaration exactly for the
  // augmentation to merge rather than shadow.
  // The type parameters exist only to mirror the original declaration: an
  // augmentation that omits them shadows the interface instead of merging.
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  interface ExtensionConfigBase<Options = unknown, Storage = unknown> {
    /**
     * Contribute entries to the block context menu, the same shape as
     * `addToolbarItems()`. Declared here rather than in core because this
     * package is the only thing that renders them, so core never learns a type
     * it does not use.
     */
    addBlockMenuItems?: () => BlockMenuItem[];
  }
}

/**
 * `props.decorations` applies the `dm-block-context-active` class via a PM
 * Decoration (not inline classList) so the highlight survives view rerenders
 * from other transactions, e.g. UniqueID stamping `id` via setNodeMarkup.
 */
export interface BlockContextMenuPluginState {
  activeBlockPos: number | null;
}

export const blockContextMenuPluginKey = new PluginKey<BlockContextMenuPluginState>('blockContextMenu');

const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/** A block type offered by the "Turn into" submenu. */
export interface TurnIntoTarget {
  /** Display label, e.g. "Heading 1". */
  label: string;
  /** Icon key resolved against `defaultIcons`. */
  icon: string;
  /** Schema node name, e.g. "heading", "paragraph", "blockquote". */
  nodeType: string;
  /** Optional node attributes (e.g. `{ level: 1 }` for Heading 1). */
  attrs?: Attrs;
  /**
   * Command for wrapper (non-textblock) targets like lists and blockquote.
   * When set, runTurnInto routes through `turnIntoWrapper` instead of
   * `setBlockType`. Leave undefined for textblock targets (paragraph,
   * heading, codeBlock).
   */
  command?: WrapperCommand;
}

const DEFAULT_TURN_INTO: TurnIntoTarget[] = [
  { label: 'Paragraph', icon: 'textT', nodeType: 'paragraph' },
  { label: 'Heading 1', icon: 'textHOne', nodeType: 'heading', attrs: { level: 1 } },
  { label: 'Heading 2', icon: 'textHTwo', nodeType: 'heading', attrs: { level: 2 } },
  { label: 'Heading 3', icon: 'textHThree', nodeType: 'heading', attrs: { level: 3 } },
  { label: 'Bullet list', icon: 'listBullets', nodeType: 'bulletList', command: 'turnIntoBulletList' },
  { label: 'Ordered list', icon: 'listNumbers', nodeType: 'orderedList', command: 'turnIntoOrderedList' },
  { label: 'To-do list', icon: 'listChecks', nodeType: 'taskList', command: 'turnIntoTaskList' },
  { label: 'Quote', icon: 'quotes', nodeType: 'blockquote', command: 'toggleBlockquote' },
  { label: 'Code block', icon: 'codeBlock', nodeType: 'codeBlock' },
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
   * `UniqueID` extension is loaded. No effect without UniqueID.
   * @default true
   */
  copyLinkEnabled?: boolean;
  /**
   * Builds the URL written to the clipboard on "Copy link". Default appends
   * `#<id>` to the current pathname+search (works for static pages); apps
   * with client-side routing should provide a callback matching their scheme.
   */
  onCopyLink?: (blockId: string, editor: Editor) => string;
  /**
   * Show the Colors section (text + background) when the `BlockColor`
   * extension is loaded and the target block is in its `types` list.
   * @default true
   */
  blockColorEnabled?: boolean;
}

export interface CreateBlockContextMenuPluginOptions {
  pluginKey: PluginKey<BlockContextMenuPluginState>;
  editor: Editor;
  turnIntoEnabled: boolean;
  turnIntoTargets: TurnIntoTarget[];
  copyLinkEnabled: boolean;
  onCopyLink: (blockId: string, editor: Editor) => string;
  blockColorEnabled: boolean;
}

/** Default "Copy link" URL: appends `#<blockId>` to the current pathname+search. SPA hosts override via `onCopyLink`. */
function defaultCopyLinkUrl(blockId: string): string {
  if (typeof window === 'undefined') return `#${blockId}`;
  const { pathname, search } = window.location;
  return `${pathname}${search}#${blockId}`;
}

/** Detail of the `dm:block-context-menu-open` event from BlockHandle. */
interface BlockContextMenuOpenDetail {
  blockPos: number;
  anchorElement: HTMLElement;
}

/**
 * Selector to re-locate an anchor button if its DOM identity changes (e.g.
 * the bubble menu rebuilding buttons via `replaceChildren`). Returns `null`
 * for anchors we can't reliably re-resolve (e.g. the BlockHandle drag button,
 * keyed by absolute position, not class).
 */
function matchingSelectorFor(anchor: HTMLElement): string | null {
  const ariaLabel = anchor.getAttribute('aria-label');
  if (ariaLabel) {
    const escaped = ariaLabel.replace(/"/g, '\\"');
    return `button[aria-label="${escaped}"]`;
  }
  return null;
}

/**
 * Builds the popup DOM, listens for `dm:block-context-menu-open` on
 * `.dm-editor`, and runs block operations via `helpers/blockOperations.ts`.
 */
export function createBlockContextMenuPlugin(
  options: CreateBlockContextMenuPluginOptions,
): Plugin {
  const { pluginKey, editor, turnIntoEnabled, turnIntoTargets, copyLinkEnabled, onCopyLink, blockColorEnabled } = options;

  // Detect optional extensions once at construction (extensions + options are
  // immutable for the editor's lifetime). `null` means not loaded, so the
  // matching menu section is hidden.
  // CONSTRAINT: runtime re-registration / live-mutation of `uniqueID` /
  // `blockColor` options won't be reflected. If ever needed, move these reads
  // into `renderItems()` so each open re-resolves fresh state.
  const uniqueIDExt = editor.extensionManager.extensions.find((ext) => ext.name === 'uniqueID');
  const uniqueIDAttrName: string | null = uniqueIDExt
    ? ((uniqueIDExt.options as UniqueIDOptionsShape).attributeName ?? 'id')
    : null;
  const uniqueIDGenerate: (() => string) | null = uniqueIDExt
    ? ((uniqueIDExt.options as UniqueIDOptionsShape).generateID ?? null)
    : null;

  /**
   * Items contributed by other extensions, collected once for the same reason
   * the optional-extension reads above are: extensions are immutable for the
   * editor's lifetime. Sorted by (group, order, registration) so equal orders
   * stay in a deterministic sequence rather than depending on collection order.
   * `isAvailable` and `isEnabled` are evaluated per OPEN, not here, because
   * they depend on the block the menu was opened on.
   */
  const contributedItems: BlockMenuItem[] = editor.extensionManager.extensions
    .flatMap((ext) => {
      const add = (ext as unknown as { config: { addBlockMenuItems?: () => BlockMenuItem[] } })
        .config.addBlockMenuItems;
      if (typeof add !== 'function') return [];
      try {
        return add.call(ext);
      } catch {
        // One misbehaving contributor must not take the whole menu down.
        return [];
      }
    })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const groupDelta =
        GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group);
      if (groupDelta !== 0) return groupDelta;
      const orderDelta = (a.item.order ?? 100) - (b.item.order ?? 100);
      return orderDelta !== 0 ? orderDelta : a.index - b.index;
    })
    .map(({ item }) => item);

  const blockColorExt = editor.extensionManager.extensions.find((ext) => ext.name === 'blockColor');
  const blockColorOpts = blockColorExt
    ? (blockColorExt.options as BlockColorOptionsShape)
    : null;
  const blockColorTypes: string[] | null = blockColorOpts?.types ?? null;
  const blockBgPalette: string[] = blockColorOpts?.bgColors ?? [];
  const blockTextPalette: string[] = blockColorOpts?.textColors ?? [];

  // Build popup DOM once.
  const root = document.createElement('div');
  root.className = 'dm-block-context-menu';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Block options');
  root.setAttribute('data-dm-editor-ui', '');

  let editorEl: HTMLElement | null = null;
  let cleanupFloating: (() => void) | null = null;
  let currentBlockPos: number | null = null;
  // Roving tabindex: currently-focused menuitem. Starts at 0 (auto-focused on open).
  let focusedIndex = 0;
  let menuItemButtons: HTMLButtonElement[] = [];
  // rAF id for the initial focus, so `hide()` can cancel it if the menu closes
  // before the frame fires (else the callback races teardown and focuses a stale button).
  let initialFocusRaf: number | null = null;
  // Idempotency guard for the page-scroll-lock wheel/touchmove listeners.
  let scrollLocked = false;

  const isOpen = (): boolean => root.hasAttribute('data-show');

  /**
   * Suppresses page scroll while the menu is open. Scroll inside the menu is
   * allowed only when it has scrollable overflow, else wheel events would
   * bubble through and scroll the page. The theme's `overscroll-behavior:
   * contain` stops chaining at the menu's scroll edges.
   */
  const onBlockScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && root.contains(target)) {
      const hasOverflow = root.scrollHeight > root.clientHeight;
      if (hasOverflow) return;
    }
    event.preventDefault();
  };

  const lockScroll = (): void => {
    if (scrollLocked) return;
    scrollLocked = true;
    // `passive: false` so preventDefault() takes effect (browsers default
    // wheel/touchmove to passive for scroll perf).
    document.addEventListener('wheel', onBlockScroll, { passive: false });
    document.addEventListener('touchmove', onBlockScroll, { passive: false });
  };

  const unlockScroll = (): void => {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.removeEventListener('wheel', onBlockScroll);
    document.removeEventListener('touchmove', onBlockScroll);
  };

  const hide = (): void => {
    if (initialFocusRaf !== null) {
      cancelAnimationFrame(initialFocusRaf);
      initialFocusRaf = null;
    }
    cleanupFloating?.();
    cleanupFloating = null;
    unlockScroll();
    editorEl?.removeAttribute('data-block-context-menu-open');
    // `editor.view` is undefined during the first `hide()` at plugin init - skip dispatch.
    const view = editor.view as typeof editor.view | undefined;
    if (view) {
      const tr = view.state.tr.setMeta(pluginKey, { activeBlockPos: null });
      tr.setMeta('addToHistory', false);
      view.dispatch(tr);
    }
    root.removeAttribute('data-show');
    currentBlockPos = null;
    menuItemButtons = [];
    focusedIndex = 0;
  };

  const focusItem = (index: number): void => {
    if (menuItemButtons.length === 0) return;
    const clamped = Math.max(0, Math.min(index, menuItemButtons.length - 1));
    // Roving tabindex: only the focused item stays in the Tab order, else
    // Tab-away-and-back lands on the wrong item (WAI-ARIA menu pattern).
    for (let i = 0; i < menuItemButtons.length; i++) {
      const btn = menuItemButtons[i];
      if (btn) btn.tabIndex = i === clamped ? 0 : -1;
    }
    focusedIndex = clamped;
    menuItemButtons[clamped]?.focus();
  };

  /** Runs a block operation, then closes the menu and refocuses the editor. */
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
    // When UniqueID is loaded, regenerate the id on the copy to avoid
    // colliding with the source; all other attrs are preserved by spreading.
    const transformAttrs = uniqueIDAttrName && uniqueIDGenerate
      ? (attrs: Attrs): Attrs => ({ ...attrs, [uniqueIDAttrName]: uniqueIDGenerate() })
      : undefined;
    runAndClose((tr) => { duplicateBlock(tr, pos, transformAttrs); });
  };

  const runCopyLink = (blockId: string): void => {
    const url = onCopyLink(blockId, editor);
    void writeToClipboard(url).then((ok: boolean) => {
      // `success` fires only on a successful write, `error` otherwise. Detail
      // carries the URL and id so the host can format its own message.
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
    const blockPos = currentBlockPos;
    const sourceNode = editor.view.state.doc.nodeAt(blockPos);
    if (!sourceNode) return;
    const sourceIsTextblock = sourceNode.type.isTextblock;

    // For a wrapper source (listItem / taskItem / blockquote), descend to its
    // inner first textblock so the wrapper command gets a valid textblock source.
    const pos = sourceIsTextblock ? blockPos : blockPos + 1;

    // Wrapper targets route through the helper / editor command, which
    // dispatches its own transaction (with scrollIntoView), so we just
    // close the menu and restore focus.
    if (target.command) {
      turnIntoWrapper(editor, pos, target.command);
      hide();
      editor.view.focus();
      return;
    }
    const targetType = editor.view.state.schema.nodes[target.nodeType];
    if (!targetType) return;

    // Textblock source: position-precise setBlockType (preserves bg/text/id).
    if (sourceIsTextblock) {
      runAndClose((tr) => { turnIntoBlock(tr, pos, targetType, target.attrs); });
      return;
    }

    // Wrapper source (list item) + textblock target: a raw setBlockType is a
    // no-op inside a list item (its label must stay a paragraph), so lift the
    // item out of its list first (Notion turn-into: splits the run, unindents),
    // then set the block type. For the Paragraph target the lift IS the
    // conversion, so the setBlockType step is skipped.
    runAndClose((tr) => {
      const labelInner = Math.min(blockPos + 2, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, labelInner));
      const liftState = EditorState.create({ doc: tr.doc, selection: tr.selection });
      if (!liftCurrentListItem(liftState, tr)) return;
      if (targetType.name !== 'paragraph') {
        tr.setBlockType(
          tr.selection.from,
          tr.selection.to,
          targetType,
          (node) => ({ ...node.attrs, ...(target.attrs ?? {}) }),
        );
      }
    });
  };

  /**
   * Sets `bgColor` / `textColor` on the targeted block via `setNodeMarkup`,
   * bypassing the BlockColor command's ancestor walk (we already know the
   * block). Inline color marks of the same kind are stripped so the new block
   * tint wins ("last action wins"); see `stripInlineColorConflicts`.
   */
  const runSetColor = (attr: 'bgColor' | 'textColor', color: string | null): void => {
    if (currentBlockPos === null) return;
    const pos = currentBlockPos;
    runAndClose((tr) => {
      const n = tr.doc.nodeAt(pos);
      if (!n) return;
      tr.setNodeMarkup(pos, undefined, { ...n.attrs, [attr]: color });
      stripInlineColorConflicts(
        tr,
        editor.view.state,
        pos,
        pos + n.nodeSize,
        attr === 'textColor' ? 'text' : 'bg',
      );
    });
  };

  /**
   * Re-renders menu items for the target block. Hides "Turn into" targets that
   * match the current block (no-op conversions) and the whole section when the
   * source is neither a textblock nor a textblock-first wrapper.
   */
  const renderItems = (blockPos: number): void => {
    root.innerHTML = '';
    menuItemButtons = [];

    const node = editor.view.state.doc.nodeAt(blockPos);
    if (!node) return;

    const contributedContext: BlockMenuItemContext = {
      editor,
      blockPos,
      node,
      blockId: uniqueIDAttrName
        ? (((node.attrs as Record<string, unknown>)[uniqueIDAttrName] as string | undefined) ?? null)
        : null,
    };

    // Primary actions section.
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
    // Copy link: only when enabled, UniqueID is loaded, and the block has an
    // id. Blocks without an id (legacy content) skip it rather than copy an empty hash.
    if (copyLinkEnabled && uniqueIDAttrName) {
      const id = (node.attrs as Record<string, unknown>)[uniqueIDAttrName];
      if (typeof id === 'string' && id.length > 0) {
        primaryGroup.appendChild(
          makeItem('Copy link', 'link', () => { runCopyLink(id); }),
        );
      }
    }
    root.appendChild(primaryGroup);
    appendContributedGroup('primary', contributedContext);

    // Colors section: shown only when BlockColor is loaded and the block type
    // is in its `types` list. Renders bg + text swatch rows, each led by a "clear" swatch.
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
    appendContributedGroup('colors', contributedContext);

    // Turn into section. Two source modes:
    //   A. Textblock source (paragraph, heading, codeBlock): textblock AND
    //      wrapper targets eligible.
    //   B. Wrapper source (listItem/taskItem/blockquote whose first child is a
    //      textblock): wrapper targets AND textblock targets eligible (a list
    //      item is lifted out then converted; see runTurnInto), descending to
    //      the inner textblock for the ancestor walk.
    // Atoms (HR) and wrapper-of-wrapper (e.g. bulletList) hide it entirely, like Notion.
    const sourceIsTextblock = node.type.isTextblock;
    const sourceIsWrapper = !sourceIsTextblock && node.firstChild?.isTextblock === true;
    // A list-item source can also offer textblock targets (Heading, Code, ...):
    // it gets lifted out then converted (runTurnInto). A blockquote wrapper can't,
    // so textblock targets stay hidden there.
    const sourceIsListItem = node.type.name === 'listItem' || node.type.name === 'taskItem';
    if (turnIntoEnabled && (sourceIsTextblock || sourceIsWrapper)) {
      // For wrapper sources, walk from the inner textblock (blockPos + 1, past
      // the wrapper opening token) so it picks up listItem / taskList / blockquote.
      const ancestorPos = sourceIsTextblock ? blockPos : blockPos + 1;
      const $pos = editor.view.state.doc.resolve(ancestorPos);
      const ancestorTypeNames = new Set<string>();
      for (let d = 0; d <= $pos.depth; d++) {
        ancestorTypeNames.add($pos.node(d).type.name);
      }

      // The list kind directly wrapping the block's LABEL (the nearest list item
      // whose label slot the block sits in). A LIST target matching this is
      // hidden ("you're already a bullet"); a different kind stays available and
      // converts just this item / innermost sublist. Mirrors the slash menu, so
      // a bullet nested in an ordered list still offers "Ordered list".
      let labelWrapperType: string | null = null;
      for (let d = $pos.depth; d >= 1; d--) {
        const t = $pos.node(d).type.name;
        if (t === 'listItem' || t === 'taskItem') {
          if ($pos.index(d) === 0) labelWrapperType = $pos.node(d - 1).type.name;
          break;
        }
      }

      const eligible = turnIntoTargets.filter((target) => {
        const type = editor.view.state.schema.nodes[target.nodeType];
        if (!type) return false;

        if (target.command) {
          // A LIST target is hidden only when it is the innermost label wrapper
          // (converting to it would just lift the item out). Non-list wrapper
          // targets (Quote) keep the ancestor check: hidden only when already
          // inside that wrapper.
          if (LIST_WRAPPER_TYPES.has(target.nodeType)) {
            return target.nodeType !== labelWrapperType;
          }
          return !ancestorTypeNames.has(target.nodeType);
        }

        // Textblock target: eligible for a textblock source or a list-item
        // source (which is lifted out then converted in runTurnInto). A
        // blockquote wrapper source can't be, so it's excluded.
        if (!sourceIsTextblock && !sourceIsListItem) return false;
        if (!type.isTextblock) return false;
        // Skip targets identical to the current block (same type AND attrs,
        // e.g. hide "Heading 1" when already on H1). A wrapper source's type
        // (listItem) never equals a textblock target, so all are offered.
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
    appendContributedGroup('turnInto', contributedContext);

    // Trailing group, matching Notion, which keeps collaboration apart from
    // both the structural actions and the destructive ones.
    appendContributedGroup('collaboration', contributedContext);
  };

  /**
   * Builds the chrome shared by every menu button (item + swatch):
   * role=menuitem, roving-tabindex registration, mousedown preventDefault
   * (keeps editor focus), click handler.
   */
  const createMenuButton = (config: {
    className: string;
    ariaLabel: string;
    onClick: () => void;
    attributes?: Record<string, string>;
  }): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = config.className;
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-label', config.ariaLabel);
    if (config.attributes) {
      for (const [k, v] of Object.entries(config.attributes)) {
        btn.setAttribute(k, v);
      }
    }
    btn.tabIndex = menuItemButtons.length === 0 ? 0 : -1;
    btn.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); });
    btn.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      config.onClick();
    });
    menuItemButtons.push(btn);
    return btn;
  };

  /**
   * Renders the contributed items for one group, or nothing when none of them
   * apply to this block. Disabled items are RENDERED, greyed and inert, with
   * the reason on the button: an item that silently vanishes teaches the user
   * nothing, while "Comment (this block is empty)" does. They stay in the
   * roving tabindex so a keyboard user can reach the explanation.
   */
  const appendContributedGroup = (
    group: BlockMenuItemGroup,
    context: BlockMenuItemContext
  ): void => {
    const items = contributedItems.filter(
      (item) => item.group === group && (item.isAvailable?.(context) ?? true)
    );
    if (items.length === 0) return;

    const container = document.createElement('div');
    container.className = 'dm-block-context-menu-group';
    container.setAttribute('role', 'group');

    for (const item of items) {
      const enabled = item.isEnabled?.(context) ?? true;
      const disabledReason = enabled === true ? null : enabled.reason;
      const btn = makeItem(
        item.label,
        item.icon,
        () => {
          if (disabledReason !== null) return;
          hide();
          // Deliberately NOT refocusing the editor the way runAndClose does:
          // a contributed item commonly opens a surface of its own (a comment
          // composer) that wants the focus for itself.
          item.run(context);
        },
        { 'data-block-menu-item': item.id }
      );
      if (disabledReason !== null) {
        btn.setAttribute('aria-disabled', 'true');
        btn.classList.add('dm-block-context-menu-item--disabled');
        btn.title = disabledReason;
      }
      container.appendChild(btn);
    }
    root.appendChild(container);
  };

  /** Builds a menuitem button (icon + label) and registers it for nav. */
  const makeItem = (
    label: string,
    iconKey: string,
    onClick: () => void,
    attributes?: Record<string, string>,
  ): HTMLButtonElement => {
    const btn = createMenuButton({
      className: 'dm-block-context-menu-item',
      ariaLabel: label,
      onClick,
      ...(attributes ? { attributes } : {}),
    });

    // Icon SVG is trusted (our phosphor set), but `label` may come from
    // user-supplied `turnIntoTargets`, so use textContent for it.
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
    return btn;
  };

  /**
   * Builds one color swatch (`null` color = "clear", unsets the attribute).
   * Swatches join the roving-tabindex nav alongside menu items.
   */
  const makeSwatch = (
    variant: 'bg' | 'text',
    color: string | null,
    current: string | null,
    onClick: (c: string | null) => void,
  ): HTMLButtonElement => {
    const ariaLabel = color === null
      ? (variant === 'bg' ? 'No background' : 'Default text color')
      : `${variant === 'bg' ? 'Background' : 'Text color'}: ${color}`;
    const isPressed = (current === color || (color === null && !current));
    return createMenuButton({
      className: `dm-block-color-swatch dm-block-color-swatch--${variant}`,
      ariaLabel,
      onClick: () => { onClick(color); },
      attributes: {
        'data-color': color ?? 'null',
        'aria-pressed': isPressed ? 'true' : 'false',
      },
    });
  };

  /** Builds a labelled swatch row (text or background), led by a "clear" swatch. */
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
   *
   * `detail.blockPos` is whatever BlockHandle resolved under the cursor,
   * including nested list items (with `BlockHandle.nested`). Don't re-resolve
   * to the top-level block here, else "Delete" on one list item would nuke the
   * whole list.
   */
  const open = (detail: BlockContextMenuOpenDetail): void => {
    if (!editorEl) return;

    const node = editor.view.state.doc.nodeAt(detail.blockPos);
    if (!node) return;

    currentBlockPos = detail.blockPos;
    renderItems(detail.blockPos);
    if (menuItemButtons.length === 0) return;

    // Set the signal BEFORE dispatching dismiss so BlockHandle's listener can
    // tell "menu opening" from "another overlay dismissing me" and keep the
    // drag handle anchored.
    editorEl.setAttribute('data-block-context-menu-open', '');
    editorEl.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));
    root.setAttribute('data-show', '');
    lockScroll();
    const openTr = editor.view.state.tr.setMeta(pluginKey, { activeBlockPos: detail.blockPos });
    openTr.setMeta('addToHistory', false);
    editor.view.dispatch(openTr);

    cleanupFloating?.();
    // Virtual reference: caches the last valid rect for when the anchor
    // disconnects. Bubble menus rebuild their DOM via `replaceChildren()` on
    // every transaction, orphaning the anchor; without caching, autoUpdate
    // recomputes against a zero rect and the menu flies to the corner.
    let anchorEl: HTMLElement = detail.anchorElement;
    const bubbleMenuRef = anchorEl.closest<HTMLElement>('.dm-bubble-menu');
    const matchingSelector = matchingSelectorFor(anchorEl);
    let lastRect = anchorEl.getBoundingClientRect();
    const virtualRef: { getBoundingClientRect: () => DOMRect } = {
      getBoundingClientRect: () => {
        if (anchorEl.isConnected) {
          lastRect = anchorEl.getBoundingClientRect();
          return lastRect;
        }
        // Anchor disconnected: find an equivalent in the same bubble menu so
        // the menu tracks live DOM instead of pinning to the stale rect.
        if (matchingSelector && bubbleMenuRef?.isConnected) {
          const fresh = bubbleMenuRef.querySelector<HTMLElement>(matchingSelector);
          if (fresh) {
            anchorEl = fresh;
            lastRect = fresh.getBoundingClientRect();
            return lastRect;
          }
        }
        return lastRect;
      },
    };
    cleanupFloating = positionFloatingOnce(virtualRef, root, {
      placement: 'right-start',
      offsetValue: 4,
    });

    // Focus the first item (keyboard nav). Wait a frame for layout so focus
    // sees the visible element; `hide()` can cancel the rAF if we close first.
    focusedIndex = 0;
    initialFocusRaf = requestAnimationFrame(() => {
      initialFocusRaf = null;
      menuItemButtons[0]?.focus();
    });
  };

  // Event handlers.
  const onOpen = (event: Event): void => {
    // Widen detail to `T | undefined` to keep the runtime guard against a
    // plain Event dispatched without detail.
    const detail = (event as CustomEvent<BlockContextMenuOpenDetail | undefined>).detail;
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

  return new Plugin<BlockContextMenuPluginState>({
    key: pluginKey,
    state: {
      init: () => ({ activeBlockPos: null }),
      apply(tr, value) {
        const meta = tr.getMeta(pluginKey) as { activeBlockPos?: number | null } | undefined;
        if (meta && 'activeBlockPos' in meta) {
          return { activeBlockPos: meta.activeBlockPos ?? null };
        }
        // Remap across doc changes so the highlight tracks structural edits.
        if (value.activeBlockPos !== null && tr.docChanged) {
          const mapped = tr.mapping.mapResult(value.activeBlockPos, 1);
          return { activeBlockPos: mapped.deleted ? null : mapped.pos };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const plugin = pluginKey.getState(state);
        const activePos = plugin?.activeBlockPos ?? null;
        if (activePos === null) return null;
        const node = state.doc.nodeAt(activePos);
        if (!node) return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(activePos, activePos + node.nodeSize, { class: 'dm-block-context-active' }),
        ]);
      },
    },

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
    // Re-apply defaults to narrow the optional public option types back to
    // non-optional for the plugin factory.
    const opts = this.options;
    return [
      createBlockContextMenuPlugin({
        pluginKey: blockContextMenuPluginKey,
        editor,
        turnIntoEnabled: opts.turnIntoEnabled ?? true,
        turnIntoTargets: opts.turnIntoTargets ?? DEFAULT_TURN_INTO,
        copyLinkEnabled: opts.copyLinkEnabled ?? true,
        onCopyLink: opts.onCopyLink ?? defaultCopyLinkUrl,
        blockColorEnabled: opts.blockColorEnabled ?? true,
      }),
    ];
  },
});
