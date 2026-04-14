import { type DependencyList, useEffect, useRef, useState } from 'react';
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
   * Set to false to delay editor creation to useEffect (SSR-safe).
   * When false, the editor will be null during server-side rendering
   * and created only after the component mounts in the browser.
   * @default true
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
 * Core hook for creating and managing a Domternal editor instance.
 *
 * @param options - Editor configuration
 * @param deps - Optional dependency array. When any value changes, the editor
 *   is destroyed and recreated (content is preserved). Useful for dynamic
 *   configuration that requires a full editor rebuild.
 *
 * @example
 * ```tsx
 * const { editor, editorRef } = useEditor({ extensions, content });
 * return <div className="dm-editor"><div ref={editorRef} /></div>;
 * ```
 *
 * @example SSR-safe usage (Next.js)
 * ```tsx
 * const { editor, editorRef } = useEditor({
 *   extensions,
 *   content,
 *   immediatelyRender: false,
 * });
 * ```
 *
 * @example With deps for forced recreation
 * ```tsx
 * const { editor, editorRef } = useEditor({ extensions, content }, [locale]);
 * // Editor is recreated when locale changes
 * ```
 */
export function useEditor(options: UseEditorOptions = {}, deps?: DependencyList) {
  const {
    extensions = [],
    content = '',
    editable = true,
    autofocus = false,
    outputFormat = 'html',
  } = options;

  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<Editor | null>(null);
  const pendingContentRef = useRef<Content | null>(null);

  // Store latest callbacks in refs to avoid stale closures
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Store latest content/format for comparison
  const contentRef = useRef(content);
  contentRef.current = content;
  const formatRef = useRef(outputFormat);
  formatRef.current = outputFormat;

  // Track extensions reference for recreation
  const extensionsRef = useRef(extensions);

  // Track deps for recreation
  const depsRef = useRef(deps);

  /** Wire transaction, focus, blur event handlers to an editor instance. */
  function wireEvents(ed: Editor) {
    ed.on('transaction', ({ transaction }: TransactionEventProps) => {
      const cbs = callbacksRef.current;
      if (transaction.docChanged) {
        cbs.onUpdate?.({ editor: ed });
      }
      if (!transaction.docChanged && transaction.selectionSet) {
        cbs.onSelectionChange?.({ editor: ed });
      }
    });

    ed.on('focus', ({ event }: FocusEventProps) => {
      callbacksRef.current.onFocus?.({ editor: ed, event });
    });

    ed.on('blur', ({ event }: FocusEventProps) => {
      callbacksRef.current.onBlur?.({ editor: ed, event });
    });
  }

  /** Create editor and wire events. Returns the new instance. */
  function createEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition) {
    const ed = new Editor({
      element,
      extensions: [...DEFAULT_EXTENSIONS, ...extensions],
      content: initialContent,
      editable,
      autofocus: focus,
    });

    wireEvents(ed);
    instanceRef.current = ed;
    extensionsRef.current = extensions;
    depsRef.current = deps;
    setEditor(ed);
    callbacksRef.current.onCreate?.(ed);
    return ed;
  }

  /** Destroy current editor, preserving content for recreation. */
  function destroyCurrentEditor() {
    const current = instanceRef.current;
    if (current && !current.isDestroyed) {
      pendingContentRef.current = current.getJSON();
      callbacksRef.current.onDestroy?.();
      current.destroy();
    }
    instanceRef.current = null;
    setEditor(null);
  }

  // Create editor on mount
  useEffect(() => {
    // Use the ref element if available, otherwise create a detached div
    // (composable pattern: Domternal.Content will adopt the DOM later)
    const element = editorRef.current ?? document.createElement('div');

    const initialContent = pendingContentRef.current ?? content;
    pendingContentRef.current = null;

    createEditorInstance(element, initialContent, autofocus);

    return () => {
      destroyCurrentEditor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync editable
  useEffect(() => {
    if (instanceRef.current && !instanceRef.current.isDestroyed) {
      instanceRef.current.setEditable(editable);
    }
  }, [editable]);

  // Recreate editor when extensions change
  useEffect(() => {
    if (!instanceRef.current || instanceRef.current.isDestroyed) return;
    if (extensions === extensionsRef.current) return;

    const element = instanceRef.current.view.dom.parentElement ?? document.createElement('div');
    destroyCurrentEditor();
    const initialContent = pendingContentRef.current ?? '';
    pendingContentRef.current = null;
    createEditorInstance(element, initialContent, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  // Recreate editor when deps change
  useEffect(() => {
    if (!deps || !instanceRef.current || instanceRef.current.isDestroyed) return;
    // Skip if deps haven't actually changed (initial render)
    if (depsRef.current === deps) return;
    if (depsRef.current && deps.length === depsRef.current.length &&
        deps.every((d, i) => d === depsRef.current![i])) return;

    const element = instanceRef.current.view.dom.parentElement ?? document.createElement('div');
    destroyCurrentEditor();
    const initialContent = pendingContentRef.current ?? '';
    pendingContentRef.current = null;
    createEditorInstance(element, initialContent, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);

  // Sync content from outside
  useEffect(() => {
    const ed = instanceRef.current;
    if (!ed || ed.isDestroyed) return;

    const format = formatRef.current;
    if (format === 'html') {
      if (content !== ed.getHTML()) {
        ed.setContent(content, false);
      }
    } else {
      if (JSON.stringify(content) !== JSON.stringify(ed.getJSON())) {
        ed.setContent(content, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  return { editor, editorRef };
}
