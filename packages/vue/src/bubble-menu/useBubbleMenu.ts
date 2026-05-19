import { onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import {
  PluginKey,
  ToolbarController,
  createBubbleMenuPlugin,
  defaultBubbleContexts,
  defaultIcons,
} from '@domternal/core';
import type { Editor, IconSet, ToolbarButton, ToolbarDropdown, BubbleMenuOptions } from '@domternal/core';
import { useDebouncedRef } from '../utils.js';

// --- Duck-typed ProseMirror shapes (avoids instanceof across bundles) ---

interface ResolvedPosShape {
  parent: { type: { name: string; spec: { marks?: string } } };
  depth: number;
  node: (depth: number) => { type: { name: string } };
}

interface SelectionShape {
  empty: boolean;
  $from: ResolvedPosShape;
  $to: ResolvedPosShape;
  node?: { type: { name: string } };
}

interface SchemaShape {
  nodes: Record<string, { allowsMarkType: (mt: unknown) => boolean }>;
  marks: Record<string, unknown>;
}

interface BubbleMenuSeparator { type: 'separator'; name: string }
export type BubbleMenuItem = ToolbarButton | ToolbarDropdown | BubbleMenuSeparator;

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

function isInsideTableCell($pos: ResolvedPosShape): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return true;
  }
  return false;
}

function findCellNode(pos: ResolvedPosShape): { type: { name: string } } | null {
  for (let d = pos.depth; d > 0; d--) {
    const node = pos.node(d);
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') return node;
  }
  return null;
}

// --- Composable ---

export interface UseBubbleMenuOptions {
  editor: ShallowRef<Editor | null>;
  shouldShow?: BubbleMenuOptions['shouldShow'] | undefined;
  placement?: 'top' | 'bottom' | undefined;
  offset?: number | undefined;
  updateDelay?: number | undefined;
  items?: string[] | undefined;
  contexts?: Record<string, string[] | true | null> | undefined;
  icons?: ShallowRef<IconSet | undefined> | undefined;
}

export interface UseBubbleMenuResult {
  menuRef: Ref<HTMLDivElement | undefined>;
  resolvedItems: ShallowRef<BubbleMenuItem[]>;
  isItemActive: (item: ToolbarButton) => boolean;
  isItemDisabled: (item: ToolbarButton) => boolean;
  executeCommand: (item: ToolbarButton, event?: Event) => void;
  activeVersion: Ref<number>;
  getCachedIcon: (name: string) => string;
  /** Live trailing-button state (color preview, node-selection gate, multi-block disable). */
  trailing: ShallowRef<BubbleMenuTrailingState>;
  /** Open the Notion color picker by emitting `notionColorOpen` with the trigger as anchor. */
  openColorPicker: (anchor: HTMLElement) => void;
  /** Open the block context menu by dispatching `dm:block-context-menu-open` on `.dm-editor`. */
  openBlockContextMenu: (anchor: HTMLElement) => void;
}

