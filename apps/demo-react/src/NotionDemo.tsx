import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  useEditor,
  useEditorState,
  DomternalBubbleMenu,
  DomternalFloatingMenu,
  DomternalNotionColorPicker,
} from '@domternal/react';
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
  inlineStyles,
  getListItemCursorContext,
} from '@domternal/core';
import { CodeBlockLowlight, createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
import { Image } from '@domternal/extension-image';
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
} from '@domternal/extension-block-menu';
import type { BlockMatcher, BlockCandidate } from '@domternal/extension-block-menu';
import { TableOfContents, FloatingTocOutline, TableOfContentsBlock } from '@domternal/extension-toc';
import { createLowlight, common } from 'lowlight';
import { NOTION_DEMO_CONTENT } from './notion-demo-content.js';

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
 * Parents whose direct paragraph children should NOT surface their own
 * drag handle - the container itself is the meaningful drag unit. Module
 * scope so the matcher's `test` callback doesn't allocate per candidate.
 */
const PARAGRAPH_EXCLUSION_PARENTS = new Set([
  'blockquote', 'tableCell', 'tableHeader', 'tableRow', 'details', 'detailsContent',
]);

/**
 * Toast display durations (ms). Error toast lingers ~50% longer because it
 * carries diagnostic copy users may want to read; success is shorter to
 * stay out of the way.
 */
const TOAST_MS = { success: 1800, error: 2600 } as const;

const extensions = [
  // Inline formatting (available via bubble menu on selection)
  Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
  // Block elements (inserted via floating menu on empty lines)
  Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList,
  // Text styling (available via bubble menu)
  TextAlign, TextColor, FontSize, FontFamily, LineHeight,
  // Notion-style token-based color picker. Drives the colorToken /
  // backgroundColorToken attrs on textStyle (theme-aware named colors).
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
  // helper), so we omit `Dropcursor` here.
  LinkPopover, SelectionDecoration, ClearFormatting,
  // ListIndent: Tab on a top-level block whose previous sibling is a list
  // moves it INTO the last list item as a nested child; Shift-Tab lifts
  // it back out. Registered AFTER the list extensions (which carry the
  // in-item Tab/Shift-Tab keymap) so those keep priority inside list items.
  ListIndent,
  // Assigns stable IDs to top-level blocks so BlockContextMenu can offer
  // "Copy link to block" - the ID becomes the URL hash (e.g. `#abc123`).
  UniqueID,
  // Block-level text + background colors (Notion palette). Exposed via
  // the BlockContextMenu's Colors section when this extension is loaded.
  BlockColor,
  // Block-manipulation UX trio (Notion-style). The custom
  // `paragraphInsideContainer` matcher keeps blockquote / table cells /
  // details as one drag unit (paragraphs nested in list items remain
  // individually draggable since they were Tab-indented as separate
  // logical blocks).
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
  // Preserve block formatting when pasting at inline positions (the
  // classic "copy h1, Shift+Enter, paste -> loses heading" case).
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

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

const getStyledHtml = (html: string): string => {
  return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
};

/**
 * Notion-style demo: no toolbar, floating menu on empty lines is the primary
 * block-insert UI, bubble menu for text formatting on selection. Mirrors
 * `apps/demo-angular/src/app/notion-demo/notion-demo.component.ts`.
 */
export function NotionDemo(): ReactNode {
  const { editor, editorRef } = useEditor({
    extensions,
    content: NOTION_DEMO_CONTENT,
  });

  const { htmlContent } = useEditorState(editor);

  const [toasts, setToasts] = useState<Toast[]>([]);

  // Expose editor + cursor-context util on window for e2e, and wire the
  // copy-link toast listeners. Cleanup detaches everything; StrictMode dev
  // double-mount is benign because the second mount re-sets the same editor.
  useEffect(() => {
    if (!editor) return;

    const w = window as unknown as Record<string, unknown>;
    w['__DEMO_EDITOR__'] = editor;
    w['__DOMTERNAL_LIST_CTX__'] = getListItemCursorContext;

    const host = editor.view.dom.closest<HTMLElement>('.dm-editor');
    const controller = new AbortController();
    const { signal } = controller;

    const pushToast = (message: string, kind: Toast['kind']): void => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, kind }]);
      const ms = kind === 'success' ? TOAST_MS.success : TOAST_MS.error;
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, ms);
    };

    host?.addEventListener('dm:copy-link-success', () => {
      pushToast('Link copied', 'success');
    }, { signal });
    host?.addEventListener('dm:copy-link-error', () => {
      pushToast('Failed to copy link', 'error');
    }, { signal });

    return () => {
      controller.abort();
      w['__DEMO_EDITOR__'] = undefined;
      w['__DOMTERNAL_LIST_CTX__'] = undefined;
    };
  }, [editor]);

  return (
    <>
      <div className="app-notion-demo">
        <div className="notion-page">
          <div className="dm-editor dm-notion-mode">
            <div ref={editorRef} />
          </div>

          {editor && (
            <>
              <DomternalBubbleMenu editor={editor} />
              <DomternalFloatingMenu editor={editor} requireExplicitTrigger />
              <DomternalNotionColorPicker editor={editor} />
            </>
          )}
        </div>
      </div>

      <h3>HTML Output</h3>
      <pre className="output">{htmlContent}</pre>

      <h3>Styled HTML Output</h3>
      <pre className="output-styled">{htmlContent ? getStyledHtml(htmlContent) : ''}</pre>

      {toasts.length > 0 && createPortal(
        <>
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === 'success' ? 'status' : 'alert'}
              className={`notion-demo-toast${t.kind === 'error' ? ' notion-demo-toast--error' : ''}`}
            >
              {t.message}
            </div>
          ))}
        </>,
        document.body,
      )}
    </>
  );
}
