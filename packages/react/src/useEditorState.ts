import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  const modeRef = useRef<boolean | null>(null);
  modeRef.current ??= isSelectorMode;
  if (modeRef.current !== isSelectorMode) {
    throw new Error('useEditorState selector mode must remain stable for a component instance.');
  }

  if (typeof selector === 'function') {
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
  const store = useMemo(() => createEditorStore(editor), [editor]);
  const getSnapshot = useMemo(() => {
    let previous: EditorSnapshot | null | undefined;
    let selected: T | undefined;
    return (): T | undefined => {
      const snapshot = store.getSnapshot();
      if (snapshot !== previous) {
        previous = snapshot;
        selected = snapshot ? selector(snapshot.editor) : undefined;
      }
      return selected;
    };
  }, [store, selector]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

interface EditorSnapshot {
  editor: Editor;
  state: Editor['state'];
  focused: boolean;
  editable: boolean;
}

/** Cache the source separately from each selector, including allocating selectors. */
function createEditorStore(editor: Editor | null): {
  getSnapshot: () => EditorSnapshot | null;
  subscribe: (callback: () => void) => () => void;
} {
  let snapshot: EditorSnapshot | null | undefined;
  let destroyed = false;
  const listeners = new Set<() => void>();

  const getSnapshot = (): EditorSnapshot | null => {
    if (!editor || destroyed || editor.isDestroyed) return null;
    const state = editor.state;
    const focused = editor.isFocused;
    const editable = editor.isEditable;
    // Read live values as well as events to cover changes before subscription.
    if (snapshot?.state !== state
      || snapshot.focused !== focused || snapshot.editable !== editable) {
      snapshot = { editor, state, focused, editable };
    }
    return snapshot;
  };

  const notify = (): void => {
    // An event may change mutable extension storage without replacing state.
    snapshot = undefined;
    listeners.forEach(listener => { listener(); });
  };
  const onDestroy = (): void => {
    // The destroy event runs before Editor.isDestroyed changes.
    destroyed = true;
    notify();
  };

  return {
    getSnapshot,
    subscribe(callback) {
      if (!editor || destroyed || editor.isDestroyed) return () => { /* noop */ };
      listeners.add(callback);
      if (listeners.size === 1) {
        editor.on('transaction', notify);
        editor.on('focus', notify);
        editor.on('blur', notify);
        editor.on('destroy', onDestroy);
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0) {
          editor.off('transaction', notify);
          editor.off('focus', notify);
          editor.off('blur', notify);
          editor.off('destroy', onDestroy);
        }
      };
    },
  };
}
