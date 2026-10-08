import type { ElementRef, OnDestroy } from '@angular/core';
import {
  Component,
  ViewEncapsulation,
  afterNextRender,
  forwardRef,
  signal,
  ChangeDetectionStrategy,
  inject,
  NgZone,
  effect,
  input,
  output,
  viewChild,
  untracked,
} from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { NG_VALUE_ACCESSOR } from '@angular/forms';

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
  I18nOptions,
  JSONContent,
  TransactionEventProps,
  FocusEventProps,
  ContentErrorProps,
  ContentDiagnosticProps,
} from '@domternal/core';

export const DEFAULT_EXTENSIONS: AnyExtension[] = [Document, Paragraph, Text, BaseKeymap, History];

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
function holdsJSONContent(editor: Editor, content: Content): boolean {
  const current = JSON.stringify(editor.getJSON());
  if (JSON.stringify(content) === current) return true;
  if (content === null || typeof content !== 'object') return false;
  const loaded = normalizeContent(content, editor.schema);
  return loaded !== content && JSON.stringify(loaded) === current;
}

@Component({
  selector: 'domternal-editor',
  template: '<div #editorRef></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'dm-editor', 'data-dm-editor-ui': '' },
  styles: [`:host { display: block; }`],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DomternalEditorComponent),
      multi: true,
    },
  ],
})
export class DomternalEditorComponent implements ControlValueAccessor, OnDestroy {
  // === Template ref ===
  readonly editorRef = viewChild.required<ElementRef<HTMLDivElement>>('editorRef');

  // === Inputs ===
  readonly extensions = input<AnyExtension[]>([]);
  /**
   * Whether the built-in History extension is included. Disable it when an
   * extension brings its own undo/redo, such as collaborative editing.
   */
  readonly history = input(true);
  readonly content = input<Content>('');
  readonly editable = input(true);
  /**
   * Editing experience preset. `'notion'` paints `dm-notion-mode` on this
   * component's host and switches preset-aware extensions to their Notion
   * behavior, replacing the hand-written class. Create-time only.
   */
  readonly preset = input<EditorPreset | undefined>(undefined);
  /** Replace UI translations without recreating the editor or changing its form value. */
  readonly i18n = input<I18nOptions | undefined>(undefined);
  readonly autofocus = input<FocusPosition>(false);
  readonly outputFormat = input<'html' | 'json'>('html');

  // === Outputs ===
  readonly editorCreated = output<Editor>();
  readonly contentUpdated = output<{ editor: Editor }>();
  readonly selectionChanged = output<{ editor: Editor }>();
  readonly focusChanged = output<{ editor: Editor; event: FocusEvent }>();
  readonly blurChanged = output<{ editor: Editor; event: FocusEvent }>();
  readonly editorDestroyed = output();
  /**
   * The initial content does not match the schema, so the editor starts
   * empty. Emitted once the editor is ready, before `editorCreated`.
   */
  readonly contentError = output<Omit<ContentErrorProps, 'editor'> & { editor: Editor }>();
  /**
   * Content loaded with replaced values, such as an unknown list marker that
   * became the default marker or a heading level the configuration lacks that
   * became the nearest configured level. The report for the initial content
   * is emitted once the editor is ready, before `editorCreated`; later
   * reports come from setContent (including a changed `content` input or form
   * value), insertContent and normalizeContentAttributes.
   */
  readonly contentDiagnostic = output<Omit<ContentDiagnosticProps, 'editor'> & { editor: Editor }>();

  // === Signals (read-only public state) ===
  private _htmlContent = signal('');
  private _jsonContent = signal<JSONContent | null>(null);
  private _isEmpty = signal(true);
  private _isFocused = signal(false);
  // Candidate for linkedSignal(editable) once min Angular version is >=20
  private _isEditable = signal(true);

  readonly htmlContent = this._htmlContent.asReadonly();
  readonly jsonContent = this._jsonContent.asReadonly();
  readonly isEmpty = this._isEmpty.asReadonly();
  readonly isFocused = this._isFocused.asReadonly();
  readonly isEditable = this._isEditable.asReadonly();

  // === Editor instance ===
  private _editor: Editor | null = null;
  private _hadI18nInput = false;

  get editor(): Editor | null {
    return this._editor;
  }

  // === ControlValueAccessor ===
  private onChange: (value: Content) => void = () => { /* noop until registerOnChange */ };
  private onTouched: () => void = () => { /* noop until registerOnTouched */ };
  private _pendingContent: Content | null = null;

  private ngZone = inject(NgZone);

  constructor() {
    afterNextRender(() => {
      this.createEditor();
    });

    effect(() => {
      const i18n = this.i18n();
      if (!this._editor || this._editor.isDestroyed) return;
      untracked(() => {
        if (i18n !== undefined || this._hadI18nInput) this._editor?.i18n.set(i18n ?? {});
        this._hadI18nInput = i18n !== undefined;
      });
    });

    // React to editable input changes
    effect(() => {
      const editable = this.editable();
      if (!this._editor || this._editor.isDestroyed) return;
      const ed = this._editor;
      untracked(() => {
        ed.setEditable(editable);
        this._isEditable.set(editable);
      });
    });

    // React to content input changes
    effect(() => {
      const content = this.content();
      const format = this.outputFormat();
      if (!this._editor || this._editor.isDestroyed) return;
      const ed = this._editor;
      untracked(() => {
        const holds = format === 'html'
          ? content === ed.getHTML()
          : holdsJSONContent(ed, content);
        if (!holds) {
          ed.setContent(content, false);
        }
      });
    });

    // React to extensions input changes
    effect(() => {
      this.extensions(); // track the signal
      if (!this._editor || this._editor.isDestroyed) return;
      untracked(() => {
        this.recreateEditor();
      });
    });
  }

