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
  BlockColor,
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

<h2>Playground</h2>
<p>Hover any block in this page to reveal the drag handle on the left. Grab it to reorder the block, or click it to open actions: <strong>Delete</strong>, <strong>Duplicate</strong>, <strong>Copy link</strong>, block colors, and <strong>Turn into</strong>.</p>
<p>You can also press <code>Mod+Shift+↑</code> / <code>Mod+Shift+↓</code> to move the current block without the mouse.</p>

<h2>Things to try</h2>
<ul>
  <li><p>Drag this list item above another one - nested handles are enabled</p></li>
  <li><p>Click the drag handle, open Colors, pick yellow background</p></li>
  <li><p>Type <code>/</code> on an empty line to insert a new block</p></li>
</ul>

<h2>Checklist</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Basic formatting (bold, italic, code, link)</p></li>
  <li data-type="taskItem" data-checked="true"><p>Block drag handle + context menu</p></li>
  <li data-type="taskItem" data-checked="false">
    <p>AI autocomplete integration</p>
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="true"><p>Wire up provider abstraction</p></li>
      <li data-type="taskItem" data-checked="false"><p>Streaming completions</p></li>
      <li data-type="taskItem" data-checked="false"><p>Inline accept/reject UI</p></li>
    </ul>
  </li>
  <li data-type="taskItem" data-checked="false"><p>Real-time collaboration</p></li>
</ul>

<h2>A quote</h2>
<blockquote><p>Simplicity is the ultimate sophistication.</p></blockquote>

<h2>Sample code</h2>
<pre><code class="language-typescript">function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
</code></pre>

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
    // Block-level text + background colors (Notion palette). Exposed via
    // the BlockContextMenu's Colors section when this extension is loaded.
    BlockColor,
    // Block-manipulation UX trio (Notion-style). All three share the
    // `addFloatingMenuItems()` hook items and are opt-in from the
    // `@domternal/extension-block-menu` package.
    // `nested: true` gives individual drag handles for list items + task
    // items so users can reorder a single bullet without grabbing the
    // whole list.
    BlockHandle.configure({ nested: true }),
    BlockContextMenu,
    KeyboardReorder,
    SlashCommand,
  ];

  editorContent = STARTER_CONTENT;
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

    // Tear down any previously-attached listeners before wiring new ones —
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
      this.showToast('Link copied', 'status', 'notion-demo-toast', 1800);
    };
    this.copyLinkErrorListener = (): void => {
      this.showToast('Failed to copy link', 'alert', 'notion-demo-toast notion-demo-toast--error', 2600);
    };
    host.addEventListener('dm:copy-link-success', this.copyLinkSuccessListener);
    host.addEventListener('dm:copy-link-error', this.copyLinkErrorListener);
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
