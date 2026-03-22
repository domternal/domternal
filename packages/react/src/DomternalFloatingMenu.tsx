import { useEffect, useRef } from 'react';
import { PluginKey, createFloatingMenuPlugin } from '@domternal/core';
import type { Editor, FloatingMenuOptions } from '@domternal/core';
import { useCurrentEditor } from './EditorContext.js';

export interface DomternalFloatingMenuProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom visibility function. */
  shouldShow?: FloatingMenuOptions['shouldShow'];
  /** Pixel offset from trigger. @default 0 */
  offset?: number;
  /** Content to render inside the floating menu. */
  children?: React.ReactNode;
}

export function DomternalFloatingMenu({
  editor: editorProp,
  shouldShow,
  offset = 0,
  children,
}: DomternalFloatingMenuProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const menuRef = useRef<HTMLDivElement>(null);
  const pluginKeyRef = useRef(
    new PluginKey('reactFloatingMenu-' + Math.random().toString(36).slice(2, 8)),
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed || !menuRef.current) return;

    const plugin = createFloatingMenuPlugin({
      pluginKey: pluginKeyRef.current,
      editor,
      element: menuRef.current,
      ...(shouldShow && { shouldShow }),
      offset,
    });
    editor.registerPlugin(plugin);

    return () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(pluginKeyRef.current);
      }
    };
  }, [editor, shouldShow, offset]);

  return (
    <div ref={menuRef} className="dm-floating-menu">
      {children}
    </div>
  );
}