  // === Lifecycle ===

  ngOnDestroy(): void {
    if (this._editor && !this._editor.isDestroyed) {
      this._editor.destroy();
      this.editorDestroyed.emit();
    }
    this._editor = null;
  }

  // === ControlValueAccessor implementation ===

  writeValue(value: Content): void {
    if (!this._editor || this._editor.isDestroyed) {
      this._pendingContent = value;
      return;
    }

    // Compare current content to avoid unnecessary setContent (which resets cursor)
    if (this.outputFormat() === 'html') {
      if (value === this._editor.getHTML()) return;
    } else {
      if (holdsJSONContent(this._editor, value)) return;
    }

    this._editor.setContent(value, false);
  }

  registerOnChange(fn: (value: Content) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._isEditable.set(!isDisabled);
    if (this._editor && !this._editor.isDestroyed) {
      this._editor.setEditable(!isDisabled);
    }
  }

  // === Private ===

  private recreateEditor(): void {
    if (!this._editor || this._editor.isDestroyed) return;
    const currentContent = this._editor.getJSON();
    this._editor.destroy();
    this.editorDestroyed.emit();
    this._pendingContent = currentContent;
    this.createEditor();
  }

  private createEditor(): void {
    const initialContent = this._pendingContent ?? this.content();
    this._pendingContent = null;

    const defaults = this.history()
      ? DEFAULT_EXTENSIONS
      : DEFAULT_EXTENSIONS.filter((extension) => extension.name !== 'history');
    const preset = this.preset();
    const i18n = this.i18n();
    this._hadI18nInput = i18n !== undefined;

    // Reports the editor makes while it is constructed wait until it is
    // announced, just before editorCreated: its view does not exist yet.
    let constructionReports: (() => void)[] | null = [];
    const report = (deliver: () => void): void => {
      if (constructionReports) constructionReports.push(deliver);
      else deliver();
    };

    const editor: Editor = new Editor({
      element: this.editorRef().nativeElement,
      extensions: [...defaults, ...this.extensions()],
      content: initialContent,
      editable: this.editable(),
      autofocus: this.autofocus(),
      ...(preset ? { preset } : {}),
      ...(i18n !== undefined ? { i18n } : {}),
      onContentError: (props) => {
        report(() => { this.ngZone.run(() => { this.contentError.emit({ ...props, editor }); }); });
      },
      onContentDiagnostic: (props) => {
        report(() => { this.ngZone.run(() => { this.contentDiagnostic.emit({ ...props, editor }); }); });
      },
    });
    this._editor = editor;

    this._isEditable.set(this.editable());

    // Set initial signal values
    this._htmlContent.set(editor.getHTML());
    this._jsonContent.set(editor.getJSON());
    this._isEmpty.set(editor.isEmpty);

    // The signals follow every accepted document change, including one an
    // appended transaction made and programmatic writes (writeValue, [content])
    // that set skipUpdate. Those writes emit nothing and leave the reactive form
    // pristine: contentUpdated and the form follow core's update event.
    editor.on('transaction', ({ transaction, appendedTransactions = [] }: TransactionEventProps) => {
      if (!transaction.docChanged && !appendedTransactions.some(appended => appended.docChanged)) return;
      this.ngZone.run(() => {
        this._htmlContent.set(editor.getHTML());
        this._jsonContent.set(editor.getJSON());
        this._isEmpty.set(editor.isEmpty);
      });
    });

    editor.on('update', () => {
      this.ngZone.run(() => {
        this.contentUpdated.emit({ editor });
        // The transaction listener above has already refreshed the signals for this change. The
        // form gets its own JSON object, so a value changed in place cannot change jsonContent.
        const value: Content = this.outputFormat() === 'html' ? this._htmlContent() : editor.getJSON();
        this.onChange(value);
      });
    });

    editor.on('selectionUpdate', () => {
      this.ngZone.run(() => {
        this.selectionChanged.emit({ editor });
      });
    });

    editor.on('focus', ({ event }: FocusEventProps) => {
      this.ngZone.run(() => {
        this._isFocused.set(true);
        this.focusChanged.emit({ editor, event });
      });
    });

    editor.on('blur', ({ event }: FocusEventProps) => {
      this.ngZone.run(() => {
        this._isFocused.set(false);
        this.blurChanged.emit({ editor, event });
        this.onTouched();
      });
    });

    const reports = constructionReports;
    constructionReports = null;
    reports.forEach((deliver) => { deliver(); });

    // Emit editor created
    this.ngZone.run(() => {
      this.editorCreated.emit(editor);
    });
  }
}
