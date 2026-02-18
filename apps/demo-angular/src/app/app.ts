import { Component, signal } from '@angular/core';
import { DomternalEditorComponent, DomternalToolbarComponent } from '@domternal/angular';
import {
  Bold,
  Italic,
  Underline,
  Heading,
  BulletList,
  OrderedList,
  ListItem,
  History,
  SelectionDecoration,
  Editor,
} from '@domternal/core';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent, DomternalToolbarComponent],
  templateUrl: './app.html',
})
export class App {
  extensions = [
    Bold,
    Italic,
    Underline,
    Heading,
    BulletList,
    OrderedList,
    ListItem,
    History,
    SelectionDecoration,
  ];
  editor: Editor | null = null;
  isDark = signal(false);

  onEditorCreated(editor: Editor): void {
    this.editor = editor;
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
