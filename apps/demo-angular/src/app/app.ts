import { Component, signal } from '@angular/core';
import { DomternalEditorComponent } from '@domternal/angular';
import { Bold, SelectionDecoration, Editor } from '@domternal/core';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent],
  templateUrl: './app.html',
})
export class App {
  extensions = [Bold, SelectionDecoration];
  editor: Editor | null = null;
  isDark = signal(false);
  boldActive = signal(false);

  onEditorCreated(editor: Editor): void {
    this.editor = editor;
  }

  toggleBold(): void {
    this.editor?.commands.toggleBold();
    this.updateActiveStates();
  }

  updateActiveStates(): void {
    this.boldActive.set(this.editor?.isActive('bold') ?? false);
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
