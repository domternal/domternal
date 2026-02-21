import { Component, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Code,
  Highlight,
  Subscript,
  Superscript,
  Link,
  Heading,
  Blockquote,
  HardBreak,
  HorizontalRule,
  BulletList,
  OrderedList,
  TaskList,
  TaskItem,
  ListItem,
  TextAlign,
  TextStyle,
  TextColor,
  FontSize,
  FontFamily,
  LineHeight,
  InvisibleChars,
  SelectionDecoration,
  Editor,
} from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

@Component({
  selector: 'app-root',
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  templateUrl: './app.html',
})
export class App {
  // History is already in DEFAULT_EXTENSIONS (from DomternalEditorComponent)
  extensions = [
    Italic,
    Bold,
    Underline,
    Strike,
    Code,
    Highlight,
    Subscript,
    Superscript,
    Link,
    Heading,
    Blockquote,
    CodeBlockLowlight.configure({ lowlight }),
    HardBreak,
    HorizontalRule,
    BulletList,
    OrderedList,
    TaskList,
    TaskItem,
    ListItem,
    TextAlign,
    TextStyle,
    TextColor.configure({ colors: ['#ff0000', '#00ff00', '#0000ff', '#ff9900'] }),
    FontSize,
    FontFamily,
    LineHeight.configure({ lineHeights: ['1', '1.15', '1.5', '2'] }),
    InvisibleChars,
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
