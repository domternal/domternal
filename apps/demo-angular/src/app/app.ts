import { Component, signal } from '@angular/core';
import { DomternalEditorComponent } from '@domternal/angular';
import { Bold, Editor } from '@domternal/core';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent],
  templateUrl: './app.html',
})
export class App {
  extensions = [Bold];
  editor: Editor | null = null;
  isDark = signal(false);

  onEditorCreated(editor: Editor): void {
    this.editor = editor;
  }

  toggleBold(): void {
    this.editor?.commands.toggleBold();
  }

  isBoldActive(): boolean {
    return this.editor?.isActive('bold') ?? false;
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
