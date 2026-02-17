import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
  afterNextRender,
  forwardRef,
  signal,
  ChangeDetectionStrategy,
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
  styles: [`
    :host { display: block; }
    .ProseMirror { outline: none; }
    .ProseMirror:focus { outline: none; }
  `],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DomternalEditorComponent),
      multi: true,
    },
  ],
})
export class DomternalEditorComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  // === Template ref ===
  @ViewChild('editorRef', { static: true }) editorRef!: ElementRef<HTMLDivElement>;

  // === Inputs ===
  @Input() extensions: AnyExtension[] = [];
  @Input() content: Content = '';
  @Input() editable = true;
  @Input() autofocus: FocusPosition = false;
  @Input() outputFormat: 'html' | 'json' = 'html';

  // === Outputs ===
  @Output() editorCreated = new EventEmitter<Editor>();
  @Output() contentUpdated = new EventEmitter<{ editor: Editor }>();
  @Output() selectionChanged = new EventEmitter<{ editor: Editor }>();
  @Output() focusChanged = new EventEmitter<{ editor: Editor; event: FocusEvent }>();
  @Output() blurChanged = new EventEmitter<{ editor: Editor; event: FocusEvent }>();
  @Output() editorDestroyed = new EventEmitter<void>();

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

  constructor(private ngZone: NgZone) {
    afterNextRender(() => {
      this.createEditor();
    });
  }

  // === Lifecycle ===

  ngOnChanges(changes: SimpleChanges): void {
    if (!this._editor || this._editor.isDestroyed) return;

    if (changes['editable'] && !changes['editable'].firstChange) {
      this._editor.setEditable(this.editable);
      this._isEditable.set(this.editable);
    }

    if (changes['content'] && !changes['content'].firstChange) {
      const current = this.outputFormat === 'html'
        ? this._editor.getHTML()
        : JSON.stringify(this._editor.getJSON());
      const incoming = this.outputFormat === 'html'
        ? this.content
        : JSON.stringify(this.content);
      if (incoming !== current) {
        this._editor.setContent(this.content, false);
      }
    }

    if (changes['extensions'] && !changes['extensions'].firstChange) {
      this.recreateEditor();
    }
  }

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
    if (this.outputFormat === 'html') {
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
    this.content = currentContent;
    this.createEditor();
  }

  private createEditor(): void {
    const initialContent = this._pendingContent ?? this.content;
    this._pendingContent = null;

    this._editor = new Editor({
      element: this.editorRef.nativeElement,
      extensions: [...DEFAULT_EXTENSIONS, ...this.extensions],
      content: initialContent,
      editable: this.editable,
      autofocus: this.autofocus,
    });

    this._isEditable.set(this.editable);

    // Set initial signal values
    this._htmlContent.set(this._editor.getHTML());
    this._jsonContent.set(this._editor.getJSON());
    this._isEmpty.set(this._editor.isEmpty);

    // Subscribe to editor events — use this._editor! (full Editor type)
    // instead of callback's `editor` param (EditorInstance minimal type)
    this._editor.on('update', () => {
      this.ngZone.run(() => {
        const ed = this._editor!;
        this._htmlContent.set(ed.getHTML());
        this._jsonContent.set(ed.getJSON());
        this._isEmpty.set(ed.isEmpty);
        this.contentUpdated.emit({ editor: ed });

        const value: Content = this.outputFormat === 'html' ? ed.getHTML() : ed.getJSON();
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
