<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  useEditor,
  useEditorState,
  DomternalToolbar,
  DomternalBubbleMenu,
  DomternalFloatingMenu,
  DomternalEmojiPicker,
} from '@domternal/vue';
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
  Print,
  Dropcursor,
  inlineStyles,
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
import type { IconSet } from '@domternal/core';
import { createLowlight, common } from 'lowlight';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { DEMO_CONTENT } from './demo-content.js';
import { useExposeEditorForE2E } from './useExposeEditorForE2E.js';
import {
  parseBubbleIconsParam,
  parseBubbleItemsParam,
  resolveBubbleIcons,
  type BubbleIconsParam,
} from './bubble-icons-fixtures.js';

const { useLayout } = defineProps<{ useLayout: boolean }>();

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

const extensions = [
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
      items: ({ query }: { query: string }) => mockUsers.filter((u) => u.label.toLowerCase().includes(query.toLowerCase())),
      render: createMentionSuggestionRenderer(),
      minQueryLength: 0,
      invalidNodes: ['codeBlock'],
    },
  }),
  LinkPopover, InvisibleChars, SelectionDecoration, ClearFormatting, Dropcursor, Print,
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

const { editor, editorRef } = useEditor({ extensions, content: DEMO_CONTENT });
const { htmlContent } = useEditorState(editor);

// Selector mode (Vue-specific: computed with memoization)
const isBold = useEditorState(editor, (ed) => ed.isActive('bold'));
const isItalic = useEditorState(editor, (ed) => ed.isActive('italic'));
const isEmpty = useEditorState(editor, (ed) => ed.isEmpty);

useExposeEditorForE2E(editor);

// E2E fixture: ?bubble-icons= URL param + window.__DEMO_SET_BUBBLE_ICONS__ runtime hook.
const bubbleIcons = ref<IconSet | undefined>(resolveBubbleIcons(parseBubbleIconsParam()));
const bubbleItems = ref<string[] | undefined>(parseBubbleItemsParam());

onMounted(() => {
  const w = window as unknown as Record<string, unknown>;
  w['__DEMO_SET_BUBBLE_ICONS__'] = (key: BubbleIconsParam | null): void => {
    bubbleIcons.value = resolveBubbleIcons(key);
  };
});
onUnmounted(() => {
  const w = window as unknown as Record<string, unknown>;
  w['__DEMO_SET_BUBBLE_ICONS__'] = undefined;
});

const styledHtml = computed(() =>
  htmlContent.value ? inlineStyles(htmlContent.value, { codeHighlighter, tableColumnWidths: 'pixel' }) : '',
);

defineExpose({ editor, editorRef });
</script>

<template>
  <DomternalToolbar
    v-if="editor"
    :key="useLayout ? 'custom' : 'default'"
    :editor="editor"
    :layout="useLayout ? toolbarLayout : undefined"
  />

  <div class="dm-editor" data-dm-editor-ui="">
    <div ref="editorRef" />
  </div>

  <template v-if="editor">
    <DomternalBubbleMenu
      v-if="bubbleAuto"
      :editor="editor"
      :icons="bubbleIcons"
      :items="bubbleItems"
    />
    <DomternalBubbleMenu
      v-else
      :editor="editor"
      :contexts="bubbleItems ? undefined : { text: ['bold', 'italic', 'underline', 'strike', 'code'] }"
      :items="bubbleItems"
      :icons="bubbleIcons"
    />
    <DomternalFloatingMenu :editor="editor" />
    <DomternalEmojiPicker :editor="editor" :emojis="emojis" />
  </template>

  <h3>Selector State (useEditorState with selector)</h3>
  <div class="selector-state" data-testid="selector-state">
    <span data-testid="is-bold">isBold: {{ isBold }}</span>
    <span data-testid="is-italic">isItalic: {{ isItalic }}</span>
    <span data-testid="is-empty">isEmpty: {{ isEmpty }}</span>
  </div>

  <h3>HTML Output</h3>
  <pre class="output">{{ htmlContent }}</pre>

  <h3>Styled HTML Output</h3>
  <pre class="output-styled">{{ styledHtml }}</pre>
</template>
