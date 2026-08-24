import { Component, ChangeDetectionStrategy, ElementRef, OnDestroy, computed, input, signal, viewChild } from '@angular/core';
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
  Dropcursor,
  UniqueID,
  BlockColor,
  Placeholder,
  Editor,
  inlineStyles,
  getListItemCursorContext,
  defaultBubbleContexts,
  type BubbleContexts,
  type AnyExtension,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { MathInline, MathBlock, createKatexRenderer } from '@domternal/extension-math';
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
} from '@domternal/extension-block-controls';
import type { BlockMatcher, BlockCandidate } from '@domternal/extension-block-controls';
import { TableOfContents, FloatingTocOutline, TableOfContentsBlock } from '@domternal/extension-toc';
import { Markdown } from '@domternal/extension-markdown';
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
import type { IconSet } from '@domternal/core';
import { createLowlight, common } from 'lowlight';
import katex from 'katex';
import {
  bubbleOrderFixtureExtensions,
  parseBubbleIconsParam,
  resolveBubbleIcons,
  type BubbleIconsParam,
} from '../bubble-icons-fixtures.js';

const lowlight = createLowlight(common);
const codeHighlighter = createCodeHighlighter(lowlight);
const mathRenderer = createKatexRenderer(katex);

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

  /**
   * Cap the page wrapper height and scroll its content internally. Adds
   * `notion-page--scrollable` and wires `activeScrollParent` so the TOC
   * scroll-spy follows the host scroll instead of the window.
   */
  readonly scrollable = input(false);

  /**
   * Reference to the `.notion-page` wrapper. Resolved after first render;
   * the `extensions` computed below picks it up so the editor recreates
   * with the wired `activeScrollParent` when this signal resolves.
   */
  readonly pageElRef = viewChild<ElementRef<HTMLDivElement>>('pageEl');

  readonly extensions = computed<AnyExtension[]>(() => {
    const sp = this.scrollable() ? this.pageElRef()?.nativeElement ?? null : null;
    return NotionDemoComponent.buildExtensions(sp);
  });

  private static buildExtensions(scrollParent: Element | null): AnyExtension[] {
    return [
      ...bubbleOrderFixtureExtensions(),
      Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
      Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
      BulletList, OrderedList, TaskList,
      TextAlign, TextColor, FontSize, FontFamily, LineHeight,
      NotionColorPicker,
      Table,
      Details,
      Image,
      MathInline.configure({ renderer: mathRenderer }),
      MathBlock.configure({ renderer: mathRenderer }),
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
      LinkPopover, SelectionDecoration, ClearFormatting,
      // Native PM dropcursor; BlockHandle hides it during a handle drag so
      // only the custom `.dm-block-drop-indicator` shows. Kept loaded for
      // non-handle drops (text selection, external file drops).
      Dropcursor,
      // Registered after the list extensions so their in-item Tab/Shift-Tab
      // keymaps keep priority inside list items.
      ListIndent,
      UniqueID,
      BlockColor,
      // `paragraphInsideContainer` keeps containers (blockquote / tableCell /
      // details) as one drag unit. Paragraphs nested in listItem are NOT
      // covered because they were Tab-indented as separate logical blocks.
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
      SmartPaste,
      Markdown,
      TableOfContents,
      FloatingTocOutline.configure({ activeScrollParent: scrollParent }),
      TableOfContentsBlock,
      // Empty paragraphs get the slash hint; other empty blocks stay quiet so
      // the hint isn't repeated on every block.
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'paragraph' ? "Press '/' for commands" : '',
      }),
    ];
  }

  editorContent = NOTION_DEMO_CONTENT;
  editor = signal<Editor | null>(null);

  // E2E fixture for bubble menu icons override.
  readonly bubbleIcons = signal<IconSet | undefined>(resolveBubbleIcons(parseBubbleIconsParam()));

  /* The Notion default plus text alignment.
     Alignment is not in the default context: it needs `TextAlign`, which
     StarterKit does not ship, and Notion has no alignment control in its own
     selection menu. This demo registers the extension, so it names the item
     and gets the dropdown back. The documented way to extend the default
     rather than replace it, which is why it starts from the default rather
     than restating it. A computed and not a template call: a method in the
     template returns a fresh object on every change-detection pass and would
     rebuild the menu with it. */
  readonly bubbleContexts = computed<BubbleContexts>(() => {
    /* Typed as `BubbleContexts` and not as the narrower shape this actually
       returns, so the binding below exercises the whole published type: the
       Angular input lost the `null` that disables a context once, and a demo
       that only ever passes arrays would not have noticed.

       One return rather than a guard clause, because the input's published
       type has no `undefined` in it and the editor is never actually absent
       here: the binding lives inside the template's `@if (editor())`. */
    const ed = this.editor();
    const base = ed ? defaultBubbleContexts(ed)['text'] ?? [] : [];
    return { text: [...base, '|', 'textAlign'] };
  });

  constructor() {
    const w = window as unknown as Record<string, unknown>;
    w['__DEMO_SET_BUBBLE_ICONS__'] = (key: BubbleIconsParam | null): void => {
      this.bubbleIcons.set(resolveBubbleIcons(key));
    };
  }

  // AbortController scoped to one editor lifetime: `abort()` removes all
  // listeners attached with its signal. Recreated per `onEditorCreated`
  // so HMR / route re-entry can't leak listeners onto a stale host.
  private toastsAbortCtl = new AbortController();

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
    this.toastsAbortCtl.abort();
    this.toastsAbortCtl = new AbortController();
    const { signal } = this.toastsAbortCtl;

    // Surface toasts when "Copy link to block" succeeds or fails. Host apps
    // own this UX: BlockContextMenu only emits `dm:copy-link-success` (on
    // actual success) and `dm:copy-link-error` (on clipboard failure).
    const host = editor.view.dom.closest<HTMLElement>('.dm-editor');
    if (!host) return;
    host.addEventListener('dm:copy-link-success', () => this.pushToast('Link copied', 'success'), { signal });
    host.addEventListener('dm:copy-link-error', () => this.pushToast('Failed to copy link', 'error'), { signal });
  }

  /** Inline-style the live HTML output for the "Styled HTML" pane. */
  getStyledHtml(html: string): string {
    return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
  }

  ngOnDestroy(): void {
    this.toastsAbortCtl.abort();
    const w = window as unknown as Record<string, unknown>;
    w['__DEMO_SET_BUBBLE_ICONS__'] = undefined;
  }

  private pushToast(message: string, kind: 'success' | 'error'): void {
    const toast = document.createElement('div');
    toast.className = kind === 'success'
      ? 'notion-demo-toast'
      : 'notion-demo-toast notion-demo-toast--error';
    toast.textContent = message;
    toast.setAttribute('role', kind === 'success' ? 'status' : 'alert');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), NotionDemoComponent.TOAST_MS[kind]);
  }
}
