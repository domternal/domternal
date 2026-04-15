import { onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { ShallowRef } from 'vue';
import {
  PluginKey,
  ToolbarController,
  createBubbleMenuPlugin,
  defaultIcons,
} from '@domternal/core';
import type { Editor, ToolbarButton, BubbleMenuOptions } from '@domternal/core';
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
export type BubbleMenuItem = ToolbarButton | BubbleMenuSeparator;

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
}

export function useBubbleMenu(options: UseBubbleMenuOptions) {
  const { editor, shouldShow, placement = 'top', offset = 8, updateDelay = 0, items, contexts } = options;

  const menuRef = ref<HTMLDivElement>();
  const pluginKey = new PluginKey('vueBubbleMenu-' + Math.random().toString(36).slice(2, 8));
  const resolvedItems = shallowRef<BubbleMenuItem[]>([]);
  const activeVersion = useDebouncedRef(0);

  // Persistent state maps accessed by exposed helpers (isItemActive,
  // isItemDisabled) before doInit runs; must start as empty Maps.
  const activeMapRef = new Map<string, boolean>();
  const disabledMapRef = new Map<string, boolean>();
  // itemMap and bubbleDefaults are only used inside doInit; declared here so
  // closures inside doInit can rebind on each run.
  let itemMap: Map<string, ToolbarButton>;
  let bubbleDefaults: Map<string, BubbleMenuItem[]>;
  let currentResolvedItems: BubbleMenuItem[] = [];

  let initialized = false;
  let stopEditorWatch: (() => void) | null = null;
  // Init when both editor is ready AND the component has mounted (menuRef
  // populated). onMounted guarantees DOM; then wait for editor if needed.
  const doInit = (ed: Editor) => {
    if (initialized || !ed || ed.isDestroyed || !menuRef.value) return;
    initialized = true;

    // Build item map
    itemMap = new Map();
    for (const item of ed.toolbarItems) {
      if (item.type === 'button') {
        itemMap.set(item.name, item);
      } else if (item.type === 'dropdown') {
        for (const sub of item.items) {
          itemMap.set(sub.name, sub);
        }
      }
    }

    // Build bubble defaults
    bubbleDefaults = new Map();
    const byCtx = new Map<string, ToolbarButton[]>();
    const addItem = (btn: ToolbarButton) => {
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
          result.push({ type: 'separator', name: `bsep-${sepIdx++}` });
        }
        result.push(item);
        lastGroup = item.group;
      }
      bubbleDefaults.set(ctx, result);
    }

    // Resolve names helper
    const resolveNames = (names: string[]): BubbleMenuItem[] => {
      const result: BubbleMenuItem[] = [];
      let sepIdx = 0;
      for (const name of names) {
        if (name === '|') {
          result.push({ type: 'separator', name: `sep-${sepIdx++}` });
        } else {
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
        const markType = schema.marks?.[markName];
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
          if (state.selection.empty || state.selection.node) return false;
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

    const setItems = (newItems: BubbleMenuItem[]) => {
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

    const updateStates = (currentEd: Editor) => {
      let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
      try { canProxy = currentEd.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch { /* empty */ }

      for (const item of currentResolvedItems) {
        if (item.type === 'separator') continue;
        activeMapRef.set(item.name, ToolbarController.resolveActive(currentEd as never, item));
        try {
          const canCmd = canProxy?.[item.command];
          disabledMapRef.set(item.name, canCmd
            ? !(item.commandArgs?.length ? canCmd(...item.commandArgs) : canCmd())
            : false);
        } catch { disabledMapRef.set(item.name, false); }
      }
    };

    // Transaction handler
    const transactionHandler = () => {
      if (contexts) {
        updateContextItems(ed, contexts, detectContext, resolveNames, getFormatItems, filterBySchema, bubbleDefaults, setItems);
      }
      updateStates(ed);
      activeVersion.value++;
    };
    ed.on('transaction', transactionHandler);
    updateStates(ed);

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
  ) {
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

  const executeCommand = (item: ToolbarButton) => {
    const ed = editor.value;
    if (!ed) return;
    if (item.emitEvent) {
      (ed.emit as (e: string, d: unknown) => void)(item.emitEvent, {});
      return;
    }
    ToolbarController.executeItem(ed as never, item);
  };

  const getCachedIcon = (name: string): string => {
    return defaultIcons[name] ?? '';
  };

  return {
    menuRef,
    resolvedItems,
    isItemActive,
    isItemDisabled,
    executeCommand,
    activeVersion,
    getCachedIcon,
  };
}
