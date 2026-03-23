import { useEffect, useRef, useState } from 'react';
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
  /** Set to false for SSR - delays editor creation to useEffect. @default true */
  immediatelyRender?: boolean;
  /** Output format for content comparison. @default 'html' */
  outputFormat?: 'html' | 'json';
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

export function useEditor(options: UseEditorOptions = {}) {
  const {
    extensions = [],
    content = '',
    editable = true,
    autofocus = false,
    // immediatelyRender reserved for future SSR support
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

  // Create editor
  useEffect(() => {
    if (!editorRef.current) return;

    const initialContent = pendingContentRef.current ?? content;
    pendingContentRef.current = null;

    const ed = new Editor({
      element: editorRef.current,
      extensions: [...DEFAULT_EXTENSIONS, ...extensions],
      content: initialContent,
      editable,
      autofocus,
    });

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

    instanceRef.current = ed;
    extensionsRef.current = extensions;
    setEditor(ed);
    callbacksRef.current.onCreate?.(ed);

    return () => {
      callbacksRef.current.onDestroy?.();
      // Save content for potential Strict Mode re-mount
      if (!ed.isDestroyed) {
        pendingContentRef.current = ed.getJSON();
        ed.destroy();
      }
      instanceRef.current = null;
      setEditor(null);
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
    const ed = instanceRef.current;
    if (!ed || ed.isDestroyed || !editorRef.current) return;
    // Skip initial render (handled by mount effect)
    if (extensions === extensionsRef.current) return;

    pendingContentRef.current = ed.getJSON();
    callbacksRef.current.onDestroy?.();
    ed.destroy();
    instanceRef.current = null;
    setEditor(null);

    const newEd = new Editor({
      element: editorRef.current,
      extensions: [...DEFAULT_EXTENSIONS, ...extensions],
      content: pendingContentRef.current,
      editable,
      autofocus: false,
    });
    pendingContentRef.current = null;

    newEd.on('transaction', ({ transaction }: TransactionEventProps) => {
      const cbs = callbacksRef.current;
      if (transaction.docChanged) {
        cbs.onUpdate?.({ editor: newEd });
      }
      if (!transaction.docChanged && transaction.selectionSet) {
        cbs.onSelectionChange?.({ editor: newEd });
      }
    });

    newEd.on('focus', ({ event }: FocusEventProps) => {
      callbacksRef.current.onFocus?.({ editor: newEd, event });
    });

    newEd.on('blur', ({ event }: FocusEventProps) => {
      callbacksRef.current.onBlur?.({ editor: newEd, event });
    });

    instanceRef.current = newEd;
    extensionsRef.current = extensions;
    setEditor(newEd);
    callbacksRef.current.onCreate?.(newEd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

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
