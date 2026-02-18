import {
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  forwardRef,
  signal,
  ChangeDetectionStrategy,
  inject,
  NgZone,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
  untracked,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import {
  Editor,
  Document,
  Paragraph,
  Text,
  BaseKeymap,
  History,
} from '@domternal/core';
import type { Content, AnyExtension, FocusPosition, JSONContent } from '@domternal/core';

export const DEFAULT_EXTENSIONS: AnyExtension[] = [Document, Paragraph, Text, BaseKeymap, History];

@Component({
  selector: 'domternal-editor',
  template: '<div #editorRef></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'dm-editor' },
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
  readonly content = input<Content>('');
  readonly editable = input(true);
  readonly autofocus = input<FocusPosition>(false);
  readonly outputFormat = input<'html' | 'json'>('html');

  // === Outputs ===
  readonly editorCreated = output<Editor>();
  readonly contentUpdated = output<{ editor: Editor }>();
  readonly selectionChanged = output<{ editor: Editor }>();
  readonly focusChanged = output<{ editor: Editor; event: FocusEvent }>();
  readonly blurChanged = output<{ editor: Editor; event: FocusEvent }>();
  readonly editorDestroyed = output<void>();

  // === Signals (read-only public state) ===
  private _htmlContent = signal('');
  private _jsonContent = signal<JSONContent | null>(null);
  private _isEmpty = signal(true);
  private _isFocused = signal(false);
  private _isEditable = signal(true);

  readonly htmlContent = this._htmlContent.asReadonly();
  readonly jsonContent = this._jsonContent.asReadonly();
  readonly isEmpty = this._isEmpty.asReadonly();
  readonly isFocused = this._isFocused.asReadonly();
  readonly isEditable = this._isEditable.asReadonly();

  // === Editor instance ===
  private _editor: Editor | null = null;

  get editor(): Editor | null {
    return this._editor;
  }

  // === ControlValueAccessor ===
  private onChange: (value: Content) => void = () => {};
  private onTouched: () => void = () => {};
  private _pendingContent: Content | null = null;

  private ngZone = inject(NgZone);
  private _initialized = false;

  constructor() {
    afterNextRender(() => {
      this.createEditor();
      this._initialized = true;
    });

    // React to editable input changes
    effect(() => {
      const editable = this.editable();
      if (!this._initialized || !this._editor || this._editor.isDestroyed) return;
      untracked(() => {
        this._editor!.setEditable(editable);
        this._isEditable.set(editable);
      });
    });

    // React to content input changes
    effect(() => {
      const content = this.content();
      const format = this.outputFormat();
      if (!this._initialized || !this._editor || this._editor.isDestroyed) return;
      untracked(() => {
        const current = format === 'html'
          ? this._editor!.getHTML()
          : JSON.stringify(this._editor!.getJSON());
        const incoming = format === 'html'
          ? (content as string)
          : JSON.stringify(content);
        if (incoming !== current) {
          this._editor!.setContent(content, false);
        }
      });
    });

    // React to extensions input changes
    effect(() => {
      this.extensions(); // track the signal
      if (!this._initialized || !this._editor || this._editor.isDestroyed) return;
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
      if (JSON.stringify(value) === JSON.stringify(this._editor.getJSON())) return;
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
    if (this._editor && !this._editor.isDestroyed) {
      this._editor.setEditable(!isDisabled);
    }
    this._isEditable.set(!isDisabled);
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

    this._editor = new Editor({
      element: this.editorRef().nativeElement,
      extensions: [...DEFAULT_EXTENSIONS, ...this.extensions()],
      content: initialContent,
      editable: this.editable(),
      autofocus: this.autofocus(),
    });

    this._isEditable.set(this.editable());

    // Set initial signal values
    this._htmlContent.set(this._editor.getHTML());
    this._jsonContent.set(this._editor.getJSON());
    this._isEmpty.set(this._editor.isEmpty);

    this._editor.on('update', () => {
      this.ngZone.run(() => {
        const ed = this._editor!;
        this._htmlContent.set(ed.getHTML());
        this._jsonContent.set(ed.getJSON());
        this._isEmpty.set(ed.isEmpty);
        this.contentUpdated.emit({ editor: ed });

        const value: Content = this.outputFormat() === 'html' ? ed.getHTML() : ed.getJSON();
        this.onChange(value);
      });
    });

    this._editor.on('selectionUpdate', () => {
      this.ngZone.run(() => {
        this.selectionChanged.emit({ editor: this._editor! });
      });
    });

    this._editor.on('focus', ({ event }) => {
      this.ngZone.run(() => {
        this._isFocused.set(true);
        this.focusChanged.emit({ editor: this._editor!, event });
      });
    });

    this._editor.on('blur', ({ event }) => {
      this.ngZone.run(() => {
        this._isFocused.set(false);
        this.blurChanged.emit({ editor: this._editor!, event });
        this.onTouched();
      });
    });

    // Emit editor created
    this.ngZone.run(() => {
      this.editorCreated.emit(this._editor!);
    });
  }
}
