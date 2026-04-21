import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor, JSONContent } from '@domternal/core';

/**
 * Full editor state returned when no selector is provided.
 */
export interface EditorState {
  htmlContent: string;
  jsonContent: JSONContent | null;
  isEmpty: boolean;
  isFocused: boolean;
  isEditable: boolean;
}

/**
 * Subscribe to editor state changes.
 *
 * **Overload 1 - Full state:**
 * ```tsx
 * const { htmlContent, isEmpty } = useEditorState(editor);
 * ```
 *
 * **Overload 2 - Selector (granular, avoids unnecessary re-renders):**
 * ```tsx
 * const isBold = useEditorState(editor, (ed) => ed.isActive('bold'));
 * ```
 */
export function useEditorState(editor: Editor | null): EditorState;
export function useEditorState<T>(editor: Editor | null, selector: (editor: Editor) => T): T | undefined;
export function useEditorState<T>(
  editor: Editor | null,
  selector?: (editor: Editor) => T,
): EditorState | T | undefined {
  // Runtime guard: selector presence must remain stable across renders for a
  // given call site. Switching modes would shift inner hook counts and corrupt
  // React's hook ordering. The guard below throws a clear error before that
  // corruption happens, instead of relying solely on the ESLint comment below.
  const isSelectorMode = typeof selector === 'function';
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const modeRef = useRef<boolean | null>(null);
  modeRef.current ??= isSelectorMode;
  if (modeRef.current !== isSelectorMode) {
    throw new Error('useEditorState selector mode must remain stable for a component instance.');
  }

  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useEditorStateSelector(editor, selector);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useEditorStateFull(editor);
}

// --- Full state mode ---

function useEditorStateFull(editor: Editor | null): EditorState {
  const [state, setState] = useState<EditorState>(() => getFullState(editor));

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setState(getFullState(null));
      return;
    }

    // Set initial state
    setState(getFullState(editor));

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      setState(prev => {
        if (!transaction.docChanged) {
          const editable = editor.isEditable;
          if (prev.isEditable === editable) return prev;
          return { ...prev, isEditable: editable };
        }
        const html = editor.getHTML();
        const json = editor.getJSON();
        const empty = editor.isEmpty;
        const editable = editor.isEditable;
        if (prev.htmlContent === html && prev.isEmpty === empty && prev.isEditable === editable) return prev;
        return { ...prev, htmlContent: html, jsonContent: json, isEmpty: empty, isEditable: editable };
      });
    };

    const onFocus = (): void => {
      setState(prev => prev.isFocused ? prev : { ...prev, isFocused: true });
    };

    const onBlur = (): void => {
      setState(prev => !prev.isFocused ? prev : { ...prev, isFocused: false });
    };

    editor.on('transaction', onTransaction);
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);

    return () => {
      editor.off('transaction', onTransaction);
      editor.off('focus', onFocus);
      editor.off('blur', onBlur);
    };
  }, [editor]);

  return state;
}

function getFullState(editor: Editor | null): EditorState {
  if (!editor || editor.isDestroyed) {
    return { htmlContent: '', jsonContent: null, isEmpty: true, isFocused: false, isEditable: true };
  }
  return {
    htmlContent: editor.getHTML(),
    jsonContent: editor.getJSON(),
    isEmpty: editor.isEmpty,
    isFocused: editor.isFocused,
    isEditable: editor.isEditable,
  };
}

// --- Selector mode (useSyncExternalStore) ---

function useEditorStateSelector<T>(editor: Editor | null, selector: (editor: Editor) => T): T | undefined {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback(
    (callback: () => void): (() => void) => {
      if (!editor || editor.isDestroyed) return () => { /* noop */ };

      editor.on('transaction', callback);
      editor.on('focus', callback);
      editor.on('blur', callback);

      return (): void => {
        editor.off('transaction', callback);
        editor.off('focus', callback);
        editor.off('blur', callback);
      };
    },
    [editor],
  );

  const getSnapshot = useCallback((): T | undefined => {
    if (!editor || editor.isDestroyed) return undefined;
    return selectorRef.current(editor);
  }, [editor]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
