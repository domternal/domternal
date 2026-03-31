import { Component, ChangeDetectionStrategy, signal, input, effect, untracked } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
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
  LinkPopover,
  Heading,
  Blockquote,
  HardBreak,
  HorizontalRule,
  BulletList,
  OrderedList,
  TaskList,
  TextAlign,
  TextColor,
  FontSize,
  FontFamily,
  LineHeight,
  InvisibleChars,
  SelectionDecoration,
  ClearFormatting,
  Dropcursor,
  Editor,
  inlineStyles,
  type ToolbarLayoutEntry,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { Details } from '@domternal/extension-details';
import { Table } from '@domternal/extension-table';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';
import type { MentionItem } from '@domternal/extension-mention';
import { createLowlight, common } from 'lowlight';
import { DEMO_CONTENT } from './demo-content.js';

const lowlight = createLowlight(common);
const codeHighlighter = createCodeHighlighter(lowlight);

const mockUsers: MentionItem[] = [
  { id: '1', label: 'Alice Johnson' },
  { id: '2', label: 'Bob Smith' },
  { id: '3', label: 'Charlie Brown' },
  { id: '4', label: 'Diana Prince' },
  { id: '5', label: 'Eve Adams' },
  { id: '6', label: 'Frank Castle' },
  { id: '7', label: 'Grace Hopper' },
  { id: '8', label: 'Henry Ford' },
];

@Component({
  selector: 'app-editor-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent, DomternalEmojiPickerComponent],
  templateUrl: './editor-demo.component.html',
})
export class EditorDemoComponent {
  private readonly params = new URLSearchParams(window.location.search);
  private readonly constrainTable = !this.params.has('constrainTable', 'false');
  private readonly resizeBehavior = (this.params.get('resizeBehavior') ?? 'neighbor') as 'neighbor' | 'independent' | 'redistribute';

  extensions = [
    // Inline formatting
    Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
    // Block elements
    Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
    // Lists (auto-include ListItem / TaskItem)
    BulletList, OrderedList, TaskList,
    // Text styling (TextColor/FontSize/FontFamily auto-include TextStyle)
    TextAlign, TextColor, FontSize, FontFamily, LineHeight,
    // Table (auto-includes TableRow, TableCell, TableHeader)
    Table.configure({ constrainToContainer: this.constrainTable, resizeBehavior: this.resizeBehavior }),
    // Details / Accordion (auto-includes DetailsSummary, DetailsContent)
    Details,
    // Media & Emoji
    Image,
    Emoji.configure({ emojis, enableEmoticons: true, suggestion: { render: createEmojiSuggestionRenderer() } }),
    // Mentions
    Mention.configure({
      suggestion: {
        char: '@',
        name: 'user',
        items: ({ query }: { query: string }) => mockUsers.filter((u) => u.label.toLowerCase().includes(query.toLowerCase())),
        render: createMentionSuggestionRenderer(),
        minQueryLength: 0,
        invalidNodes: ['codeBlock'],
      },
    }),
    // Editor utilities
    LinkPopover, InvisibleChars, SelectionDecoration, ClearFormatting, Dropcursor,
  ];
  editorContent = DEMO_CONTENT;
  emojiData = emojis;
  editor = signal<Editor | null>(null);
  readonly useLayout = input(false);
  toolbarLayout: ToolbarLayoutEntry[] = [
    'bold', 'italic', 'underline', 'heading1',
    '|',
    { dropdown: 'Formatting', icon: 'textStrikethrough', items: ['strike', 'code', 'subscript', 'superscript'], displayMode: 'icon' },
    { dropdown: 'Lists', icon: 'list', items: ['bulletList', 'orderedList', 'taskList'], dynamicIcon: true },
    'clearFormatting',
    '|',
    'heading', 'textAlign', 'lineHeight',
    '|',
    'textColor', 'highlight',
    '|',
    { dropdown: 'Insert', icon: 'plus', items: ['link', 'image', 'emoji'] },
    '|',
    'undo', 'redo',
  ];

  constructor() {
    effect(() => {
      this.useLayout(); // track
      const editor = untracked(() => this.editor());
      if (editor) {
        requestAnimationFrame(() => editor.commands.focus());
      }
    });
  }

  getStyledHtml(html: string): string {
    return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
  }

  onEditorCreated(editor: Editor): void {
    this.editor.set(editor);
  }
}
