import { type DependencyList, useEffect, useRef, useState } from 'react';
import {
  Editor,
  Document,
  Paragraph,
  Text,
  BaseKeymap,
  History,
  normalizeContent,
} from '@domternal/core';
import type {
  Content,
  AnyExtension,
  FocusPosition,
  EditorPreset,
  FocusEventProps,
  I18nOptions,
  ContentErrorProps,
  ContentDiagnosticProps,
} from '@domternal/core';

export const DEFAULT_EXTENSIONS: AnyExtension[] = [Document, Paragraph, Text, BaseKeymap, History];
const EMPTY_EXTENSIONS: AnyExtension[] = [];

export interface UseEditorOptions {
  /** Custom extensions to add to the editor. */
  extensions?: AnyExtension[];
  /**
   * Whether the built-in History extension is included. Disable it when an
   * extension brings its own undo/redo, such as collaborative editing.
   * @default true
   */
  history?: boolean;
  /** Initial editor content (HTML string or JSON). */
  content?: Content;
  /** Whether the editor is editable. @default true */
  editable?: boolean;
  /** UI translations and formatting settings. Replacements update the existing editor. */
  i18n?: I18nOptions | undefined;
  /**
   * Editing experience preset. `'notion'` paints `dm-notion-mode` on the
   * `.dm-editor` wrapper and switches preset-aware extensions to their
   * Notion behavior, replacing the hand-written class. Create-time only.
   */
  preset?: EditorPreset;
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
  /**
   * Called when the initial content does not match the schema, so the editor
   * starts empty. Delivered once the editor is ready, before `onCreate`.
   */
  onContentError?: (props: Omit<ContentErrorProps, 'editor'> & { editor: Editor }) => void;
  /**
   * Called when content loaded with replaced values, such as an unknown list
   * marker that became the default marker or a heading level the
   * configuration lacks that became the nearest configured level. The report
   * for the initial content is delivered once the editor is ready, before
   * `onCreate`; later reports come from setContent (including a changed
   * `content` value), insertContent and normalizeContentAttributes.
   */
  onContentDiagnostic?: (props: Omit<ContentDiagnosticProps, 'editor'> & { editor: Editor }) => void;
}

/**
 * Whether the editor already holds `content`, compared as JSON. Loading
 * replaces an unknown list marker with the default marker and a heading level
 * the configuration lacks with the nearest configured level, so `content`
 * also counts as held once the same replacement makes it equal: a new but
 * equal value that still carries one must not replace the document and move
 * the selection. The plain comparison comes first, because the document
 * itself can hold such a value (a bound collaborative document before
 * normalizeContentAttributes runs), and its own JSON echoed back must not
 * replace it.
 */
