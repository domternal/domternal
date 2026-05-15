import { Component, ChangeDetectionStrategy, OnDestroy, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalBubbleMenuComponent,
  DomternalFloatingMenuComponent,
  DomternalNotionColorPickerComponent,
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
  ListIndent,
  Heading,
  Blockquote,
  HardBreak,
  HorizontalRule,
  BulletList,
  OrderedList,
  TaskList,
  TextAlign,
  TextColor,
  NotionColorPicker,
  FontSize,
  FontFamily,
  LineHeight,
  SelectionDecoration,
  ClearFormatting,
  UniqueID,
  BlockColor,
  Placeholder,
  Editor,
  inlineStyles,
  getListItemCursorContext,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
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
  SmartPaste,
} from '@domternal/extension-block-menu';
import type { BlockMatcher, BlockCandidate } from '@domternal/extension-block-menu';
import { TableOfContents, FloatingTocOutline, TableOfContentsBlock } from '@domternal/extension-toc';
import { NOTION_DEMO_CONTENT } from './notion-demo-content.js';

/**
 * Parents whose direct paragraph children should NOT surface their own
 * drag handle - the container itself is the meaningful drag unit. Hoisted
 * to module scope so the rule's `evaluate` callback doesn't allocate a
 * new Set per candidate node during hover walks.
 */
const PARAGRAPH_EXCLUSION_PARENTS = new Set([
  'blockquote', 'tableCell', 'tableHeader', 'tableRow', 'details', 'detailsContent',
]);
import type { MentionItem } from '@domternal/extension-mention';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);
const codeHighlighter = createCodeHighlighter(lowlight);

const mockUsers: MentionItem[] = [
  { id: '1', label: 'Alice Johnson' },
  { id: '2', label: 'Bob Smith' },
  { id: '3', label: 'Charlie Brown' },
  { id: '4', label: 'Diana Prince' },
  { id: '5', label: 'Eve Adams' },
];

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
    DomternalNotionColorPickerComponent,
  ],
  templateUrl: './notion-demo.component.html',
  styleUrls: ['./notion-demo.component.scss'],
})
export class NotionDemoComponent implements OnDestroy {
  /**
   * Toast display durations (ms). Error toast lingers ~50% longer because it
   * carries diagnostic copy users may want to read; success is shorter to
   * stay out of the way.
   */
  private static readonly TOAST_MS = { success: 1800, error: 2600 };

