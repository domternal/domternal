import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
} from '@domternal/extension-block-menu';
import type { BlockMatcher, BlockCandidate } from '@domternal/extension-block-menu';
import { TableOfContents, FloatingTocOutline, TableOfContentsBlock } from '@domternal/extension-toc';
import type { IconSet } from '@domternal/core';
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

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

const getStyledHtml = (html: string): string => {
  return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
};

export interface NotionDemoProps {
  /** Cap the page wrapper height and scroll its content internally. Adds
   * `notion-page--scrollable` and wires `activeScrollParent` so the TOC
   * scroll-spy follows the host scroll instead of the window. */
  scrollable?: boolean;
}

/**
 * Notion-style demo: no toolbar, floating menu on empty lines is the primary
 * block-insert UI, bubble menu for text formatting on selection. Mirrors
 * `apps/demo-angular/src/app/notion-demo/notion-demo.component.ts`.
 */
export function NotionDemo({ scrollable = false }: NotionDemoProps): ReactNode {
  // Capture the page wrapper element via a state-based ref. In scrollable
  // mode the TOC needs this element to wire `activeScrollParent`; React
  // can only hand it to us after first paint, so the editor recreates
  // once when the ref resolves. Non-scrollable mode never reads it.
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);

  const extensions = useMemo<AnyExtension[]>(
    () => buildExtensions(scrollable ? pageEl : null),
    [scrollable, pageEl],
  );

  const { editor, editorRef } = useEditor({
    extensions,
    content: NOTION_DEMO_CONTENT,
  });

  const { htmlContent } = useEditorState(editor);

  const [toasts, setToasts] = useState<Toast[]>([]);

  // E2E fixture for bubble menu icons override.
  const [bubbleIcons, setBubbleIcons] = useState<IconSet | undefined>(() =>
    resolveBubbleIcons(parseBubbleIconsParam()),
  );

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w['__DEMO_SET_BUBBLE_ICONS__'] = (key: BubbleIconsParam | null): void => {
      setBubbleIcons(resolveBubbleIcons(key));
    };
    return () => { w['__DEMO_SET_BUBBLE_ICONS__'] = undefined; };
  }, []);

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
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, TOAST_MS[kind]);
    };

    host?.addEventListener('dm:copy-link-success', () => {
      pushToast('Link copied', 'success');
    }, { signal });
    host?.addEventListener('dm:copy-link-error', () => {
      pushToast('Failed to copy link', 'error');
    }, { signal });

    return () => {
      controller.abort();
      // Only clear when our editor is still the one on the window. StrictMode
      // dev double-mount can land the second mount's assignment BEFORE the
      // first mount's cleanup; an unconditional clear would leave the window
      // pointing at undefined while the live editor is fine.
      if (w['__DEMO_EDITOR__'] === editor) {
        w['__DEMO_EDITOR__'] = undefined;
        w['__DOMTERNAL_LIST_CTX__'] = undefined;
      }
    };
  }, [editor]);

  return (
    <>
      <div className="app-notion-demo">
        <div
          ref={setPageEl}
          className={scrollable ? 'notion-page notion-page--scrollable' : 'notion-page'}
        >
          <div className="dm-editor dm-notion-mode">
            <div ref={editorRef} />
          </div>

          {editor && (
            <>
              <DomternalBubbleMenu editor={editor} icons={bubbleIcons} />
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
