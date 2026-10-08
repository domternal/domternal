import {
  Editor,
  Document,
  Paragraph,
  Text,
  BaseKeymap,
  History,
} from '@domternal/core';
import type {
  Content,
  AnyExtension,
  FocusPosition,
  EditorPreset,
  I18nOptions,
  JSONContent,
  FocusEventProps,
  ContentErrorProps,
  ContentDiagnosticProps,
} from '@domternal/core';
import { assertBrowser } from '../shared/isBrowser.js';

export const DEFAULT_EXTENSIONS: AnyExtension[] = [
  Document,
  Paragraph,
  Text,
  BaseKeymap,
  History,
];

export interface DomternalEditorOptions {
  /** Custom extensions to add. Merged on top of `DEFAULT_EXTENSIONS`. */
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
  /**
   * Editing experience preset. `'notion'` paints `dm-notion-mode` on the
   * `.dm-editor` host and switches preset-aware extensions to their Notion
   * behavior, replacing the hand-written class. Create-time only.
   */
  preset?: EditorPreset;
  /** Initial UI translations. Use editor.i18n.set() for live replacement. */
  i18n?: I18nOptions;
  /** Where to autofocus on mount. @default false */
  autofocus?: FocusPosition;
  /**
   * Output format hint for downstream consumers (e.g. host frameworks
   * comparing controlled-mode content). Does not change editor behavior.
   * @default 'html'
   */
  outputFormat?: 'html' | 'json';
  /** Called once when the underlying Editor instance is created. */
  onCreate?: (editor: Editor) => void;
  /** Called when the document content changes. */
  onUpdate?: (ctx: { editor: Editor }) => void;
  /** Called when the selection moves without a content change. */
  onSelectionChange?: (ctx: { editor: Editor }) => void;
  /** Called when the editor gains focus. */
  onFocus?: (ctx: { editor: Editor; event: FocusEvent }) => void;
  /** Called when the editor loses focus. */
  onBlur?: (ctx: { editor: Editor; event: FocusEvent }) => void;
  /** Called before the underlying Editor is destroyed. */
  onDestroy?: () => void;
  /**
   * Called when the initial content does not match the schema, so the editor
   * starts empty. Delivered once the editor is ready, before `onCreate`.
   */
  onContentError?: (ctx: Omit<ContentErrorProps, 'editor'> & { editor: Editor }) => void;
  /**
   * Called when content loaded with replaced values, such as an unknown list
   * marker that became the default marker or a heading level the
   * configuration lacks that became the nearest configured level. The report
   * for the initial content is delivered once the editor is ready, before
   * `onCreate`; later reports come from setContent, insertContent and
   * normalizeContentAttributes.
   */
  onContentDiagnostic?: (ctx: Omit<ContentDiagnosticProps, 'editor'> & { editor: Editor }) => void;
}

/**
 * `DomternalEditor` - vanilla DOM wrapper around `@domternal/core`'s `Editor`.
 *
 * Mounts an editor into the host element, wires lifecycle callbacks, exposes
 * reactive-friendly getters via plain properties, and dispatches `CustomEvent`
 * instances for state changes (so framework adapters can bridge).
 *
 * Construction is browser-only - throws in SSR contexts (use Astro
 * `<client:only="vanilla">` or similar gate).
 *
 * Cleanup is automatic via `destroy()` (calls `editor.destroy()` + emits
 * `destroy` event).
 *
 * @example
 * ```ts
 * import { DomternalEditor } from '@domternal/vanilla';
 * import { StarterKit } from '@domternal/core';
 *
 * const host = document.getElementById('editor')!;
 * const wrapper = new DomternalEditor(host, {
 *   extensions: [StarterKit],
 *   content: '<p>Hello world</p>',
 *   onUpdate: ({ editor }) => console.log(editor.getHTML()),
 * });
 *
 * // Reactive access via getters:
 * console.log(wrapper.htmlContent);
 * console.log(wrapper.isEmpty);
 *
 * // Event subscription (CustomEvent):
 * wrapper.addEventListener('update', () => {
 *   console.log('content changed');
 * });
 *
 * // Cleanup:
 * wrapper.destroy();
 * ```
 *
 * **Events dispatched** (CustomEvent, `detail` shape in brackets):
 * - `create` - `{ editor: Editor }` - emitted once after Editor instantiation
 * - `update` - `{ editor: Editor }` - emitted on every content change
 * - `selectionchange` - `{ editor: Editor }` - emitted on selection-only updates
 * - `focus` - `{ editor: Editor; event: FocusEvent }`
 * - `blur` - `{ editor: Editor; event: FocusEvent }`
 * - `destroy` - `null` - emitted just before destroy completes
 * - `contenterror` (the `onContentError` context): the initial content does
 *   not match the schema
 * - `contentdiagnostic` (the `onContentDiagnostic` context): content loaded
 *   with replaced values
 *
 * Reports about the initial content arrive while the constructor runs, before
 * a listener can be added: pass `onContentError` and `onContentDiagnostic` to
 * receive them.
 */
