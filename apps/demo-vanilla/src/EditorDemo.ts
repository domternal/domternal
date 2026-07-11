import {
  DomternalEditor,
  DomternalToolbar,
  DomternalBubbleMenu,
  DomternalFloatingMenu,
  DomternalEmojiPicker,
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
  inlineStyles,
  type AnyExtension,
  type ToolbarLayoutEntry,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
import { MathInline, MathBlock, createKatexRenderer } from '@domternal/extension-math';
import { Details } from '@domternal/extension-details';
import { Table } from '@domternal/extension-table';
import { Emoji, emojis, createEmojiSuggestionRenderer } from '@domternal/extension-emoji';
import { Mention, createMentionSuggestionRenderer } from '@domternal/extension-mention';
import type { MentionItem } from '@domternal/extension-mention';
import { createLowlight, common } from 'lowlight';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { DEMO_CONTENT } from './demo-content.js';
import {
  parseBubbleIconsParam,
  parseBubbleItemsParam,
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
  { id: '6', label: 'Frank Castle' },
  { id: '7', label: 'Grace Hopper' },
  { id: '8', label: 'Henry Ford' },
];

const params = new URLSearchParams(window.location.search);
const constrainTable = !params.has('constrainTable', 'false');
const resizeBehavior = (params.get('resizeBehavior') ?? 'neighbor') as 'neighbor' | 'independent' | 'redistribute';
const emojiToolbar = params.get('emojiToolbar') !== 'false';
const bubbleAuto = params.get('bubbleAuto') === 'true';

const buildExtensions = (): AnyExtension[] => [
  Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
  Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList,
  TextAlign, TextColor, FontSize, FontFamily, LineHeight,
  Table.configure({ constrainToContainer: constrainTable, resizeBehavior }),
  Details,
  Image,
  MathInline.configure({ renderer: mathRenderer }),
  MathBlock.configure({ renderer: mathRenderer }),
  Emoji.configure({ emojis, enableEmoticons: true, toolbar: emojiToolbar, suggestion: { render: createEmojiSuggestionRenderer() } }),
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
  LinkPopover, InvisibleChars, SelectionDecoration, ClearFormatting, Dropcursor,
];

/** Custom toolbar layout used when `useLayout: true`. Matches demo-react. */
const TOOLBAR_LAYOUT: ToolbarLayoutEntry[] = [
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

export interface EditorDemoOptions {
  useLayout: boolean;
}

/**
 * Classic / Custom-layout editor demo. Mirrors `apps/demo-react/src/EditorDemo.tsx`:
 * mounts editor + toolbar + bubble menu + floating menu + emoji picker, surfaces
 * selector state for e2e and live HTML / styled-HTML output panes.
 *
 * Lifecycle:
 *  - Constructor builds DOM + instantiates wrappers.
 *  - `destroy()` tears down wrappers + clears `window.__DEMO_EDITOR__`.
 */
export class EditorDemo {
  #container: HTMLElement;
  #editorWrapper: DomternalEditor;
  #toolbar: DomternalToolbar;
  #bubbleMenu: DomternalBubbleMenu;
  #floatingMenu: DomternalFloatingMenu;
  #emojiPicker: DomternalEmojiPicker;

  // Output / state panes
  #htmlPre: HTMLPreElement;
  #styledPre: HTMLPreElement;
  #isBoldEl: HTMLSpanElement;
  #isItalicEl: HTMLSpanElement;
  #isEmptyEl: HTMLSpanElement;

  // Cleanup
  #updateOff: () => void;
  #destroyed = false;

  constructor(container: HTMLElement, options: EditorDemoOptions) {
    this.#container = container;

    // Build DOM scaffold
    const toolbarHost = document.createElement('div');
    container.appendChild(toolbarHost);

    const editorShell = document.createElement('div');
    editorShell.className = 'dm-editor';
    const editorHost = document.createElement('div');
    editorShell.appendChild(editorHost);
    container.appendChild(editorShell);

    const bubbleHost = document.createElement('div');
    container.appendChild(bubbleHost);

    const floatingHost = document.createElement('div');
    container.appendChild(floatingHost);

    const emojiHost = document.createElement('div');
    container.appendChild(emojiHost);

    // Editor + UI wrappers
    this.#editorWrapper = new DomternalEditor(editorHost, {
      extensions: buildExtensions(),
      content: DEMO_CONTENT,
    });
    const editor = this.#editorWrapper.editor;

    this.#toolbar = new DomternalToolbar(toolbarHost, {
      editor,
      ...(options.useLayout && { layout: TOOLBAR_LAYOUT }),
    });

    // E2E fixture: ?bubble-icons= URL param + window.__DEMO_SET_BUBBLE_ICONS__ runtime hook.
    const initialIcons = resolveBubbleIcons(parseBubbleIconsParam());
    const initialItems = parseBubbleItemsParam();
    this.#bubbleMenu = new DomternalBubbleMenu(bubbleHost, {
      editor,
      ...(bubbleAuto || initialItems
        ? {}
        : { contexts: { text: ['bold', 'italic', 'underline', 'strike', 'code'] } }),
      ...(initialItems ? { items: initialItems } : {}),
      ...(initialIcons ? { icons: initialIcons } : {}),
    });

    (window as unknown as Record<string, unknown>).__DEMO_SET_BUBBLE_ICONS__ =
      (key: BubbleIconsParam | null): void => {
        this.#bubbleMenu.setIcons(resolveBubbleIcons(key));
      };

    this.#floatingMenu = new DomternalFloatingMenu(floatingHost, { editor });

    this.#emojiPicker = new DomternalEmojiPicker(emojiHost, { editor, emojis });

    // Selector state pane (test fixture for e2e)
    const stateHeader = document.createElement('h3');
    stateHeader.textContent = 'Selector State (transaction-driven)';
    container.appendChild(stateHeader);

    const stateRow = document.createElement('div');
    stateRow.className = 'selector-state';
    stateRow.dataset.testid = 'selector-state';
    this.#isBoldEl = document.createElement('span');
    this.#isBoldEl.dataset.testid = 'is-bold';
    this.#isItalicEl = document.createElement('span');
    this.#isItalicEl.dataset.testid = 'is-italic';
    this.#isEmptyEl = document.createElement('span');
    this.#isEmptyEl.dataset.testid = 'is-empty';
    stateRow.append(this.#isBoldEl, this.#isItalicEl, this.#isEmptyEl);
    container.appendChild(stateRow);

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

    // Update handler - refresh outputs + selector state per transaction
    const onUpdate = (): void => { this.#refreshOutputs(); };
    // Refresh on every core transaction rather than the wrapper's filtered
    // 'update'/'selectionchange' events: those skip quiet programmatic writes
    // (setContent(content, false) sets skipUpdate), which would leave the
    // output and selector panes stale. One handler covers edits, selection,
    // and programmatic writes alike.
    editor.on('transaction', onUpdate);
    this.#updateOff = (): void => {
      editor.off('transaction', onUpdate);
    };

    // E2E exposure
    (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ = editor;

    // Initial paint
    this.#refreshOutputs();
  }

  /**
   * Swap the toolbar layout without destroying the editor (preserves content
   * and cursor state). Used by the parent `App` when toggling between
   * default and custom modes.
   */
  setUseLayout(useLayout: boolean): void {
    if (this.#destroyed) return;
    this.#toolbar.setLayout(useLayout ? TOOLBAR_LAYOUT : undefined);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#updateOff();
    this.#emojiPicker.destroy();
    this.#floatingMenu.destroy();
    this.#bubbleMenu.destroy();
    this.#toolbar.destroy();
    this.#editorWrapper.destroy();

    (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ = undefined;
    (window as unknown as Record<string, unknown>).__DEMO_SET_BUBBLE_ICONS__ = undefined;

    this.#container.replaceChildren();
  }

  #refreshOutputs(): void {
    const editor = this.#editorWrapper.editor;
    const html = this.#editorWrapper.htmlContent;
    this.#htmlPre.textContent = html;
    this.#styledPre.textContent = html
      ? inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' })
      : '';
    this.#isBoldEl.textContent = `isBold: ${String(editor.isActive('bold'))}`;
    this.#isItalicEl.textContent = `isItalic: ${String(editor.isActive('italic'))}`;
    this.#isEmptyEl.textContent = `isEmpty: ${String(editor.isEmpty)}`;
  }
}
