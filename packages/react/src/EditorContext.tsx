import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Editor } from '@domternal/core';

interface EditorContextValue {
  editor: Editor | null;
}

const EditorContext = createContext<EditorContextValue>({ editor: null });

export interface EditorProviderProps {
  /** The editor instance to provide to descendants. */
  editor: Editor | null;
  children: ReactNode;
}

/**
 * Provides an editor instance to all descendant components via React Context.
 *
 * Components like DomternalToolbar, DomternalBubbleMenu, DomternalFloatingMenu,
 * and DomternalEmojiPicker will automatically use this editor when no explicit
 * `editor` prop is passed.
 *
 * @example
 * ```tsx
 * const { editor } = useEditor({ extensions, content });
 *
 * <EditorProvider editor={editor}>
 *   <DomternalToolbar />
 *   <EditorContent editor={editor} />
 *   <DomternalBubbleMenu contexts={{ text: ['bold', 'italic'] }} />
 * </EditorProvider>
 * ```
 */
export function EditorProvider({ editor, children }: EditorProviderProps): ReactNode {
  const value = useMemo<EditorContextValue>(() => ({ editor }), [editor]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/**
 * Access the editor instance from the nearest EditorProvider.
 * Returns `{ editor: null }` when used outside a provider, no throw.
 */
export function useCurrentEditor(): EditorContextValue {
  return useContext(EditorContext);
}
