import { Component, ChangeDetectionStrategy, OnDestroy, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalBubbleMenuComponent,
  DomternalFloatingMenuComponent,
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
  SelectionDecoration,
  ClearFormatting,
  Dropcursor,
  UniqueID,
  Editor,
} from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { Details } from '@domternal/extension-details';
import { Table } from '@domternal/extension-table';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';
import {
  BlockHandle,
  BlockContextMenu,
  KeyboardReorder,
  SlashCommand,
} from '@domternal/extension-block-menu';
import type { MentionItem } from '@domternal/extension-mention';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

const mockUsers: MentionItem[] = [
  { id: '1', label: 'Alice Johnson' },
  { id: '2', label: 'Bob Smith' },
  { id: '3', label: 'Charlie Brown' },
  { id: '4', label: 'Diana Prince' },
  { id: '5', label: 'Eve Adams' },
];

const STARTER_CONTENT = `
<h1>Untitled</h1>
<p>Welcome to a clean, distraction-free editor. Select any text to format it via the bubble menu, or move the cursor to an empty line to bring up the floating menu for inserting blocks.</p>
<p></p>
`;

/**
 * Notion-style demo: no toolbar, floating menu on empty lines is the primary
 * block-insert UI, bubble menu for text formatting on selection.
 */
@Component({
  selector: 'app-notion-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DomternalEditorComponent,
    DomternalBubbleMenuComponent,
    DomternalFloatingMenuComponent,
  ],
  templateUrl: './notion-demo.component.html',
  styleUrls: ['./notion-demo.component.scss'],
})
export class NotionDemoComponent implements OnDestroy {
  extensions = [
    // Inline formatting (available via bubble menu on selection)
    Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
    // Block elements (inserted via floating menu on empty lines)
    Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
    BulletList, OrderedList, TaskList,
    // Text styling — available via bubble menu
    TextAlign, TextColor, FontSize, FontFamily, LineHeight,
    Table,
    Details,
    Image,
    // `toolbar: false` — no toolbar button, but `:` suggestion picker still works
    Emoji.configure({
      emojis,
      enableEmoticons: true,
      toolbar: false,
      suggestion: { render: createEmojiSuggestionRenderer() },
    }),
    Mention.configure({
      suggestion: {
        char: '@',
        name: 'user',
        items: ({ query }: { query: string }) =>
          mockUsers.filter((u) => u.label.toLowerCase().includes(query.toLowerCase())),
        render: createMentionSuggestionRenderer(),
        minQueryLength: 0,
        invalidNodes: ['codeBlock'],
      },
    }),
    LinkPopover, SelectionDecoration, ClearFormatting, Dropcursor,
    // Assigns stable IDs to top-level blocks so BlockContextMenu can offer
    // "Copy link to block" — the ID becomes the URL hash (e.g. `#abc123`).
    UniqueID,
    // Block-manipulation UX trio (Notion-style). All three share the
    // `addFloatingMenuItems()` hook items and are opt-in from the
    // `@domternal/extension-block-menu` package.
    BlockHandle,
    BlockContextMenu,
    KeyboardReorder,
    SlashCommand,
  ];

  editorContent = STARTER_CONTENT;
  editor = signal<Editor | null>(null);

  // Tracked so `ngOnDestroy` can remove it. Without this, repeatedly
  // mounting the component (HMR / route re-entry) would accumulate
  // listeners on the same `.dm-editor` DOM node.
  private copyLinkHost: HTMLElement | null = null;
  private copyLinkListener: ((event: Event) => void) | null = null;

  onEditorCreated(editor: Editor): void {
    this.editor.set(editor);
    // Expose for E2E + playing around in devtools.
    (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = editor;

    // Surface a toast when "Copy link to block" succeeds. Host apps own
    // this UX: BlockContextMenu only emits `dm:copy-link-success` (on
    // actual success) and `dm:copy-link-error` (on clipboard failure).
    const host = editor.view.dom.closest<HTMLElement>('.dm-editor');
    if (!host) return;
    this.copyLinkHost = host;
    this.copyLinkListener = (): void => {
      const toast = document.createElement('div');
      toast.className = 'notion-demo-toast';
      toast.textContent = 'Link copied';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 1800);
    };
    host.addEventListener('dm:copy-link-success', this.copyLinkListener);
  }

  ngOnDestroy(): void {
    if (this.copyLinkHost && this.copyLinkListener) {
      this.copyLinkHost.removeEventListener('dm:copy-link-success', this.copyLinkListener);
    }
    this.copyLinkHost = null;
    this.copyLinkListener = null;
  }
}