  extensions = [
    // Inline formatting (available via bubble menu on selection)
    Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
    // Block elements (inserted via floating menu on empty lines)
    Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
    BulletList, OrderedList, TaskList,
    // Text styling - available via bubble menu
    TextAlign, TextColor, FontSize, FontFamily, LineHeight,
    // Notion-style token-based color picker. Drives the colorToken /
    // backgroundColorToken attrs on textStyle (theme-aware named colors).
    // UI lives in the bubble-menu wrapper and is introduced in Phase 4.
    NotionColorPicker,
    Table,
    Details,
    Image,
    // `toolbar: false` - no toolbar button, but `:` suggestion picker still works
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
    // BlockHandle ships its own custom drop indicator that mirrors EXACTLY
    // where the drop will land (via the shared `computeDropPlacement`
    // helper), so we omit `Dropcursor` here. See `dropIndicator` option.
    LinkPopover, SelectionDecoration, ClearFormatting,
    // ListIndent: Notion-inspired keyboard ergonomics across list
    // boundaries. Tab on a top-level block whose previous sibling is a
    // list moves it INTO the last list item as a nested child;
    // Shift-Tab lifts it back out. Registered AFTER ListKeymap (which
    // here lives implicitly inside BulletList/OrderedList/TaskList
    // node extensions) so in-list-item Tab/Shift-Tab keep priority.
    ListIndent,
    // Assigns stable IDs to top-level blocks so BlockContextMenu can offer
    // "Copy link to block" - the ID becomes the URL hash (e.g. `#abc123`).
    UniqueID,
    // Block-level text + background colors (Notion palette). Exposed via
    // the BlockContextMenu's Colors section when this extension is loaded.
    BlockColor,
    // Block-manipulation UX trio (Notion-style). All three share the
    // `addFloatingMenuItems()` hook items and are opt-in from the
    // `@domternal/extension-block-menu` package.
    //
    // BlockHandle: nested drag handles. The default matchers
    // (`firstChildOfListItem`) keep label paragraphs from competing with
    // their list item; the custom `paragraphInsideContainer` matcher keeps
    // blockquote / table cells / details as one drag unit (paragraphs
    // nested in list items remain individually draggable - they were
    // Tab-indented as separate logical blocks).
    BlockHandle.configure({
      nested: {
        allowedNodes: [
          'listItem', 'taskItem',
          'heading', 'paragraph', 'codeBlock', 'blockquote', 'horizontalRule',
        ],
        matchers: [
          {
            name: 'paragraphInsideContainer',
            test: ({ block, container }: BlockCandidate) =>
              block.type.name === 'paragraph'
                && container !== null
                && PARAGRAPH_EXCLUSION_PARENTS.has(container.type.name)
                ? 'reject'
                : 'allow',
          } satisfies BlockMatcher,
        ],
      },
    }),
    BlockContextMenu,
    KeyboardReorder,
    SlashCommand,
    // Preserve block formatting when pasting at inline positions
    // (the classic "copy h1, Shift+Enter, paste → loses heading" case).
    SmartPaste,
    // Notion-style Table of Contents: data layer + right-rail outline
    // + inline /toc block. All three opt-in.
    TableOfContents,
    FloatingTocOutline,
    TableOfContentsBlock,
    // Notion-style hint on the focused empty paragraph only. Other empty
    // blocks (heading, codeBlock, blockquote) get an empty string so the
    // hint stays diskretno - not on every block in the document.
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'paragraph' ? "Press '/' for commands" : '',
    }),
  ];

  editorContent = NOTION_DEMO_CONTENT;
  editor = signal<Editor | null>(null);

  // Tracked so `ngOnDestroy` and subsequent `onEditorCreated` calls can
  // remove listeners before adding new ones. Without this, repeatedly
  // mounting the component (HMR / route re-entry) would accumulate
  // listeners on the same `.dm-editor` DOM node.
  private copyLinkHost: HTMLElement | null = null;
  private copyLinkSuccessListener: ((event: Event) => void) | null = null;
  private copyLinkErrorListener: ((event: Event) => void) | null = null;

  onEditorCreated(editor: Editor): void {
    this.editor.set(editor);
    // Expose for E2E + playing around in devtools.
    (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = editor;
    // Expose getListItemCursorContext for E2E coverage of the pure
    // utility - lets tests verify the util resolves correctly when run
    // against the built dist (not just the unit-test source path).
    (window as unknown as Record<string, unknown>)['__DOMTERNAL_LIST_CTX__'] = getListItemCursorContext;

    // Tear down any previously-attached listeners before wiring new ones -
    // protects against leaking listeners when the editor is recreated
    // (HMR, re-entering the route, etc.).
    this.removeCopyLinkListeners();

    // Surface toasts when "Copy link to block" succeeds or fails. Host apps
    // own this UX: BlockContextMenu only emits `dm:copy-link-success` (on
    // actual success) and `dm:copy-link-error` (on clipboard failure).
    const host = editor.view.dom.closest<HTMLElement>('.dm-editor');
    if (!host) return;
    this.copyLinkHost = host;

    this.copyLinkSuccessListener = (): void => {
      this.showToast('Link copied', 'status', 'notion-demo-toast', NotionDemoComponent.TOAST_MS.success);
    };
    this.copyLinkErrorListener = (): void => {
      this.showToast('Failed to copy link', 'alert', 'notion-demo-toast notion-demo-toast--error', NotionDemoComponent.TOAST_MS.error);
    };
    host.addEventListener('dm:copy-link-success', this.copyLinkSuccessListener);
    host.addEventListener('dm:copy-link-error', this.copyLinkErrorListener);
  }

  /** Inline-style the live HTML output for the "Styled HTML" pane. */
  getStyledHtml(html: string): string {
    return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
  }

  ngOnDestroy(): void {
    this.removeCopyLinkListeners();
    this.copyLinkHost = null;
  }

  private removeCopyLinkListeners(): void {
    if (!this.copyLinkHost) return;
    if (this.copyLinkSuccessListener) {
      this.copyLinkHost.removeEventListener('dm:copy-link-success', this.copyLinkSuccessListener);
      this.copyLinkSuccessListener = null;
    }
    if (this.copyLinkErrorListener) {
      this.copyLinkHost.removeEventListener('dm:copy-link-error', this.copyLinkErrorListener);
      this.copyLinkErrorListener = null;
    }
  }

  private showToast(message: string, role: 'status' | 'alert', className: string, durationMs: number): void {
    const toast = document.createElement('div');
    toast.className = className;
    toast.textContent = message;
    toast.setAttribute('role', role);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }
}