export function useBubbleMenu(options: UseBubbleMenuOptions): UseBubbleMenuResult {
  const { editor, shouldShow, placement = 'top', offset = 8, updateDelay = 0, items, contexts: explicitContexts, icons: iconsRef } = options;

  const menuRef = ref<HTMLDivElement>();
  // Prefer crypto.randomUUID for collision-free uniqueness when two
  // bubble-menu instances mount in the same editor (Math.random across
  // simultaneous mounts has a small but real collision probability, and
  // SSR may share the random seed). Matches Angular/React wrappers.
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const pluginKey = new PluginKey(
    'vueBubbleMenu-' +
      (cryptoRef?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8)),
  );
  const resolvedItems = shallowRef<BubbleMenuItem[]>([]);
  // `useDebouncedRef` batches transaction-rate updates via double-rAF, so
  // each keystroke triggers at most one re-render even though the plugin
  // fires `transaction` on every keystroke. See utils.ts.
  const activeVersion = useDebouncedRef(0);
  // Coalesced trailing-button state, updated once per transaction.
  const trailing = shallowRef<BubbleMenuTrailingState>(INITIAL_TRAILING_STATE);

  // Persistent state maps accessed by exposed helpers (isItemActive,
  // isItemDisabled) before doInit runs; must start as empty Maps.
  const activeMapRef = new Map<string, boolean>();
  const disabledMapRef = new Map<string, boolean>();
  // itemMap / dropdownMap / bubbleDefaults are only used inside doInit;
  // declared here so closures inside doInit can rebind on each run.
  let itemMap: Map<string, ToolbarButton>;
  let dropdownMap: Map<string, ToolbarDropdown>;
  let bubbleDefaults: Map<string, BubbleMenuItem[]>;
  let currentResolvedItems: BubbleMenuItem[] = [];

  let initialized = false;
  let stopEditorWatch: (() => void) | null = null;
  // Init when both editor is ready AND the component has mounted (menuRef
  // populated). onMounted guarantees DOM; then wait for editor if needed.
  const doInit = (ed: Editor): void => {
    if (initialized || ed.isDestroyed || !menuRef.value) return;
    initialized = true;

    // Resolve effective contexts: explicit user prop takes priority,
    // then items-only mode disables contexts entirely, otherwise fall
    // back to the standard default (Notion-richer when the editor sits
    // inside `.dm-notion-mode`).
    const contexts = explicitContexts ?? (items ? undefined : defaultBubbleContexts(ed));

    // Extension presence is immutable after editor construction: cache once
    // instead of walking the extension list on every transaction.
    const exts = ed.extensionManager.extensions;
    const hasNotionColorPicker = exts.some((e) => e.name === 'notionColorPicker');
    const hasBlockContextMenu = exts.some((e) => e.name === 'blockContextMenu');

    // Build item map. Dropdowns are kept separately so we can resolve them
    // by name (text-align dropdown in the bubble menu).
    itemMap = new Map();
    dropdownMap = new Map();
    for (const item of ed.toolbarItems) {
      if (item.type === 'button') {
        itemMap.set(item.name, item);
      } else if (item.type === 'dropdown') {
        dropdownMap.set(item.name, item);
        for (const sub of item.items) {
          itemMap.set(sub.name, sub);
        }
      }
    }

    // Build bubble defaults
    bubbleDefaults = new Map();
    const byCtx = new Map<string, ToolbarButton[]>();
    const addItem = (btn: ToolbarButton): void => {
      const ctx = (btn as unknown as Record<string, unknown>)['bubbleMenu'] as string | undefined;
      if (!ctx) return;
      let arr = byCtx.get(ctx);
      if (!arr) { arr = []; byCtx.set(ctx, arr); }
      arr.push(btn);
    };
    for (const item of ed.toolbarItems) {
      if (item.type === 'button') addItem(item);
      else if (item.type === 'dropdown') {
        for (const sub of item.items) addItem(sub);
      }
    }
    for (const [ctx, ctxItems] of byCtx) {
      ctxItems.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
      const result: BubbleMenuItem[] = [];
      let lastGroup: string | undefined;
      let sepIdx = 0;
      for (const item of ctxItems) {
        if (lastGroup !== undefined && item.group !== lastGroup) {
          result.push({ type: 'separator', name: `bsep-${String(sepIdx++)}` });
        }
        result.push(item);
        lastGroup = item.group;
      }
      bubbleDefaults.set(ctx, result);
    }

    // Resolve names helper. Dropdowns take priority over buttons sharing the
    // same name (mirrors the Angular wrapper). Pipe `|` is a separator marker.
    const resolveNames = (names: string[]): BubbleMenuItem[] => {
      const result: BubbleMenuItem[] = [];
      let sepIdx = 0;
      for (const name of names) {
        if (name === '|') {
          result.push({ type: 'separator', name: `sep-${String(sepIdx++)}` });
        } else {
          const dropdown = dropdownMap.get(name);
          if (dropdown) { result.push(dropdown); continue; }
          const item = itemMap.get(name);
          if (item) result.push(item);
        }
      }
      return result;
    };

    const getFormatItems = (): ToolbarButton[] => {
      return Array.from(itemMap.values())
        .filter(item => item.group === 'format')
        .sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
    };

    const detectContext = (selection: SelectionShape, ctxs: Record<string, string[] | true | null>): string | null => {
      if ('$anchorCell' in selection) return null;
      if (selection.node) return selection.node.type.name;
      if (selection.empty) return null;

      const fromCell = findCellNode(selection.$from);
      if (fromCell) {
        const toCell = findCellNode(selection.$to);
        if (toCell && fromCell !== toCell) return null;
        return 'table';
      }

      const fromName = selection.$from.parent.type.name;
      if (fromName in ctxs) return fromName;
      if ('text' in ctxs && selection.$from.parent.type.spec.marks !== '') return 'text';
      const toName = selection.$to.parent.type.name;
      if (toName in ctxs) return toName;
      if ('text' in ctxs && selection.$to.parent.type.spec.marks !== '') return 'text';
      return null;
    };

    const filterBySchema = (contextName: string, schemaItems: ToolbarButton[]): ToolbarButton[] => {
      if (contextName === 'text' || contextName === 'table') return schemaItems;
      const schema = (ed.state as unknown as { schema?: SchemaShape }).schema;
      if (!schema) return schemaItems;
      const nodeType = schema.nodes[contextName];
      if (!nodeType) return schemaItems;
      return schemaItems.filter(item => {
        const markName = typeof item.isActive === 'string' ? item.isActive : null;
        if (!markName) return true;
        const markType = schema.marks[markName];
        if (!markType) return true;
        return nodeType.allowsMarkType(markType);
      });
    };

    // Generate shouldShow function
    let shouldShowFn = shouldShow;
    if (!shouldShowFn) {
      if (contexts) {
        shouldShowFn = ({ state }: { state: { selection: SelectionShape } }) => {
          const context = detectContext(state.selection, contexts);
          if (!context) return false;
          if (context in contexts) {
            const val = contexts[context];
            if (val === null) return false;
            return val === true || (Array.isArray(val) && val.length > 0);
          }
          return bubbleDefaults.has(context);
        };
      } else {
        shouldShowFn = ({ state }: { state: { selection: SelectionShape } }) => {
          if (state.selection.empty) return false;
          if (state.selection.node) return bubbleDefaults.has(state.selection.node.type.name);
          if (isInsideTableCell(state.selection.$from)) return false;
          return state.selection.$from.parent.type.spec.marks !== ''
            || state.selection.$to.parent.type.spec.marks !== '';
        };
      }
    }

    // Register plugin
    const plugin = createBubbleMenuPlugin({
      pluginKey,
      editor: ed,
      element: menuRef.value,
      shouldShow: shouldShowFn,
      placement,
      offset,
      updateDelay,
    });
    ed.registerPlugin(plugin);

    const setItems = (newItems: BubbleMenuItem[]): void => {
      currentResolvedItems = newItems;
      resolvedItems.value = newItems;
    };

    // Set initial items
    if (contexts) {
      updateContextItems(ed, contexts, detectContext, resolveNames, getFormatItems, filterBySchema, bubbleDefaults, setItems);
    } else if (items) {
      setItems(resolveNames(items));
    } else {
      setItems(resolveNames(['bold', 'italic', 'underline']));
    }

    const updateStates = (currentEd: Editor): void => {
      let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
      try { canProxy = currentEd.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch { /* empty */ }

      const trackButton = (btn: ToolbarButton): void => {
        activeMapRef.set(btn.name, ToolbarController.resolveActive(currentEd as never, btn));
        try {
          const canCmd = typeof btn.command === 'string' ? canProxy?.[btn.command] : undefined;
          disabledMapRef.set(btn.name, canCmd
            ? !(btn.commandArgs?.length ? canCmd(...btn.commandArgs) : canCmd())
            : false);
        } catch { disabledMapRef.set(btn.name, false); }
      };

      for (const item of currentResolvedItems) {
        if (item.type === 'separator') continue;
        if (item.type === 'dropdown') {
          // Track each child so dynamicIcon + isActive lookups work.
          for (const sub of item.items) trackButton(sub);
          continue;
        }
        trackButton(item);
      }
    };

    const defaultItems = items ? resolveNames(items) : resolveNames(['bold', 'italic', 'underline']);

    /**
     * Coalesce all trailing-button derivations into a single shallowRef
     * update per transaction. New object identity ensures Vue's reactivity
     * triggers exactly one render per tick.
     */
    const syncTrailingState = (currentEd: Editor): void => {
      const sel = currentEd.state.selection as unknown as SelectionShape;
      const isNode = !!sel.node;

      // Multi-block disable for the "..." trigger: when $from and $to live
      // under different top-level blocks the context menu has no unambiguous
      // target. Cheap O(1) check via $.before(1).
      let blockMenuDisabled = false;
      if (hasBlockContextMenu) {
        const { $from, $to } = currentEd.state.selection;
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
        const mark = currentEd.state.selection.$from
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

      trailing.value = {
        isNodeSelection: isNode,
        showColorPickerButton: hasNotionColorPicker,
        showBlockMenuButton: hasBlockContextMenu,
        blockMenuButtonDisabled: blockMenuDisabled,
        currentTextColorVar: textVar,
        currentBgColorVar: bgVar,
        hasAnyColor: hasAny,
      };
    };

    // Transaction handler
    const transactionHandler = (): void => {
      if (contexts) {
        updateContextItems(ed, contexts, detectContext, resolveNames, getFormatItems, filterBySchema, bubbleDefaults, setItems);
      } else {
        const sel = ed.state.selection as unknown as SelectionShape;
        if (sel.node && bubbleDefaults.has(sel.node.type.name)) {
          setItems(bubbleDefaults.get(sel.node.type.name) ?? []);
        } else {
          setItems(defaultItems);
        }
      }
      updateStates(ed);
      syncTrailingState(ed);
      activeVersion.value++;
    };
    ed.on('transaction', transactionHandler);
    updateStates(ed);
    syncTrailingState(ed);

    initializedEditor = ed;
    initializedHandler = transactionHandler;
  };

  let initializedEditor: Editor | null = null;
  let initializedHandler: (() => void) | null = null;

  onMounted(() => {
    if (editor.value) {
      doInit(editor.value);
    } else {
      stopEditorWatch = watch(editor, (ed) => {
        if (ed) {
          doInit(ed);
          stopEditorWatch?.();
          stopEditorWatch = null;
        }
      });
    }
  });

  onScopeDispose(() => {
    stopEditorWatch?.();
    if (initializedEditor && initializedHandler) {
      initializedEditor.off('transaction', initializedHandler);
      if (!initializedEditor.isDestroyed) {
        initializedEditor.unregisterPlugin(pluginKey);
      }
    }
  });

  function updateContextItems(
    ed: Editor,
    ctxs: Record<string, string[] | true | null>,
    detectContext: (sel: SelectionShape, c: Record<string, string[] | true | null>) => string | null,
    resolveNames: (names: string[]) => BubbleMenuItem[],
    getFormatItems: () => ToolbarButton[],
    filterBySchema: (ctx: string, schemaItems: ToolbarButton[]) => ToolbarButton[],
    defaults: Map<string, BubbleMenuItem[]>,
    setItems: (items: BubbleMenuItem[]) => void,
  ): void {
    const ctx = detectContext(ed.state.selection as unknown as SelectionShape, ctxs);
    if (!ctx) { setItems([]); return; }

    if (ctx in ctxs) {
      const val = ctxs[ctx];
      if (val === null || (Array.isArray(val) && val.length === 0)) {
        setItems([]);
        return;
      }
      if (val === true) {
        setItems(filterBySchema(ctx, getFormatItems()));
      } else if (Array.isArray(val)) {
        const resolved = resolveNames(val);
        const buttons = resolved.filter((i): i is ToolbarButton => i.type !== 'separator');
        const filtered = new Set(filterBySchema(ctx, buttons).map(b => b.name));
        setItems(resolved.filter(i => i.type === 'separator' || filtered.has(i.name)));
      }
    } else {
      setItems(defaults.get(ctx) ?? []);
    }
  }

  const isItemActive = (item: ToolbarButton): boolean => {
    return activeMapRef.get(item.name) ?? false;
  };

  const isItemDisabled = (item: ToolbarButton): boolean => {
    return disabledMapRef.get(item.name) ?? false;
  };

  const executeCommand = (item: ToolbarButton, event?: Event): void => {
    const ed = editor.value;
    if (!ed) return;
    if (item.emitEvent) {
      // Forward the clicked button as the anchor so listeners (LinkPopover,
      // image popover, emoji picker, NotionColorPicker) can position their
      // panels against it. Matches Angular wrapper behaviour.
      const anchor =
        (event?.currentTarget as HTMLElement | undefined) ??
        (event?.target as HTMLElement | undefined) ?? null;
      (ed.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      return;
    }
    ToolbarController.executeItem(ed as never, item);
  };

  const getCachedIcon = (name: string): string => {
    return iconsRef?.value?.[name] ?? defaultIcons[name] ?? '';
  };

  /**
   * Emit `notionColorOpen` with the trigger as anchor. The wrapper
   * `DomternalNotionColorPicker` listens and positions itself against the
   * anchor element.
   */
  const openColorPicker = (anchor: HTMLElement): void => {
    const ed = editor.value;
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
    const ed = editor.value;
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
    getCachedIcon,
    trailing,
    openColorPicker,
    openBlockContextMenu,
  };
}
