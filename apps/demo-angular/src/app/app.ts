import { Component, ViewChild } from '@angular/core';
import { DomternalEditorComponent, Editor } from '@domternal/angular';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  @ViewChild(DomternalEditorComponent) editorComponent!: DomternalEditorComponent;

  editor: Editor | null = null;
  isBoldActive = false;
  currentHTML = '';

  onEditorCreated(editor: Editor): void {
    this.editor = editor;
    this.currentHTML = editor.getHTML();
  }

  onContentUpdated(): void {
    if (!this.editor) return;
    this.currentHTML = this.editor.getHTML();
    this.isBoldActive = this.editor.isActive('bold');
  }

  onSelectionChanged(): void {
    if (!this.editor) return;
    this.isBoldActive = this.editor.isActive('bold');
  }

  toggleBold(): void {
    // Commands are dynamically typed via module augmentation which doesn't
    // survive DTS bundling — cast needed until core switches to package-level augmentation
    (this.editor?.commands as any).toggleBold();
  }
}
