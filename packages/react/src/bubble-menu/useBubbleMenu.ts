import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import {
  PluginKey,
  ToolbarController,
  buildBubbleItemMaps,
  createBubbleMenuPlugin,
  createBubbleShouldShow,
  defaultBubbleContexts,
  defaultIcons,
  resolveBubbleMenuItems,
  resolveBubbleNames,
} from '@domternal/core';
import type {
  BubbleContexts,
  BubbleMenuItem,
  Editor,
  IconSet,
  SelectionShape,
  ToolbarButton,
  BubbleMenuOptions,
} from '@domternal/core';

/* The item pipeline (which list this selection gets, what the schema allows,
   which separators survive) is core's. This file renders the answer and owns
   nothing about how it is reached. */
export type { BubbleMenuItem };

/**
 * Live state for the bubble-menu trailing buttons. Mirrors Angular's
 * `syncTrailingButtonsState` output. Computed per editor transaction and
 * coalesced into a single object so each transaction triggers at most one
 * re-render.
 */
export interface BubbleMenuTrailingState {
  /** True when current selection is a NodeSelection (image, HR, ...). Trailing buttons hide in that case. */
  isNodeSelection: boolean;
  /** True when the `notionColorPicker` extension is loaded on this editor (cached once per editor). */
  showColorPickerButton: boolean;
  /** True when the `blockContextMenu` extension is loaded on this editor (cached once per editor). */
  showBlockMenuButton: boolean;
  /** True when the selection spans more than one top-level block (multi-block "..." disable). */
  blockMenuButtonDisabled: boolean;
  /** CSS color value for the "A" trigger glyph (e.g. `var(--dm-block-text-yellow)`), or null. */
  currentTextColorVar: string | null;
  /** CSS color value for the "A" trigger underline, or null. */
  currentBgColorVar: string | null;
  /** True when any token-based text or background color is applied at the cursor. */
  hasAnyColor: boolean;
}

const INITIAL_TRAILING_STATE: BubbleMenuTrailingState = {
  isNodeSelection: false,
  showColorPickerButton: false,
  showBlockMenuButton: false,
  blockMenuButtonDisabled: false,
  currentTextColorVar: null,
  currentBgColorVar: null,
  hasAnyColor: false,
};

// --- Hook ---

export interface UseBubbleMenuOptions {
  editor: Editor | null;
  shouldShow?: BubbleMenuOptions['shouldShow'] | undefined;
  placement?: 'top' | 'bottom' | undefined;
  offset?: number | undefined;
  updateDelay?: number | undefined;
  items?: string[] | undefined;
  contexts?: BubbleContexts | undefined;
  icons?: IconSet | undefined;
}

export interface UseBubbleMenuResult {
  menuRef: RefObject<HTMLDivElement | null>;
  resolvedItems: BubbleMenuItem[];
  isItemActive: (item: ToolbarButton) => boolean;
  isItemDisabled: (item: ToolbarButton) => boolean;
  executeCommand: (item: ToolbarButton, event?: ReactMouseEvent | MouseEvent) => void;
  activeVersion: number;
  getCachedIcon: (name: string) => string;
  /** Live trailing-button state (color preview, node-selection gate, multi-block disable). */
  trailing: BubbleMenuTrailingState;
  /** Open the Notion color picker by emitting `notionColorOpen` with the trigger as anchor. */
  openColorPicker: (anchor: HTMLElement) => void;
  /** Open the block context menu by dispatching `dm:block-context-menu-open` on `.dm-editor`. */
  openBlockContextMenu: (anchor: HTMLElement) => void;
}

