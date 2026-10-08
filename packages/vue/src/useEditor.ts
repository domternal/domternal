import { markRaw, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
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

  function wireEvents(ed: Editor): void {
    // Follow core's events, which count changes that appended transactions make
    // and skip programmatic writes (setContent(content, false)) that set skipUpdate.
    ed.on('update', () => {
      options.onUpdate?.({ editor: ed });
    });
    ed.on('selectionUpdate', () => {
      options.onSelectionChange?.({ editor: ed });
    });

    ed.on('focus', ({ event }: FocusEventProps) => {
      options.onFocus?.({ editor: ed, event });
    });

    ed.on('blur', ({ event }: FocusEventProps) => {
      options.onBlur?.({ editor: ed, event });
    });
  }

  function createEditorInstance(element: HTMLElement, initialContent: Content, focus: FocusPosition): Editor {
    const extensions = options.extensions ?? [];
    const editable = options.editable ?? true;
    const defaults = (options.history ?? true)
      ? DEFAULT_EXTENSIONS
      : DEFAULT_EXTENSIONS.filter((extension) => extension.name !== 'history');

    // Reports the editor makes while it is constructed wait until it is
    // announced, just before onCreate: its view does not exist yet.
    let constructionReports: (() => void)[] | null = [];
    const report = (deliver: () => void): void => {
      if (constructionReports) constructionReports.push(deliver);
      else deliver();
    };

    const ed: Editor = new Editor({
      element,
      extensions: [...defaults, ...extensions],
      content: initialContent,
      editable,
      autofocus: focus,
      ...(options.preset ? { preset: options.preset } : {}),
      ...(options.i18n !== undefined ? { i18n: options.i18n } : {}),
      onContentError: (props) => {
        report(() => { options.onContentError?.({ ...props, editor: ed }); });
      },
      onContentDiagnostic: (props) => {
        report(() => {
          // Advisory, as in core: a throwing callback never interrupts the editor.
          try {
            options.onContentDiagnostic?.({ ...props, editor: ed });
          } catch { /* advisory */ }
        });
      },
    });

    markRaw(ed);
    wireEvents(ed);
    editor.value = ed;
    const reports = constructionReports;
    constructionReports = null;
    reports.forEach((deliver) => { deliver(); });
    options.onCreate?.(ed);
    return ed;
  }

  function destroyCurrentEditor(insertClone = true): void {
    const current = editor.value;
    if (current && !current.isDestroyed) {
      pendingContent = current.getJSON();
      options.onDestroy?.();

      // Clone editor DOM before destroy to prevent content flash during unmount
      // transitions. The recreate path (insertClone=false) immediately mounts a
      // new editor in the same place, so it must skip the clone to avoid leaving
      // an orphan copy in the live container.
      if (insertClone) {
        const dom = current.view.dom;
        const parent = dom.parentNode;
        if (parent) {
          const clone = dom.cloneNode(true) as HTMLElement;
          clone.style.pointerEvents = 'none';
          parent.insertBefore(clone, dom);
        }
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
    const ed = editor.value;
    if (ed) {
      // immediatelyRender path: the editor was created detached during setup.
      // Adopt its DOM into the mount node so it is not left blank.
      const mount = editorRef.value;
      if (mount) ed.adoptDom(mount);
      return;
    }

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

  // Replace supplied settings, including a single reset when they are removed.
  watch(
    () => options.i18n,
    (settings) => {
      const ed = editor.value;
      if (ed && !ed.isDestroyed) ed.i18n.set(settings ?? {});
    },
  );

  // Recreate editor when extensions array reference changes
  watch(
    () => options.extensions,
    (newExtensions, oldExtensions) => {
      if (!editor.value || editor.value.isDestroyed) return;
      if (newExtensions === oldExtensions) return;

      const element = editor.value.view.dom.parentElement ?? document.createElement('div');
      destroyCurrentEditor(false);
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
        if (!holdsJSONContent(ed, newContent)) {
          ed.setContent(newContent, false);
        }
      }
    },
    { flush: 'post' },
  );

  return { editor, editorRef };
}
