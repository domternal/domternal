import { Component, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import { Editor, StarterKit, Placeholder, BubbleMenu } from '@domternal/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  templateUrl: './app.html',
})
export class App {
  editor = signal<Editor | null>(null);
  extensions = [
    StarterKit,
    Placeholder.configure({ placeholder: 'Start typing...' }),
    BubbleMenu,
  ];
  content = '<p>Hello from Angular!</p>';
}