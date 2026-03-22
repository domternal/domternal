import { useEffect, useRef, useState } from 'react';
import {
  PluginKey,
  ToolbarController,
  createBubbleMenuPlugin,
  defaultIcons,
} from '@domternal/core';
import type { Editor, ToolbarButton, BubbleMenuOptions } from '@domternal/core';

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

// --- Hook ---

export interface UseBubbleMenuOptions {
  editor: Editor | null;
  shouldShow?: BubbleMenuOptions['shouldShow'];
  placement?: 'top' | 'bottom';
  offset?: number;
  updateDelay?: number;
  items?: string[];
  contexts?: Record<string, string[] | true | null>;
}

export function useBubbleMenu(options: UseBubbleMenuOptions) {
  const { editor, shouldShow, placement = 'top', offset = 8, updateDelay = 0, items, contexts } = options;

  const menuRef = useRef<HTMLDivElement>(null);
  const pluginKeyRef = useRef(new PluginKey('reactBubbleMenu-' + Math.random().toString(36).slice(2, 8)));
  const [resolvedItems, setResolvedItems] = useState<BubbleMenuItem[]>([]);
  const [activeVersion, setActiveVersion] = useState(0);

  const activeMapRef = useRef(new Map<string, boolean>());
  const disabledMapRef = useRef(new Map<string, boolean>());
  const itemMapRef = useRef(new Map<string, ToolbarButton>());
  const bubbleDefaultsRef = useRef(new Map<string, BubbleMenuItem[]>());

  useEffect(() => {
    if (!editor || editor.isDestroyed || !menuRef.current) return;

    // Build item map
    const itemMap = new Map<string, ToolbarButton>();
    for (const item of editor.toolbarItems) {
      if (item.type === 'button') {
        itemMap.set(item.name, item);
      } else if (item.type === 'dropdown') {
        for (const sub of item.items) {
          itemMap.set(sub.name, sub);
        }
      }
    }
    itemMapRef.current = itemMap;

    // Build bubble defaults
    const bubbleDefaults = new Map<string, BubbleMenuItem[]>();
    const byCtx = new Map<string, ToolbarButton[]>();
    const addItem = (btn: ToolbarButton) => {
      const ctx = (btn as unknown as Record<string, unknown>)['bubbleMenu'] as string | undefined;
      if (!ctx) return;
      let arr = byCtx.get(ctx);
      if (!arr) { arr = []; byCtx.set(ctx, arr); }
      arr.push(btn);
    };
    for (const item of editor.toolbarItems) {
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
    bubbleDefaultsRef.current = bubbleDefaults;

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
      const schema = (editor.state as unknown as { schema?: SchemaShape }).schema;
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
      pluginKey: pluginKeyRef.current,
      editor,
      element: menuRef.current,
      shouldShow: shouldShowFn,
      placement,
      offset,
      updateDelay,
    });
    editor.registerPlugin(plugin);

    // Set initial items
    if (contexts) {
      updateContextItems(editor, contexts, detectContext, resolveNames, getFormatItems, filterBySchema, bubbleDefaults);
    } else if (items) {
      setResolvedItems(resolveNames(items));
    } else {
      setResolvedItems(resolveNames(['bold', 'italic', 'underline']));
    }

    // Transaction handler
    const transactionHandler = () => {
      if (contexts) {
        updateContextItems(editor, contexts, detectContext, resolveNames, getFormatItems, filterBySchema, bubbleDefaults);
      }
      updateStates(editor);
      setActiveVersion(v => v + 1);
    };
    editor.on('transaction', transactionHandler);
    updateStates(editor);

    return () => {
      editor.off('transaction', transactionHandler);
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(pluginKeyRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function updateContextItems(
    ed: Editor,
    ctxs: Record<string, string[] | true | null>,
    detectContext: (sel: SelectionShape, c: Record<string, string[] | true | null>) => string | null,
    resolveNames: (names: string[]) => BubbleMenuItem[],
    getFormatItems: () => ToolbarButton[],
    filterBySchema: (ctx: string, items: ToolbarButton[]) => ToolbarButton[],
    defaults: Map<string, BubbleMenuItem[]>,
  ) {
    const ctx = detectContext(ed.state.selection as unknown as SelectionShape, ctxs);
    if (!ctx) { setResolvedItems([]); return; }

    if (ctx in ctxs) {
      const val = ctxs[ctx];
      if (val === null || (Array.isArray(val) && val.length === 0)) {
        setResolvedItems([]);
        return;
      }
      if (val === true) {
        setResolvedItems(filterBySchema(ctx, getFormatItems()));
      } else if (Array.isArray(val)) {
        const resolved = resolveNames(val);
        const buttons = resolved.filter((i): i is ToolbarButton => i.type !== 'separator');
        const filtered = new Set(filterBySchema(ctx, buttons).map(b => b.name));
        setResolvedItems(resolved.filter(i => i.type === 'separator' || filtered.has(i.name)));
      }
    } else {
      setResolvedItems(defaults.get(ctx) ?? []);
    }
  }

  function updateStates(ed: Editor) {
    let canProxy: Record<string, (...args: unknown[]) => boolean> | null = null;
    try { canProxy = ed.can() as unknown as Record<string, (...args: unknown[]) => boolean>; } catch {}

    for (const item of resolvedItems) {
      if (item.type === 'separator') continue;
      activeMapRef.current.set(item.name, ToolbarController.resolveActive(ed as never, item));
      try {
        const canCmd = canProxy?.[item.command];
        disabledMapRef.current.set(item.name, canCmd
          ? !(item.commandArgs?.length ? canCmd(...item.commandArgs) : canCmd())
          : false);
      } catch { disabledMapRef.current.set(item.name, false); }
    }
  }

  const isItemActive = (item: ToolbarButton): boolean => {
    void activeVersion;
    return activeMapRef.current.get(item.name) ?? false;
  };

  const isItemDisabled = (item: ToolbarButton): boolean => {
    void activeVersion;
    return disabledMapRef.current.get(item.name) ?? false;
  };

  const executeCommand = (item: ToolbarButton) => {
    if (!editor) return;
    if (item.emitEvent) {
      (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, {});
      return;
    }
    ToolbarController.executeItem(editor as never, item);
  };

  return {
    menuRef,
    resolvedItems,
    isItemActive,
    isItemDisabled,
    executeCommand,
    activeVersion,
    getCachedIcon: (name: string) => defaultIcons[name] ?? '',
  };
}
