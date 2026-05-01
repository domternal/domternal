import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  PluginKey,
  FloatingMenuController,
  defaultIcons,
} from '@domternal/core';
import type {
  Editor,
  FloatingMenuItem,
  FloatingMenuItemsOverride,
  IconSet,
} from '@domternal/core';
import { createFloatingMenuPlugin } from '@domternal/extension-block-menu';
import type {
  FloatingMenuKeymap,
  FloatingMenuOptions,
} from '@domternal/extension-block-menu';
import { useCurrentEditor } from './EditorContext.js';

export interface DomternalFloatingMenuProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom visibility predicate. */
  shouldShow?: FloatingMenuOptions['shouldShow'];
  /** Pixel offset from trigger anchor. @default 0 */
  offset?: number;
  /** Items override (array replaces defaults; function transforms them). */
  items?: FloatingMenuItemsOverride;
  /** Keyboard shortcuts for entering the menu via keyboard. */
  keymap?: FloatingMenuKeymap;
  /** Custom icon set (falls back to `@domternal/core`'s `defaultIcons`). */
  icons?: IconSet;
  /**
   * Optional custom content. When provided, the default grouped-item
   * rendering is skipped and children are rendered inside the menu element.
   */
  children?: ReactNode;
}

/**
 * Block-insert floating menu. Renders defaults collected from the editor's
 * extensions via `addFloatingMenuItems()`; pass `items` to override or
 * `children` to render a fully custom UI.
 */
