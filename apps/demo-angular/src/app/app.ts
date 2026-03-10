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
  Dropcursor,
  Editor,
  type ToolbarLayoutEntry,
} from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@domternal/extension-details';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';
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
    LineHeight,
    InvisibleChars,
    SelectionDecoration,
    ClearFormatting,
    Dropcursor,
    Image,
    Table,
    TableRow,
    TableCell,
    TableHeader,
    Details,
    DetailsSummary,
    DetailsContent,
    Emoji.configure({ emojis, suggestion: { render: createEmojiSuggestionRenderer() } }),
  ];
  editorContent = '<h2>Rich Text Editor</h2><p>Hello <strong>World</strong>! Try the toolbar buttons above.</p><pre><code class="language-javascript">function greet(name) {\n  const message = `Hello, ${name}!`;\n  console.log(message);\n  return message;\n}</code></pre><p>Code blocks now have <em>syntax highlighting</em>.</p><h3>More Content for Scrolling</h3><p>This paragraph exists to create enough content so the editor has an internal scrollbar at 50vh max-height. Try typing <code>:smile</code> here to trigger the emoji suggestion dropdown, then scroll both the editor and the page.</p><ul><li>First item in a list</li><li>Second item with <strong>bold text</strong></li><li>Third item with <em>italic text</em></li></ul><blockquote><p>A blockquote to add more vertical content to the editor.</p></blockquote><p>Another paragraph. Keep scrolling to test positioning behavior of floating elements.</p><h3>Even More Content</h3><p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam.</p><p>Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.</p><p>At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.</p><h3>Table Example</h3><table><tr><th>Feature</th><th>Free</th><th>Pro</th></tr><tr><td>Basic editing</td><td>Yes</td><td>Yes</td></tr><tr><td>Tables</td><td>Yes</td><td>Yes</td></tr><tr><td>Merge / Split cells</td><td>—</td><td>Yes</td></tr></table><details><summary>Click to expand this accordion</summary><div data-type="detailsContent"><p>This is the hidden content inside a details/accordion block. It can contain <strong>rich text</strong>, lists, and other block elements.</p><ul><li>Item one</li><li>Item two</li></ul></div></details><p>Final paragraph. Try the emoji picker from the toolbar here too.</p><p><span style="font-size: 17px; font-family: Test">Final paragraph. Try the emoji picker from the toolbar here too.</span></p>';
  emojiData = emojis;
  editor = signal<Editor | null>(null);
  isDark = signal(false);
  useLayout = signal(false);
  toolbarLayout: ToolbarLayoutEntry[] = [
    'bold', 'italic', 'underline', 'heading1',
    '|',
    { dropdown: 'Formatting', icon: 'textStrikethrough', items: ['strike', 'code', 'subscript', 'superscript'], displayMode: 'icon' },
    { dropdown: 'Lists', icon: 'listBullets', items: ['bulletList', 'orderedList', 'taskList'], displayMode: 'text' },
    'clearFormatting',
    '|',
    'heading', 'textAlign', 'lineHeight',
    '|',
    'textColor', 'highlight',
    '|',
    { dropdown: 'Insert', icon: 'gridNine', items: ['link', 'image', 'emoji', 'horizontalRule', 'blockquote', 'codeBlock'] },
    '|',
    'undo', 'redo',
  ];

  onEditorCreated(editor: Editor): void {
    this.editor.set(editor);
  }

  switchToolbarMode(useLayout: boolean): void {
    this.useLayout.set(useLayout);
    // Re-focus editor after toolbar swap so buttons work immediately
    requestAnimationFrame(() => this.editor()?.commands.focus());
  }

  toggleTheme(): void {
    this.isDark.update(v => !v);
    document.body.classList.toggle('dm-theme-dark');
  }
}
