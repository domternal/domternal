import { useEffect } from 'react';
import {
  useEditor,
  useEditorState,
  DomternalToolbar,
  DomternalBubbleMenu,
  DomternalEmojiPicker,
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

const extensions = [
  Italic, Bold, Underline, Strike, Code, Highlight, Subscript, Superscript, Link,
  Heading, Blockquote, CodeBlockLowlight.configure({ lowlight }), HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList,
  TextAlign, TextColor, FontSize, FontFamily, LineHeight,
  Table,
  Details,
  Image,
  Emoji.configure({ emojis, enableEmoticons: true, suggestion: { render: createEmojiSuggestionRenderer() } }),
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
  LinkPopover, InvisibleChars, SelectionDecoration, ClearFormatting, Dropcursor,
];

const toolbarLayout: ToolbarLayoutEntry[] = [
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

export interface EditorDemoProps {
  useLayout: boolean;
}

export function EditorDemo({ useLayout }: EditorDemoProps) {
  const { editor, editorRef } = useEditor({
    extensions,
    content: DEMO_CONTENT,
  });

  const { htmlContent } = useEditorState(editor);

  // Expose editor on window for E2E test access (replaces Angular's ng.getComponent pattern)
  useEffect(() => {
    if (editor) {
      (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = editor;
    }
    return () => { (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = undefined; };
  }, [editor]);

  const getStyledHtml = (html: string): string => {
    return inlineStyles(html, { codeHighlighter, tableColumnWidths: 'pixel' });
  };

  return (
    <>
      {editor && (
        <>
          {useLayout ? (
            <DomternalToolbar editor={editor} layout={toolbarLayout} />
          ) : (
            <DomternalToolbar editor={editor} />
          )}
        </>
      )}

      <div className="dm-editor">
        <div ref={editorRef} />
      </div>

      {editor && (
        <>
          <DomternalBubbleMenu
            editor={editor}
            contexts={{ text: ['bold', 'italic', 'underline', 'strike', 'code'] }}
          />
          <DomternalEmojiPicker editor={editor} emojis={emojis} />
        </>
      )}

      <h3>HTML Output</h3>
      <pre className="output">{htmlContent}</pre>

      <h3>Styled HTML Output</h3>
      <pre className="output-styled">{htmlContent ? getStyledHtml(htmlContent) : ''}</pre>
    </>
  );
}
