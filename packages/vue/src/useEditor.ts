import { markRaw, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import {
  Editor,
  Document,
  Paragraph,
  Text,
  BaseKeymap,
  History,
} from '@domternal/core';
import type { Content, AnyExtension, FocusPosition, TransactionEventProps, FocusEventProps } from '@domternal/core';

export const DEFAULT_EXTENSIONS: AnyExtension[] = [Document, Paragraph, Text, BaseKeymap, History];

export interface UseEditorOptions {
  /** Custom extensions to add to the editor. */
  extensions?: AnyExtension[];
  /** Initial editor content (HTML string or JSON). */
  content?: Content;
  /** Whether the editor is editable. @default true */
  editable?: boolean;
  /** Where to autofocus on mount. @default false */
  autofocus?: FocusPosition;
  /** Output format for content comparison. @default 'html' */
  outputFormat?: 'html' | 'json';
  /**
   * Set to true to create the editor synchronously during setup instead of
   * waiting for onMounted. Only useful when SSR is not a concern.
   * @default false
   */
  immediatelyRender?: boolean;
  /** Called when the editor instance is created. */
  onCreate?: (editor: Editor) => void;
  /** Called when the document content changes. */
  onUpdate?: (props: { editor: Editor }) => void;
  /** Called when the selection changes without content change. */
  onSelectionChange?: (props: { editor: Editor }) => void;
  /** Called when the editor gains focus. */
  onFocus?: (props: { editor: Editor; event: FocusEvent }) => void;
  /** Called when the editor loses focus. */
  onBlur?: (props: { editor: Editor; event: FocusEvent }) => void;
  /** Called before the editor is destroyed. */
  onDestroy?: () => void;
}

/**
 * Core composable for creating and managing a Domternal editor instance.
 *
 * @example
 * ```ts
 * const { editor, editorRef } = useEditor({ extensions, content });
 * ```
 *
 * @example SSR-safe (default in Vue - onMounted never runs on server)
 * ```ts
 * const { editor, editorRef } = useEditor({ extensions, content });
 * // editor.value is null until onMounted
 * ```
 */
export function useEditor(options: UseEditorOptions = {}): {
  editor: ShallowRef<Editor | null>;
  editorRef: Ref<HTMLDivElement | undefined>;
} {
  const editor = shallowRef<Editor | null>(null);
  const editorRef = ref<HTMLDivElement>();
  let pendingContent: Content | null = null;

  function wireEvents(ed: Editor) {
    ed.on('transaction', ({ transaction }: TransactionEventProps) => {
      if (transaction.docChanged) {
        options.onUpdate?.({ editor: ed });
      }
      if (!transaction.docChanged && transaction.selectionSet) {
        options.onSelectionChange?.({ editor: ed });
      }
    });

    ed.on('focus', ({ event }: FocusEventProps) => {
      options.onFocus?.({ editor: ed, event });
    });

    ed.on('blur', ({ event }: FocusEventProps) => {
      options.onBlur?.({ editor: ed, event });
    });
  }

  function createEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition) {
    const extensions = options.extensions ?? [];
    const editable = options.editable ?? true;

    const ed = new Editor({
      element,
      extensions: [...DEFAULT_EXTENSIONS, ...extensions],
      content: initialContent,
      editable,
      autofocus: focus,
    });

    markRaw(ed);
    wireEvents(ed);
    editor.value = ed;
    options.onCreate?.(ed);
    return ed;
  }

  function destroyCurrentEditor() {
    const current = editor.value;
    if (current && !current.isDestroyed) {
      pendingContent = current.getJSON();
      options.onDestroy?.();

      // Clone editor DOM before destroy to prevent content flash during
      // unmount transitions. Insert clone before original, then destroy.
      const dom = current.view.dom;
      const parent = dom?.parentNode;
      if (parent) {
        const clone = dom.cloneNode(true) as HTMLElement;
        clone.style.pointerEvents = 'none';
        parent.insertBefore(clone, dom);
      }

      current.destroy();
    }
    editor.value = null;
  }

  if (options.immediatelyRender) {
    const element = document.createElement('div');
    createEditorInstance(element, options.content ?? '', options.autofocus ?? false);
  }

  onMounted(() => {
    if (editor.value) return; // Already created via immediatelyRender

    const element = editorRef.value ?? document.createElement('div');
    const initialContent = pendingContent ?? options.content ?? '';
    pendingContent = null;
    createEditorInstance(element, initialContent, options.autofocus ?? false);
  });

  onScopeDispose(() => {
    destroyCurrentEditor();
  });

  // Sync editable - watch options object property, not destructured primitive
  watch(
    () => options.editable ?? true,
    (newEditable) => {
      const ed = editor.value;
      if (ed && !ed.isDestroyed) {
        ed.setEditable(newEditable);
      }
    },
  );

  // Recreate editor when extensions array reference changes
  watch(
    () => options.extensions,
    (newExtensions, oldExtensions) => {
      if (!editor.value || editor.value.isDestroyed) return;
      if (newExtensions === oldExtensions) return;

      const element = editor.value.view.dom.parentElement ?? document.createElement('div');
      destroyCurrentEditor();
      const initialContent = pendingContent ?? '';
      pendingContent = null;
      createEditorInstance(element, initialContent, false);
    },
  );

  // Sync content from outside
  watch(
    () => options.content,
    (newContent) => {
      const ed = editor.value;
      if (!ed || ed.isDestroyed || newContent === undefined) return;

      const outputFormat = options.outputFormat ?? 'html';
      if (outputFormat === 'html') {
        if (newContent !== ed.getHTML()) {
          ed.setContent(newContent, false);
        }
      } else {
        if (JSON.stringify(newContent) !== JSON.stringify(ed.getJSON())) {
          ed.setContent(newContent, false);
        }
      }
    },
    { flush: 'post' },
  );

  return { editor, editorRef };
}