export class DomternalEditor extends EventTarget {
  /** The underlying ProseMirror-backed `Editor` instance. */
  readonly editor: Editor;
  /** The host element provided to the constructor. */
  readonly host: HTMLElement;

  #destroyed = false;
  #onCreate: DomternalEditorOptions['onCreate'];
  #onUpdate: DomternalEditorOptions['onUpdate'];
  #onSelectionChange: DomternalEditorOptions['onSelectionChange'];
  #onFocus: DomternalEditorOptions['onFocus'];
  #onBlur: DomternalEditorOptions['onBlur'];
  #onDestroy: DomternalEditorOptions['onDestroy'];
  #onContentError: DomternalEditorOptions['onContentError'];
  #onContentDiagnostic: DomternalEditorOptions['onContentDiagnostic'];

  #updateHandler: (() => void) | null = null;
  #selectionHandler: (() => void) | null = null;
  #focusHandler: ((props: FocusEventProps) => void) | null = null;
  #blurHandler: ((props: FocusEventProps) => void) | null = null;

  constructor(host: HTMLElement, options: DomternalEditorOptions = {}) {
    super();
    assertBrowser('DomternalEditor');

    if (!(host instanceof HTMLElement)) {
      throw new TypeError(
        '[DomternalEditor] host must be an HTMLElement. ' +
          'Pass a DOM node (e.g. document.querySelector("#editor")).',
      );
    }

    this.host = host;
    this.#onCreate = options.onCreate;
    this.#onUpdate = options.onUpdate;
    this.#onSelectionChange = options.onSelectionChange;
    this.#onFocus = options.onFocus;
    this.#onBlur = options.onBlur;
    this.#onDestroy = options.onDestroy;
    this.#onContentError = options.onContentError;
    this.#onContentDiagnostic = options.onContentDiagnostic;

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

    this.editor = new Editor({
      element: host,
      extensions: [...defaults, ...(options.extensions ?? [])],
      content: options.content ?? '',
      editable: options.editable ?? true,
      autofocus: options.autofocus ?? false,
      ...(options.preset ? { preset: options.preset } : {}),
      ...(options.i18n !== undefined ? { i18n: options.i18n } : {}),
      onContentError: (props) => { report(() => { this.#reportContentError(props); }); },
      onContentDiagnostic: (props) => { report(() => { this.#reportContentDiagnostic(props); }); },
    });

    this.#wireEditorEvents();
    const reports = constructionReports;
    constructionReports = null;
    reports.forEach((deliver) => { deliver(); });

    this.#onCreate?.(this.editor);
    this.dispatchEvent(
      new CustomEvent('create', { detail: { editor: this.editor } }),
    );
  }

  // === Reactive-friendly getters ===

  get htmlContent(): string {
    return this.editor.getHTML();
  }

  get jsonContent(): JSONContent {
    return this.editor.getJSON();
  }

  get isEmpty(): boolean {
    return this.editor.isEmpty;
  }

  get isFocused(): boolean {
    return this.editor.isFocused;
  }

  get isEditable(): boolean {
    return this.editor.isEditable;
  }

  // === Mutators ===

  /**
   * Replace editor content. Does NOT emit `update` event by default
   * (mirrors `Editor.setContent` behavior); pass `emitUpdate=true` to fire.
   *
   * No-op if the wrapper has been destroyed.
   */
  setContent(content: Content, emitUpdate = false): void {
    if (this.#destroyed) return;
    this.editor.setContent(content, emitUpdate);
  }

  /**
   * Toggle the editor's editable state (`true` allows input, `false` makes
   * it read-only). No-op if the wrapper has been destroyed.
   */
  setEditable(editable: boolean): void {
    if (this.#destroyed) return;
    this.editor.setEditable(editable);
  }

  /**
   * Programmatically focus the editor.
   *
   * @param position - Focus position (`'start' | 'end' | 'all' | number | boolean`).
   *   Defaults to current selection. No-op if the wrapper has been destroyed.
   */
  focus(position?: FocusPosition): void {
    if (this.#destroyed) return;
    this.editor.commands.focus(position);
  }

  /**
   * Tear down the underlying editor + remove all subscriptions.
   *
   * Idempotent - calling twice is a no-op. Dispatches a `destroy` CustomEvent
   * BEFORE the editor is destroyed, so listeners can read `this.editor` state
   * one last time.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#onDestroy?.();
    this.dispatchEvent(new CustomEvent('destroy', { detail: null }));

    this.#unwireEditorEvents();

    if (!this.editor.isDestroyed) {
      this.editor.destroy();
    }
  }

  // === Internal ===

  #reportContentError(props: ContentErrorProps): void {
    const detail = { ...props, editor: this.editor };
    this.#onContentError?.(detail);
    this.dispatchEvent(new CustomEvent('contenterror', { detail }));
  }

  #reportContentDiagnostic(props: ContentDiagnosticProps): void {
    const detail = { ...props, editor: this.editor };
    // Advisory, as in core: a throwing callback never interrupts the editor.
    try {
      this.#onContentDiagnostic?.(detail);
    } catch { /* advisory */ }
    this.dispatchEvent(new CustomEvent('contentdiagnostic', { detail }));
  }

  #wireEditorEvents(): void {
    // Follow core's events, which count changes that appended transactions make
    // and skip programmatic writes (setContent(content, false)) that set skipUpdate.
    this.#updateHandler = (): void => {
      this.#onUpdate?.({ editor: this.editor });
      this.dispatchEvent(
        new CustomEvent('update', { detail: { editor: this.editor } }),
      );
    };
    this.#selectionHandler = (): void => {
      this.#onSelectionChange?.({ editor: this.editor });
      this.dispatchEvent(
        new CustomEvent('selectionchange', { detail: { editor: this.editor } }),
      );
    };

    this.#focusHandler = ({ event }: FocusEventProps): void => {
      this.#onFocus?.({ editor: this.editor, event });
      this.dispatchEvent(
        new CustomEvent('focus', { detail: { editor: this.editor, event } }),
      );
    };

    this.#blurHandler = ({ event }: FocusEventProps): void => {
      this.#onBlur?.({ editor: this.editor, event });
      this.dispatchEvent(
        new CustomEvent('blur', { detail: { editor: this.editor, event } }),
      );
    };

    this.editor.on('update', this.#updateHandler);
    this.editor.on('selectionUpdate', this.#selectionHandler);
    this.editor.on('focus', this.#focusHandler);
    this.editor.on('blur', this.#blurHandler);
  }

  #unwireEditorEvents(): void {
    if (this.#updateHandler) {
      this.editor.off('update', this.#updateHandler);
      this.#updateHandler = null;
    }
    if (this.#selectionHandler) {
      this.editor.off('selectionUpdate', this.#selectionHandler);
      this.#selectionHandler = null;
    }
    if (this.#focusHandler) {
      this.editor.off('focus', this.#focusHandler);
      this.#focusHandler = null;
    }
    if (this.#blurHandler) {
      this.editor.off('blur', this.#blurHandler);
      this.#blurHandler = null;
    }
  }
}
