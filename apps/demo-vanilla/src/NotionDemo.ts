import {
  DomternalEditor,
  DomternalBubbleMenu,
  DomternalFloatingMenu,
  DomternalNotionColorPicker,
} from '@domternal/vanilla';
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
  inlineStyles,
  getListItemCursorContext,
  type AnyExtension,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { MathInline, MathBlock, createKatexRenderer } from '@domternal/extension-math';
import { Details } from '@domternal/extension-details';
import { Table } from '@domternal/extension-table';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';
import type { MentionItem } from '@domternal/extension-mention';
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
import { createLowlight, common } from 'lowlight';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { NOTION_DEMO_CONTENT } from './notion-demo-content.js';
import {
  parseBubbleIconsParam,
  resolveBubbleIcons,
  type BubbleIconsParam,
} from './bubble-icons-fixtures.js';

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
 * Parents whose direct paragraph children should NOT surface their own drag
 * handle - the container itself is the meaningful drag unit. Module scope
 * so the matcher's `test` callback doesn't allocate per candidate.
 */
const PARAGRAPH_EXCLUSION_PARENTS = new Set([
  'blockquote', 'tableCell', 'tableHeader', 'tableRow', 'details', 'detailsContent',
]);

/**
 * Toast display durations (ms). Error toast lingers ~50% longer because it
 * carries diagnostic copy users may want to read; success is shorter.
 */
const TOAST_MS = { success: 1800, error: 2600 } as const;

const buildExtensions = (scrollParent: Element | null): AnyExtension[] => [
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
  Placeholder.configure({
    placeholder: ({ node }: { node: { type: { name: string } } }) =>
      node.type.name === 'paragraph' ? "Press '/' for commands" : '',
  }),
];

/**
 * Notion-style demo. No toolbar - floating menu on empty lines is the primary
 * block-insert UI, bubble menu for text formatting on selection. Mirrors
 * `apps/demo-react/src/NotionDemo.tsx` and `apps/demo-angular/src/app/notion-demo/notion-demo.component.ts`.
 *
 * DOM chain: `.app-notion-demo > .notion-page > .dm-editor > [editorRef]`
 * (the editor's preset: 'notion' paints dm-notion-mode on the .dm-editor shell)
 *
 * Toast system: listens for `dm:copy-link-success` / `dm:copy-link-error`
 * dispatched by `BlockContextMenu`'s "Copy link" action; renders fixed-position
 * toasts to `document.body` with auto-dismiss.
 *
 * E2E exposure: `window.__DEMO_EDITOR__` + `window.__DOMTERNAL_LIST_CTX__`.
 */
export interface NotionDemoOptions {
  /** Cap the page wrapper height and scroll its content internally. Adds
   * `notion-page--scrollable` and wires `activeScrollParent`. */
  scrollable?: boolean;
}

export class NotionDemo {
  #container: HTMLElement;
  #editorWrapper: DomternalEditor;
  #bubbleMenu: DomternalBubbleMenu;
  #floatingMenu: DomternalFloatingMenu;
  #colorPicker: DomternalNotionColorPicker;

  #htmlPre: HTMLPreElement;
  #styledPre: HTMLPreElement;

  #toastsAbortCtl = new AbortController();
  #activeToasts = new Set<HTMLDivElement>();
  #toastTimeouts = new Set<ReturnType<typeof setTimeout>>();

  #updateOff: () => void;
  #destroyed = false;