export function DomternalFloatingMenu({
  editor: editorProp,
  shouldShow,
  offset = 0,
  items,
  keymap,
  icons,
  children,
}: DomternalFloatingMenuProps): ReactNode {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const menuRef = useRef<HTMLDivElement>(null);
  const pluginKeyRef = useRef(
    new PluginKey('reactFloatingMenu-' + Math.random().toString(36).slice(2, 8)),
  );

  // Refs so the effect below can read current prop values without re-running.
  const shouldShowRef = useRef(shouldShow);
  shouldShowRef.current = shouldShow;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;

  // Register the ProseMirror plugin (visibility + positioning + dismiss).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !menuRef.current) return;
    const pluginKey = pluginKeyRef.current;
    const plugin = createFloatingMenuPlugin({
      pluginKey,
      editor,
      element: menuRef.current,
      ...(shouldShowRef.current && { shouldShow: shouldShowRef.current }),
      offset: offsetRef.current,
      ...(keymapRef.current && { keymap: keymapRef.current }),
    });
    editor.registerPlugin(plugin);
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(pluginKey);
    };
  }, [editor]);

  // === Default rendering mode ===
  // When consumer provides children we skip the controller entirely and
  // render whatever they passed. Otherwise we collect items via the
  // controller and render a WAI-ARIA menu with roving-tabindex keyboard nav.
  const useDefaultRender = !children;

  // Subscribe to controller state changes via a version counter. Using
  // useState bump (instead of useSyncExternalStore) keeps this compatible
  // with React concurrent mode while avoiding extra adapter code.
  const [, bump] = useState(0);
  const forceRender = useCallback((): void => { bump((v) => v + 1); }, []);

  const controllerRef = useRef<FloatingMenuController | null>(null);

  useEffect(() => {
    if (!useDefaultRender || !editor || editor.isDestroyed) {
      controllerRef.current = null;
      return;
    }
    const controller = new FloatingMenuController(editor, forceRender, items);
    controller.subscribe();
    controllerRef.current = controller;
    // Controller is stored on a ref (not state) — React won't re-render on
    // that assignment, so trigger a bump so the next render reads the newly
    // available groups/focusedIndex.
    forceRender();
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [editor, useDefaultRender, items, forceRender]);

  const controller = controllerRef.current;
  const groups = useMemo(() => controller?.groups ?? [], [controller]);
  const focusedIndex = controller?.focusedIndex ?? -1;

  // Imperative focus management: whenever focusedIndex changes and is in
  // range, focus the matching DOM button. This is the roving-tabindex
  // "accessible focus" pattern used by the WAI-ARIA menu spec.
  useLayoutEffect(() => {
    if (focusedIndex < 0 || !menuRef.current) return;
    const target = menuRef.current.querySelector<HTMLElement>(
      `[data-floating-menu-index="${String(focusedIndex)}"]`,
    );
    target?.focus();
  }, [focusedIndex]);

  // Resolve an icon name to SVG string; consumer-provided icon set wins.
  const resolveIcon = useCallback((name?: string): string => {
    if (!name) return '';
    return icons?.[name] ?? defaultIcons[name] ?? '';
  }, [icons]);

  const onItemClick = useCallback((item: FloatingMenuItem): void => {
    if (!editor || !controllerRef.current) return;
    controllerRef.current.execute(item);
    // Return focus to the editor so selection/cursor remain where expected.
    requestAnimationFrame(() => { editor.view.focus(); });
  }, [editor]);

  const onMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const ctl = controllerRef.current;
    if (!ctl) return;
    const focused = ctl.focusedItem();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        ctl.next();
        return;
      case 'ArrowUp':
        e.preventDefault();
        ctl.prev();
        return;
      case 'Home':
        e.preventDefault();
        ctl.first();
        return;
      case 'End':
        e.preventDefault();
        ctl.last();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        ctl.leaveMenu();
        if (editor) editor.view.focus();
        return;
      case 'Enter':
      case ' ':
        if (focused) {
          e.preventDefault();
          onItemClick(focused);
        }
        return;
      default:
        return;
    }
  }, [editor, onItemClick]);

  // Flatten once per render so child item renders can derive their flat index.
  const flatNames = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => i.name)),
    [groups],
  );

  if (!editor && !useDefaultRender) return null;

  return (
    <div
      ref={menuRef}
      className="dm-floating-menu"
      role="menu"
      aria-label="Insert block"
      data-dm-editor-ui=""
      onKeyDown={useDefaultRender ? onMenuKeyDown : undefined}
    >
      {useDefaultRender
        ? groups.map((group, gi) => (
          <Fragment key={group.name || `__group-${String(gi)}`}>
            {group.name && (
              <div className="dm-floating-menu-group-label" id={`dm-fm-g${String(gi)}`}>
                {group.name}
              </div>
            )}
            <div
              className="dm-floating-menu-group"
              role="group"
              {...(group.name && { 'aria-labelledby': `dm-fm-g${String(gi)}` })}
            >
              {group.items.map((item) => {
                const flatIndex = flatNames.indexOf(item.name);
                const isFocused = flatIndex === focusedIndex;
                const disabled = controller?.isDisabled(item) ?? false;
                return (
                  <FloatingMenuItemButton
                    key={item.name}
                    item={item}
                    flatIndex={flatIndex}
                    tabIndex={isFocused || (focusedIndex < 0 && flatIndex === 0) ? 0 : -1}
                    disabled={disabled}
                    iconHtml={resolveIcon(item.icon)}
                    onClick={onItemClick}
                  />
                );
              })}
            </div>
          </Fragment>
        ))
        : children}
    </div>
  );
}

interface ItemButtonProps {
  item: FloatingMenuItem;
  flatIndex: number;
  tabIndex: 0 | -1;
  disabled: boolean;
  iconHtml: string;
  onClick: (item: FloatingMenuItem) => void;
}

function FloatingMenuItemButton({
  item,
  flatIndex,
  tabIndex,
  disabled,
  iconHtml,
  onClick,
}: ItemButtonProps): ReactNode {
  const handleClick = useCallback((): void => { onClick(item); }, [item, onClick]);
  // Prevent mousedown from stealing editor focus before we run the command.
  const onMouseDown = useCallback((e: ReactMouseEvent): void => {
    e.preventDefault();
  }, []);

  return (
    <button
      type="button"
      role="menuitem"
      className="dm-floating-menu-item"
      data-floating-menu-item={item.name}
      data-floating-menu-index={String(flatIndex)}
      tabIndex={tabIndex}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={item.shortcut}
      disabled={disabled}
      onClick={handleClick}
      onMouseDown={onMouseDown}
    >
      {iconHtml && (
        <span
          className="dm-floating-menu-item-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconHtml }}
        />
      )}
      <span className="dm-floating-menu-item-label">{item.label}</span>
      {item.shortcut && (
        <span className="dm-floating-menu-item-shortcut" aria-hidden="true">
          {item.shortcut}
        </span>
      )}
    </button>
  );
}
