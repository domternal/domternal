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
   * Create the editor synchronously during the first render so `editor`
   * is available immediately, with no null flash on first paint. The view
   * starts in a detached element and is adopted into the mount point by
   * the mount effect. Client-only: the default defers creation to a mount
   * effect, which never runs during server-side rendering.
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
 * @example Editor available on the very first render (client-only apps)
 * ```tsx
 * const { editor, editorRef } = useEditor({
 *   extensions,
 *   content,
 *   immediatelyRender: true,
 * });
 * ```
 *
 * @example With deps for forced recreation
 * ```tsx
 * const { editor, editorRef } = useEditor({ extensions, content }, [locale]);
 * // Editor is recreated when locale changes
 * ```
 */
export interface UseEditorResult {
  editor: Editor | null;
  editorRef: React.RefObject<HTMLDivElement | null>;
}

export function useEditor(options: UseEditorOptions = {}, deps?: DependencyList): UseEditorResult {
  const {
    extensions = [],
    content = '',
    editable = true,
    autofocus = false,
    outputFormat = 'html',
    immediatelyRender = false,
  } = options;

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
  function wireEvents(ed: Editor): void {
    ed.on('transaction', ({ transaction }: TransactionEventProps) => {
      const cbs = callbacksRef.current;
      // Mirror core's `update` event: skip programmatic writes (setContent(content, false))
      // that set skipUpdate, so onUpdate never echoes a silent content sync.
      if (transaction.docChanged && !transaction.getMeta('skipUpdate')) {
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

  /** Construct an editor, wire events, and register it in refs. */
  function buildEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition): Editor {
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
    return ed;
  }

  /** Create editor, publish it to state, and announce creation. */
  function createEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition): Editor {
    const ed = buildEditorInstance(element, initialContent, focus);
    setEditor(ed);
    callbacksRef.current.onCreate?.(ed);
    return ed;
  }

  /** Destroy current editor, preserving content for recreation. */
  function destroyCurrentEditor(): void {
    const current = instanceRef.current;
    if (current && !current.isDestroyed) {
      pendingContentRef.current = current.getJSON();
      callbacksRef.current.onDestroy?.();
      current.destroy();
    }
    instanceRef.current = null;
    setEditor(null);
  }

  // With immediatelyRender, the editor is constructed during the first
  // render so consumers never see a null editor. The ref mount point is not
  // attached yet at that moment, so the view starts in a detached element;
  // the mount effect adopts it. Core schedules autofocus on a macrotask,
  // which fires after that adoption, so autofocus still lands in the DOM.
  const [editor, setEditor] = useState<Editor | null>(() => {
    if (!immediatelyRender) return null;
    if (typeof window === 'undefined') {
      throw new Error(
        '[@domternal/react] immediatelyRender: true creates the editor during render, '
        + 'which cannot work during server-side rendering. Remove the option for SSR; '
        + 'the editor is then created after mount.',
      );
    }
    // StrictMode double-invokes this initializer on mount; the ref object is
    // shared between the two render passes, so reuse the first instance
    // instead of building (and leaking) a second one.
    if (instanceRef.current && !instanceRef.current.isDestroyed) {
      return instanceRef.current;
    }
    return buildEditorInstance(document.createElement('div'), content, autofocus);
  });

  // Create editor on mount (or adopt the render-created one)
  useEffect(() => {
    const existing = instanceRef.current;
    if (existing && !existing.isDestroyed) {
      // immediatelyRender path: the editor already exists from the first
      // render. Adopt its DOM into the ref mount point if the consumer
      // attached one (composable consumers adopt via Domternal.Content or
      // EditorContent instead), then announce creation.
      const mount = editorRef.current;
      if (mount && existing.view.dom.parentElement !== mount) {
        mount.appendChild(existing.view.dom);
      }
      callbacksRef.current.onCreate?.(existing);
      return () => {
        destroyCurrentEditor();
      };
    }

    // Use the ref element if available, otherwise create a detached div
    // (composable pattern: Domternal.Content will adopt the DOM later)
    const element = editorRef.current ?? document.createElement('div');

    const initialContent = pendingContentRef.current ?? content;
    pendingContentRef.current = null;

    createEditorInstance(element, initialContent, autofocus);

    return () => {
      destroyCurrentEditor();
    };
    // Mount-only effect: refs (extensionsRef, depsRef, formatRef) and props are
    // intentionally omitted - separate effects below sync extensions, deps, content.
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
    // Recreate only when extensions reference changes. Other refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  // Recreate editor when deps change
  useEffect(() => {
    if (!deps || !instanceRef.current || instanceRef.current.isDestroyed) return;
    // Skip if deps haven't actually changed (initial render)
    if (depsRef.current === deps) return;
    const prevDeps = depsRef.current;
    if (prevDeps?.length === deps.length
        && deps.every((d, i) => d === prevDeps[i])) {
      return;
    }

    const element = instanceRef.current.view.dom.parentElement ?? document.createElement('div');
    destroyCurrentEditor();
    const initialContent = pendingContentRef.current ?? '';
    pendingContentRef.current = null;
    createEditorInstance(element, initialContent, false);
    // Effect tracks the user-provided `deps` array directly; identity comparison
    // and shallow equality are handled above to avoid spurious recreations.
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
  }, [content]);

  return { editor, editorRef };
}
