import { useEffect, useRef, type DependencyList, type ReactNode } from 'react';
import { useEditor, type UseEditorOptions } from './useEditor.js';
import { EditorProvider, useCurrentEditor } from './EditorContext.js';
import { DomternalToolbar, type DomternalToolbarProps } from './toolbar/DomternalToolbar.js';
import { DomternalBubbleMenu, type DomternalBubbleMenuProps } from './bubble-menu/DomternalBubbleMenu.js';
import { DomternalFloatingMenu, type DomternalFloatingMenuProps } from './DomternalFloatingMenu.js';
import { DomternalEmojiPicker, type DomternalEmojiPickerProps } from './emoji-picker/DomternalEmojiPicker.js';

// --- Root component ---

export interface DomternalProps extends UseEditorOptions {
  /** Optional dependency array for forced editor recreation. */
  deps?: DependencyList;
  children: ReactNode;
}

/**
 * Composable root component that creates an editor and provides it to all
 * subcomponents via context. No need to pass `editor` prop to children.
 *
 * @example
 * ```tsx
 * <Domternal extensions={[Bold, Italic]} content="<p>Hello</p>">
 *   <Domternal.Toolbar />
 *   <Domternal.Content />
 *   <Domternal.BubbleMenu contexts={{ text: ['bold', 'italic'] }} />
 *   <Domternal.EmojiPicker emojis={emojis} />
 * </Domternal>
 * ```
 *
 * @example SSR-safe with loading state
 * ```tsx
 * <Domternal extensions={extensions} immediatelyRender={false}>
 *   <Domternal.Loading>Loading editor...</Domternal.Loading>
 *   <Domternal.Toolbar />
 *   <Domternal.Content />
 * </Domternal>
 * ```
 */
export function Domternal({ children, deps, ...options }: DomternalProps) {
  const { editor } = useEditor(options, deps);

  return (
    <EditorProvider editor={editor}>
      {children}
    </EditorProvider>
  );
}

// --- Subcomponents ---

/** Renders the editor content area. Mounts the editor view DOM from context. */
function DomternalContent({ className }: { className?: string }) {
  const { editor } = useCurrentEditor();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor || editor.isDestroyed) return;

    const editorDom = editor.view.dom;
    if (editorDom.parentElement !== container) {
      container.appendChild(editorDom);
    }
  }, [editor]);

  const classes = className ? `dm-editor ${className}` : 'dm-editor';

  return (
    <div className={classes}>
      <div ref={containerRef} />
    </div>
  );
}

/** Renders children only while editor is not yet ready (SSR loading state). */
function DomternalLoading({ children }: { children: ReactNode }) {
  const { editor } = useCurrentEditor();
  if (editor) return null;
  return <>{children}</>;
}

/** Toolbar subcomponent. Uses editor from context automatically. */
function DomternalToolbarSub(props: Omit<DomternalToolbarProps, 'editor'>) {
  return <DomternalToolbar {...props} />;
}

/** BubbleMenu subcomponent. Uses editor from context automatically. */
function DomternalBubbleMenuSub(props: Omit<DomternalBubbleMenuProps, 'editor'>) {
  return <DomternalBubbleMenu {...props} />;
}

/** FloatingMenu subcomponent. Uses editor from context automatically. */
function DomternalFloatingMenuSub(props: Omit<DomternalFloatingMenuProps, 'editor'>) {
  return <DomternalFloatingMenu {...props} />;
}

/** EmojiPicker subcomponent. Uses editor from context automatically. */
function DomternalEmojiPickerSub(props: Omit<DomternalEmojiPickerProps, 'editor'>) {
  return <DomternalEmojiPicker {...props} />;
}

// --- Attach subcomponents ---

DomternalContent.displayName = 'Domternal.Content';
DomternalLoading.displayName = 'Domternal.Loading';
DomternalToolbarSub.displayName = 'Domternal.Toolbar';
DomternalBubbleMenuSub.displayName = 'Domternal.BubbleMenu';
DomternalFloatingMenuSub.displayName = 'Domternal.FloatingMenu';
DomternalEmojiPickerSub.displayName = 'Domternal.EmojiPicker';

Domternal.Content = DomternalContent;
Domternal.Loading = DomternalLoading;
Domternal.Toolbar = DomternalToolbarSub;
Domternal.BubbleMenu = DomternalBubbleMenuSub;
Domternal.FloatingMenu = DomternalFloatingMenuSub;
Domternal.EmojiPicker = DomternalEmojiPickerSub;