  constructor(container: HTMLElement, options: NotionDemoOptions = {}) {
    this.#container = container;
    const scrollable = options.scrollable === true;

    // DOM chain: .app-notion-demo > .notion-page > .dm-editor > [editorHost]
    const notionDemo = document.createElement('div');
    notionDemo.className = 'app-notion-demo';
    const notionPage = document.createElement('div');
    notionPage.className = scrollable ? 'notion-page notion-page--scrollable' : 'notion-page';
    const editorShell = document.createElement('div');
    // The Notion class comes from the editor's preset: 'notion', not from here.
    editorShell.className = 'dm-editor';
    const editorHost = document.createElement('div');
    editorShell.appendChild(editorHost);
    notionPage.appendChild(editorShell);
    notionDemo.appendChild(notionPage);

    const bubbleHost = document.createElement('div');
    notionPage.appendChild(bubbleHost);

    const floatingHost = document.createElement('div');
    notionPage.appendChild(floatingHost);

    container.appendChild(notionDemo);

    this.#editorWrapper = new DomternalEditor(editorHost, {
      // Scrollable mode tracks the host; full-height mode tracks window.
      extensions: buildExtensions(scrollable ? notionPage : null),
      content: NOTION_DEMO_CONTENT,
      // Paints dm-notion-mode on the shell and switches preset-aware
      // extensions (bubble contexts, image placement) to their Notion behavior.
      preset: 'notion',
    });
    const editor = this.#editorWrapper.editor;

    const initialIcons = resolveBubbleIcons(parseBubbleIconsParam());
    this.#bubbleMenu = new DomternalBubbleMenu(bubbleHost, {
      editor,
      ...(initialIcons ? { icons: initialIcons } : {}),
    });
    (window as unknown as Record<string, unknown>).__DEMO_SET_BUBBLE_ICONS__ =
      (key: BubbleIconsParam | null): void => {
        this.#bubbleMenu.setIcons(resolveBubbleIcons(key));
      };
    this.#floatingMenu = new DomternalFloatingMenu(floatingHost, {
      editor,
      requireExplicitTrigger: true,
    });
    this.#colorPicker = new DomternalNotionColorPicker({ editor });

    // Output panes
    const htmlHeader = document.createElement('h3');
    htmlHeader.textContent = 'HTML Output';
    container.appendChild(htmlHeader);
    this.#htmlPre = document.createElement('pre');
    this.#htmlPre.className = 'output';
    container.appendChild(this.#htmlPre);

    const styledHeader = document.createElement('h3');
    styledHeader.textContent = 'Styled HTML Output';
    container.appendChild(styledHeader);
    this.#styledPre = document.createElement('pre');
    this.#styledPre.className = 'output-styled';
    container.appendChild(this.#styledPre);

    // Update handler - refresh outputs per transaction
    const onUpdate = (): void => { this.#refreshOutputs(); };
    this.#editorWrapper.addEventListener('update', onUpdate);
    this.#editorWrapper.addEventListener('create', onUpdate);
    this.#updateOff = (): void => {
      this.#editorWrapper.removeEventListener('update', onUpdate);
      this.#editorWrapper.removeEventListener('create', onUpdate);
    };

    // E2E exposure
    const w = window as unknown as Record<string, unknown>;
    w.__DEMO_EDITOR__ = editor;
    w.__DOMTERNAL_LIST_CTX__ = getListItemCursorContext;

    // Toast wiring on the editor host
    const editorEl = editor.view.dom.closest<HTMLElement>('.dm-editor');
    const { signal } = this.#toastsAbortCtl;
    editorEl?.addEventListener(
      'dm:copy-link-success',
      () => { this.#pushToast('Link copied', 'success'); },
      { signal },
    );
    editorEl?.addEventListener(
      'dm:copy-link-error',
      () => { this.#pushToast('Failed to copy link', 'error'); },
      { signal },
    );

    this.#refreshOutputs();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#updateOff();
    this.#toastsAbortCtl.abort();

    // Clear pending toast timeouts + remove DOM nodes from body
    for (const tid of this.#toastTimeouts) clearTimeout(tid);
    this.#toastTimeouts.clear();
    for (const el of this.#activeToasts) el.remove();
    this.#activeToasts.clear();

    this.#colorPicker.destroy();
    this.#floatingMenu.destroy();
    this.#bubbleMenu.destroy();
    this.#editorWrapper.destroy();

    // Only clear when our editor is still the one on the window. Matches
    // the React StrictMode-safe pattern (cf. demo-react NotionDemo.tsx).
    const w = window as unknown as Record<string, unknown>;
    if (w.__DEMO_EDITOR__ === this.#editorWrapper.editor) {
      w.__DEMO_EDITOR__ = undefined;
      w.__DOMTERNAL_LIST_CTX__ = undefined;
    }
    w.__DEMO_SET_BUBBLE_ICONS__ = undefined;

    this.#container.replaceChildren();
  }

  // === Internal ===

  #refreshOutputs(): void {
    const html = this.#editorWrapper.htmlContent;
    this.#htmlPre.textContent = html;
    this.#styledPre.textContent = html
      ? inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' })
      : '';
  }

  #pushToast(message: string, kind: 'success' | 'error'): void {
    if (this.#destroyed) return;
    const el = document.createElement('div');
    el.className = `notion-demo-toast${kind === 'error' ? ' notion-demo-toast--error' : ''}`;
    el.setAttribute('role', kind === 'success' ? 'status' : 'alert');
    el.textContent = message;
    document.body.appendChild(el);
    this.#activeToasts.add(el);

    const ms = TOAST_MS[kind];
    const tid = setTimeout(() => {
      el.remove();
      this.#activeToasts.delete(el);
      this.#toastTimeouts.delete(tid);
    }, ms);
    this.#toastTimeouts.add(tid);
  }
}