export function useBubbleMenu(options: UseBubbleMenuOptions): UseBubbleMenuResult {
  const { editor, shouldShow, placement = 'top', offset = 8, updateDelay = 0, items, contexts: explicitContexts, icons } = options;
  // Synthesise default contexts when the consumer hasn't supplied either
  // `contexts` or `items`. The default depends on the `.dm-notion-mode`
  // ancestor class so Notion-style hosts get a richer toolbar without
  // having to repeat the same `contexts` object in every <BubbleMenu>.
  const contexts = explicitContexts ?? (items ? undefined : (editor ? defaultBubbleContexts(editor) : undefined));

  const menuRef = useRef<HTMLDivElement>(null);
  const pluginKeyRef = useRef(new PluginKey('reactBubbleMenu-' + (
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.().slice(0, 8)
      ?? Math.random().toString(36).slice(2, 8)
  )));
  const [resolvedItems, setResolvedItems] = useState<BubbleMenuItem[]>([]);
  const [activeVersion, setActiveVersion] = useState(0);
  const [trailing, setTrailing] = useState<BubbleMenuTrailingState>(INITIAL_TRAILING_STATE);

  const activeMapRef = useRef(new Map<string, boolean>());
  const disabledMapRef = useRef(new Map<string, boolean>());
  const resolvedItemsRef = useRef<BubbleMenuItem[]>([]);
  // Cached "live" editor used by the hook's callbacks. The hook only re-runs
  // its big effect on editor changes, but the returned callbacks need to read
  // the current editor on each invocation - stash it in a ref to avoid stale
  // closures when the consumer holds the callback across re-renders.
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || editor.isDestroyed || !menuRef.current) return;

    // Extension presence is immutable after editor construction (D4 in
    // _planning/react_notion.md): cache once instead of walking the
    // extension list on every transaction.
    const exts = editor.extensionManager.extensions;
    const hasNotionColorPicker = exts.some((e) => e.name === 'notionColorPicker');
    const hasBlockContextMenu = exts.some((e) => e.name === 'blockContextMenu');

    /* One pipeline, built once per editor. Every renderer asks core the same
       question, so none of them answers it. */
    const maps = buildBubbleItemMaps(editor);

    // Generate shouldShow function
    const shouldShowFn =
      shouldShow ?? createBubbleShouldShow(maps, contexts);

    // Register plugin
    const pluginKey = pluginKeyRef.current;
    const plugin = createBubbleMenuPlugin({
      pluginKey,
      editor,
      element: menuRef.current,
      shouldShow: shouldShowFn,
      placement,
      offset,
      updateDelay,
    });
    editor.registerPlugin(plugin);

    /* The list core hands back, stored once. A default or fallback list comes
       back by reference, so those passes do not touch state at all; a list
       resolved from names is rebuilt each time, as it always was. */
    const setItems = (newItems: BubbleMenuItem[]): void => {
      resolvedItemsRef.current = newItems;
      setResolvedItems(newItems);
    };

    const fallbackItems = resolveBubbleNames(
      items ?? ['bold', 'italic', 'underline'],
      maps.itemMap,
      maps.dropdownMap,
    );

    const refreshItems = (ed: Editor): void => {
      setItems(resolveBubbleMenuItems({ editor: ed, maps, contexts, fallbackItems }));
    };

    // Set initial items
    refreshItems(editor);

    const updateStates = (ed: Editor): void => {
      let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
      try { canProxy = ed.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch { /* ignore */ }

      const trackButton = (btn: ToolbarButton): void => {
        activeMapRef.current.set(btn.name, ToolbarController.resolveActive(ed as never, btn));
        try {
          const canCmd = typeof btn.command === 'string' ? canProxy?.[btn.command] : undefined;
          disabledMapRef.current.set(btn.name, canCmd
            ? !(btn.commandArgs?.length ? canCmd(...btn.commandArgs) : canCmd())
            : false);
        } catch { disabledMapRef.current.set(btn.name, false); }
      };

      for (const item of resolvedItemsRef.current) {
        if (item.type === 'separator') continue;
        if (item.type === 'dropdown') {
          // Track each child so dynamicIcon + isActive lookups work.
          for (const sub of item.items) trackButton(sub);
          continue;
        }
        trackButton(item);
      }
    };

    /**
     * Coalesce all trailing-button derivations into a single `setTrailing`
     * call per transaction. Returning the same object shape (via referential
     * equality of every field) is fine - React's `Object.is` comparison only
     * skips re-render when the parent state value is the same reference, and
     * we always pass a new object, so the component renders once per tick.
     */
    const syncTrailingState = (ed: Editor): void => {
      const sel = ed.state.selection as unknown as SelectionShape;
      const isNode = !!sel.node;

      // Multi-block disable for the "..." trigger: when $from and $to live
      // under different top-level blocks the context menu has no unambiguous
      // target. Cheap O(1) check via $.before(1).
      let blockMenuDisabled = false;
      if (hasBlockContextMenu) {
        const { $from, $to } = ed.state.selection;
        if ($from.depth < 1 || $to.depth < 1) {
          blockMenuDisabled = true;
        } else {
          blockMenuDisabled = $from.before(1) !== $to.before(1);
        }
      }

      // Color preview for the "A" trigger glyph + underline. Read the
      // textStyle mark at $from; null tokens render as transparent.
      let textVar: string | null = null;
      let bgVar: string | null = null;
      let hasAny = false;
      if (hasNotionColorPicker) {
        const mark = ed.state.selection.$from
          .marks()
          .find((m) => m.type.name === 'textStyle');
        const attrs = (mark?.attrs ?? {}) as {
          colorToken?: string | null;
          backgroundColorToken?: string | null;
        };
        const tToken = attrs.colorToken ?? null;
        const bToken = attrs.backgroundColorToken ?? null;
        textVar = tToken ? `var(--dm-block-text-${tToken})` : null;
        bgVar = bToken ? `var(--dm-block-bg-${bToken})` : null;
        hasAny = tToken !== null || bToken !== null;
      }

      setTrailing({
        isNodeSelection: isNode,
        // Hidden without a live notionColorOpen listener: the trigger would be dead.
        showColorPickerButton:
          hasNotionColorPicker && ed.listenerCount('notionColorOpen') > 0,
        showBlockMenuButton: hasBlockContextMenu,
        blockMenuButtonDisabled: blockMenuDisabled,
        currentTextColorVar: textVar,
        currentBgColorVar: bgVar,
        hasAnyColor: hasAny,
      });
    };

    // Transaction handler
    const transactionHandler = (): void => {
      refreshItems(editor);
      updateStates(editor);
      syncTrailingState(editor);
      setActiveVersion(v => v + 1);
    };
    editor.on('transaction', transactionHandler);
    updateStates(editor);
    syncTrailingState(editor);

    return () => {
      editor.off('transaction', transactionHandler);
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(pluginKey);
      }
    };
    // Effect runs only when the editor instance changes. Other deps (items,
    // options, callbacks) are intentionally captured by closure on each render
    // through ref updates, not by re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const isItemActive = (item: ToolbarButton): boolean => {
    return activeMapRef.current.get(item.name) ?? false;
  };

  const isItemDisabled = (item: ToolbarButton): boolean => {
    return disabledMapRef.current.get(item.name) ?? false;
  };

  const executeCommand = (item: ToolbarButton, event?: ReactMouseEvent | MouseEvent): void => {
    if (!editor) return;
    if (item.emitEvent) {
      // Forward the clicked button as the anchor so listeners (LinkPopover,
      // image popover, emoji picker, NotionColorPicker) can position their
      // panels against it. Matches Angular wrapper behaviour.
      const anchor =
        (event?.currentTarget as HTMLElement | undefined) ??
        (event?.target as HTMLElement | undefined) ?? null;
      (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      return;
    }
    ToolbarController.executeItem(editor as never, item);
  };

  /**
   * Emit `notionColorOpen` with the trigger as anchor. The wrapper
   * `DomternalNotionColorPicker` listens and positions itself against the
   * anchor element.
   */
  const openColorPicker = (anchor: HTMLElement): void => {
    const ed = editorRef.current;
    if (!ed) return;
    (ed.emit as (e: string, d: unknown) => void)(
      'notionColorOpen',
      { anchorElement: anchor },
    );
  };

  /**
   * Open the BlockContextMenu against the cursor's containing block. Walk one
   * level up when the cursor's textblock is not a direct doc child (e.g.
   * cursor in `listItem > paragraph` targets the listItem) so Delete /
   * Turn into operate on the visual block the user is editing.
   */
  const openBlockContextMenu = (anchor: HTMLElement): void => {
    const ed = editorRef.current;
    if (!ed) return;
    const $from = ed.state.selection.$from;
    if ($from.depth < 1) return;
    const depth = $from.depth > 1 && $from.node($from.depth - 1).type.name !== 'doc'
      ? $from.depth - 1
      : $from.depth;
    const blockPos = $from.before(depth);
    const editorEl = ed.view.dom.closest<HTMLElement>('.dm-editor');
    editorEl?.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
      bubbles: false,
      detail: { blockPos, anchorElement: anchor },
    }));
  };

  return {
    menuRef,
    resolvedItems,
    isItemActive,
    isItemDisabled,
    executeCommand,
    activeVersion,
    getCachedIcon: (name: string) => icons?.[name] ?? defaultIcons[name] ?? '',
    trailing,
    openColorPicker,
    openBlockContextMenu,
  };
}
