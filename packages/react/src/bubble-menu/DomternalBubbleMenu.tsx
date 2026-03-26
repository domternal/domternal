import { useRef } from 'react';
import type { Editor, BubbleMenuOptions, ToolbarButton } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useBubbleMenu } from './useBubbleMenu.js';

export interface DomternalBubbleMenuProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom visibility function. */
  shouldShow?: BubbleMenuOptions['shouldShow'];
  /** Position relative to selection. @default 'top' */
  placement?: 'top' | 'bottom';
  /** Pixel offset from selection. @default 8 */
  offset?: number;
  /** Debounce delay in ms. @default 0 */
  updateDelay?: number;
  /** Fixed item names, e.g. ['bold', 'italic', 'code']. */
  items?: string[];
  /** Context-aware: map context names to item arrays, true for all, or null to disable. */
  contexts?: Record<string, string[] | true | null>;
  /** Additional content rendered after buttons. */
  children?: React.ReactNode;
}

export function DomternalBubbleMenu({
  editor: editorProp,
  shouldShow,
  placement,
  offset,
  updateDelay,
  items,
  contexts,
  children,
}: DomternalBubbleMenuProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const htmlCacheRef = useRef(new Map<string, string>());

  const {
    menuRef,
    resolvedItems,
    isItemActive,
    isItemDisabled,
    executeCommand,
    getCachedIcon,
  } = useBubbleMenu({
    editor,
    shouldShow,
    placement,
    offset,
    updateDelay,
    items,
    contexts,
  });

  const getCachedHtml = (name: string): string => {
    const cache = htmlCacheRef.current;
    const cached = cache.get(name);
    if (cached) return cached;
    const html = getCachedIcon(name);
    cache.set(name, html);
    return html;
  };

  return (
    <div ref={menuRef} className="dm-bubble-menu">
      {resolvedItems.map((item) => {
        if (item.type === 'separator') {
          return <span key={item.name} className="dm-toolbar-separator" />;
        }
        const btn = item as ToolbarButton;
        return (
          <button
            key={btn.name}
            type="button"
            className={`dm-toolbar-button${isItemActive(btn) ? ' dm-toolbar-button--active' : ''}`}
            disabled={isItemDisabled(btn)}
            title={btn.label}
            aria-label={btn.label}
            dangerouslySetInnerHTML={{ __html: getCachedHtml(btn.icon) }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand(btn)}
          />
        );
      })}
      {children}
    </div>
  );
}