export function holdsJSONContent(editor: Editor, content: Content): boolean {
  const current = JSON.stringify(editor.getJSON());
  if (JSON.stringify(content) === current) return true;
  if (content === null || typeof content !== 'object') return false;
  const loaded = normalizeContent(content, editor.schema);
  return loaded !== content && JSON.stringify(loaded) === current;
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
 * @example Update UI translations without recreating the editor
 * ```tsx
 * const { editor, editorRef } = useEditor({ extensions, content, i18n: { locale, messages } });
 * ```
 */
export interface UseEditorResult {
  editor: Editor | null;
  editorRef: React.RefObject<HTMLDivElement | null>;
}

export function useEditor(options: UseEditorOptions = {}, deps?: DependencyList): UseEditorResult {
  const {
    extensions = EMPTY_EXTENSIONS,
    history = true,
    content = '',
    editable = true,
    autofocus = false,
    outputFormat = 'html',
    immediatelyRender = false,
  } = options;

  const editorRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<Editor | null>(null);
  const pendingContentRef = useRef<Content | null>(null);
  const syncedI18nRef = useRef(options.i18n);

  // Store latest callbacks in refs to avoid stale closures
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Store latest content/format for comparison
  const contentRef = useRef(content);
  contentRef.current = content;
  const formatRef = useRef(outputFormat);
  formatRef.current = outputFormat;

  // The `content` prop value the current editor already carries, so the
  // content-sync effect only reacts to REAL prop changes. Without it, the
  // effect's mount run compares the source string against the round-trip
  // `getHTML()` (they practically never match: attribute order, entities)
  // and echoes a full-document `setContent` on every mount; the mapped-
  // through selection then lands at the document END, which is a
  // NodeSelection when the document ends in an atom (e.g. block math),
  // disabling every mark button until the user clicks into the editor.
  const syncedContentRef = useRef<Content | null>(null);

  // Track extensions reference for recreation
  const extensionsRef = useRef(extensions);

  // Track deps for recreation
  const depsRef = useRef(deps);

  // Reports the editor makes while it is constructed wait here until the
  // editor is announced, just before onCreate: its view does not exist yet,
  // and with immediatelyRender construction runs during render. Later
  // reports are delivered as they happen.
  const constructionReportsRef = useRef<(() => void)[] | null>(null);

  function report(deliver: () => void): void {
    const pending = constructionReportsRef.current;
    if (pending) pending.push(deliver);
    else deliver();
  }

  function deliverConstructionReports(): void {
    const pending = constructionReportsRef.current ?? [];
    constructionReportsRef.current = null;
    pending.forEach((deliver) => { deliver(); });
  }

  /** Wire transaction, focus, blur event handlers to an editor instance. */
  function wireEvents(ed: Editor): void {
    // Follow core's events, which count changes that appended transactions make
    // and skip programmatic writes (setContent(content, false)) that set skipUpdate.
    ed.on('update', () => {
      callbacksRef.current.onUpdate?.({ editor: ed });
    });
    ed.on('selectionUpdate', () => {
      callbacksRef.current.onSelectionChange?.({ editor: ed });
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
    const defaults = history
      ? DEFAULT_EXTENSIONS
      : DEFAULT_EXTENSIONS.filter((extension) => extension.name !== 'history');
    constructionReportsRef.current = [];
    const ed: Editor = new Editor({
      element,
      extensions: [...defaults, ...extensions],
      content: initialContent,
      editable,
      autofocus: focus,
      ...(options.preset ? { preset: options.preset } : {}),
      ...(options.i18n !== undefined ? { i18n: options.i18n } : {}),
      onContentError: (props) => {
        report(() => { callbacksRef.current.onContentError?.({ ...props, editor: ed }); });
      },
      onContentDiagnostic: (props) => {
        report(() => {
          // Advisory, as in core: a throwing callback never interrupts the editor.
          try {
            callbacksRef.current.onContentDiagnostic?.({ ...props, editor: ed });
          } catch { /* advisory */ }
        });
      },
    });

    wireEvents(ed);
    instanceRef.current = ed;
    extensionsRef.current = extensions;
    depsRef.current = deps;
    syncedI18nRef.current = options.i18n;
    // The new editor carries the current prop value (directly, or as the
    // preserved snapshot of it on recreation): the content-sync effect must
    // not echo it back as a full-document replace.
    syncedContentRef.current = contentRef.current;
    return ed;
  }

  /** Create editor, publish it to state, and announce creation. */
  function createEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition): Editor {
    const ed = buildEditorInstance(element, initialContent, focus);
    setEditor(ed);
    deliverConstructionReports();
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
      if (mount) existing.adoptDom(mount);
      deliverConstructionReports();
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

  // Sync editable. The editor is built with the current value, so the mount run
  // changes nothing; setEditable would still dispatch, and plugins such as
  // TrailingNode answer any dispatch with a change that reaches onUpdate.
  useEffect(() => {
    const ed = instanceRef.current;
    if (ed && !ed.isDestroyed && ed.isEditable !== editable) {
      ed.setEditable(editable);
    }
  }, [editable]);

  useEffect(() => {
    const ed = instanceRef.current;
    if (!ed || ed.isDestroyed || syncedI18nRef.current === options.i18n) return;
    syncedI18nRef.current = options.i18n;
    ed.i18n.set(options.i18n ?? {});
  }, [options.i18n]);

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

  // Sync content from outside. Reacts only to a `content` value the current
  // editor does not already carry (see `syncedContentRef`); the value
  // comparison below still guards against a re-render handing us a NEW
  // string with identical content.
  useEffect(() => {
    const ed = instanceRef.current;
    if (!ed || ed.isDestroyed) return;
    if (syncedContentRef.current === content) return;
    syncedContentRef.current = content;

    const format = formatRef.current;
    if (format === 'html') {
      if (content !== ed.getHTML()) {
        ed.setContent(content, false);
      }
    } else {
      if (!holdsJSONContent(ed, content)) {
        ed.setContent(content, false);
      }
    }
  }, [content]);

  return { editor, editorRef };
}
