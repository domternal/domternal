import { Component, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import { Editor, StarterKit, BubbleMenu } from '@domternal/core';

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  templateUrl: './app.html',
})
export class App {
  editor = signal<Editor | null>(null);
  extensions = [StarterKit, BubbleMenu];
  content = '<p>Hello from Angular!</p>';
}
