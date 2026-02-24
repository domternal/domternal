import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
  DomternalFloatingMenuComponent,
  DomternalEmojiPickerComponent,
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
  ClearFormatting,
  Editor,
} from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
import { Image } from '@domternal/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@domternal/extension-details';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent, DomternalFloatingMenuComponent, DomternalEmojiPickerComponent],
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
    TextColor,
    FontSize,
    FontFamily,
    LineHeight.configure({ lineHeights: ['1', '1.15', '1.5', '2'] }),
    InvisibleChars,
    SelectionDecoration,
    ClearFormatting,
    Table,
    TableRow,
    TableCell,
    TableHeader,
    Image,
    Details,
    DetailsSummary,
    DetailsContent,
    Emoji.configure({ emojis, suggestion: { render: createEmojiSuggestionRenderer() } }),
  ];
  emojiData = emojis;
  editor = signal<Editor | null>(null);
  isDark = signal(false);

  onEditorCreated(editor: Editor): void {
    this.editor.set(editor);
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }

}
