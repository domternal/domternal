import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { Editor, JSONContent } from '@domternal/core';
import { useDebouncedRef } from './utils.js';

/**
 * Full editor state returned when no selector is provided.
 */
export interface EditorState {
  htmlContent: Ref<string>;
  jsonContent: Ref<JSONContent | null>;
  isEmpty: Ref<boolean>;
  isFocused: Ref<boolean>;
  isEditable: Ref<boolean>;
}

/**
 * Subscribe to editor state changes.
 *
 * **Overload 1 - Full state:**
 * ```ts
 * const { htmlContent, isEmpty } = useEditorState(editor);
 * ```
 *
 * **Overload 2 - Selector (granular, avoids unnecessary re-renders):**
 * ```ts
 * const isBold = useEditorState(editor, (ed) => ed.isActive('bold'));
 * ```
 */
export function useEditorState(editor: ShallowRef<Editor | null>): EditorState;
export function useEditorState<T>(editor: ShallowRef<Editor | null>, selector: (editor: Editor) => T): ComputedRef<T | undefined>;
export function useEditorState<T>(
  editor: ShallowRef<Editor | null>,
  selector?: (editor: Editor) => T,
): EditorState | ComputedRef<T | undefined> {
  if (selector) {
    return useEditorStateSelector(editor, selector);
  }
  return useEditorStateFull(editor);
}

// --- Full state mode ---

function getFullState(ed: Editor | null) {
  if (!ed || ed.isDestroyed) {
    return { html: '', json: null as JSONContent | null, empty: true, focused: false, editable: true };
  }
  return {
    html: ed.getHTML(),
    json: ed.getJSON(),
    empty: ed.isEmpty,
    focused: ed.isFocused,
    editable: ed.isEditable,
  };
}

function useEditorStateFull(editor: ShallowRef<Editor | null>): EditorState {
  const initial = getFullState(editor.value);
  const htmlContent = ref(initial.html);
  const jsonContent = ref<JSONContent | null>(initial.json);
  const isEmpty = ref(initial.empty);
  const isFocused = ref(initial.focused);
  const isEditable = ref(initial.editable);

  watch(
    editor,
    (ed, _oldEd, onCleanup) => {
      if (!ed || ed.isDestroyed) {
        htmlContent.value = '';
        jsonContent.value = null;
        isEmpty.value = true;
        isFocused.value = false;
        isEditable.value = true;
        return;
      }

      // Set initial state
      const state = getFullState(ed);
      htmlContent.value = state.html;
      jsonContent.value = state.json;
      isEmpty.value = state.empty;
      isFocused.value = state.focused;
      isEditable.value = state.editable;

      const onTransaction = () => {
        const html = ed.getHTML();
        const json = ed.getJSON();
        const empty = ed.isEmpty;
        const editable = ed.isEditable;
        if (htmlContent.value !== html) htmlContent.value = html;
        if (isEmpty.value !== empty) isEmpty.value = empty;
        if (isEditable.value !== editable) isEditable.value = editable;
        jsonContent.value = json;
      };

      const onFocus = () => {
        if (!isFocused.value) isFocused.value = true;
      };

      const onBlur = () => {
        if (isFocused.value) isFocused.value = false;
      };

      ed.on('transaction', onTransaction);
      ed.on('focus', onFocus);
      ed.on('blur', onBlur);

      onCleanup(() => {
        ed.off('transaction', onTransaction);
        ed.off('focus', onFocus);
        ed.off('blur', onBlur);
      });
    },
    { immediate: true },
  );

  return { htmlContent, jsonContent, isEmpty, isFocused, isEditable };
}

// --- Selector mode ---

function useEditorStateSelector<T>(
  editor: ShallowRef<Editor | null>,
  selector: (editor: Editor) => T,
): ComputedRef<T | undefined> {
  const version = useDebouncedRef(0);

  watch(
    editor,
    (ed, _oldEd, onCleanup) => {
      if (!ed || ed.isDestroyed) return;

      const bump = () => { version.value++; };

      ed.on('transaction', bump);
      ed.on('focus', bump);
      ed.on('blur', bump);

      onCleanup(() => {
        ed.off('transaction', bump);
        ed.off('focus', bump);
        ed.off('blur', bump);
      });
    },
    { immediate: true },
  );

  return computed(() => {
    // Read version to create reactive dependency
    void version.value;
    const ed = editor.value;
    if (!ed || ed.isDestroyed) return undefined;
    return selector(ed);
  });
}
