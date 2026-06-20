<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  useEditor,
  useEditorState,
  DomternalBubbleMenu,
  DomternalFloatingMenu,
  DomternalNotionColorPicker,
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
import type { IconSet } from '@domternal/core';
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

const props = withDefaults(defineProps<{
  /** Cap the page wrapper height and scroll its content internally. Adds
   * `notion-page--scrollable` and wires `activeScrollParent` so the TOC
   * scroll-spy follows the host scroll instead of the window. */
  scrollable?: boolean;
}>(), {
  scrollable: false,
});

// Captures the page wrapper element so we can wire it as the TOC's
// `activeScrollParent` in scrollable mode. Template refs are resolved
// before `onMounted` fires.
const pageEl = ref<HTMLDivElement | null>(null);

// `extensions` keeps a single array reference. This onMounted is
// registered BEFORE useEditor's own, so we mutate the array in-place
// before useEditor reads it; the watcher stays quiet because it
// compares the reference, not contents.
const extensions: AnyExtension[] = buildExtensions(null);
onMounted(() => {
  if (props.scrollable && pageEl.value) {
    const wired = buildExtensions(pageEl.value);
    extensions.length = 0;
    extensions.push(...wired);
  }
});

const { editor, editorRef } = useEditor({
  extensions,
  content: NOTION_DEMO_CONTENT,
});

const { htmlContent } = useEditorState(editor);

const styledHtml = computed(() =>
  htmlContent.value ? inlineStyles(htmlContent.value, { codeHighlighter, tableColumnWidths: 'pixel' }) : '',
);

const toasts = ref<Toast[]>([]);

// E2E fixture for bubble menu icons override.
const bubbleIcons = ref<IconSet | undefined>(resolveBubbleIcons(parseBubbleIconsParam()));
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
let toastCounter = 0;
const pushToast = (message: string, kind: Toast['kind']): void => {
  const id = ++toastCounter;
  toasts.value = [...toasts.value, { id, message, kind }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, TOAST_MS[kind]);
};

// Expose editor + cursor-context util on window for e2e, and wire the
// copy-link toast listeners. Cleanup detaches everything; HMR/route remount
// is benign because the second mount re-sets the same editor.
watch(editor, (ed, _old, onCleanup) => {
  if (!ed) return;
  window.__DEMO_EDITOR__ = ed;
  window.__DOMTERNAL_LIST_CTX__ = getListItemCursorContext;

  const host = ed.view.dom.closest<HTMLElement>('.dm-editor');
  const controller = new AbortController();
  const { signal } = controller;

  host?.addEventListener('dm:copy-link-success', () => {
    pushToast('Link copied', 'success');
  }, { signal });
  host?.addEventListener('dm:copy-link-error', () => {
    pushToast('Failed to copy link', 'error');
  }, { signal });

  onCleanup(() => {
    controller.abort();
    // Only clear when our editor is still the one on the window. Avoids
    // clobbering a newer mount's editor reference during HMR/route re-enter.
    if (window.__DEMO_EDITOR__ === ed) {
      window.__DEMO_EDITOR__ = undefined;
      window.__DOMTERNAL_LIST_CTX__ = undefined;
    }
  });
}, { immediate: true });
</script>

<template>
  <div class="app-notion-demo">
    <div
      ref="pageEl"
      :class="['notion-page', { 'notion-page--scrollable': props.scrollable }]"
    >
      <div class="dm-editor dm-notion-mode">
        <div ref="editorRef" />
      </div>

      <template v-if="editor">
        <DomternalBubbleMenu :editor="editor" :icons="bubbleIcons" />
        <DomternalFloatingMenu :editor="editor" :require-explicit-trigger="true" />
        <DomternalNotionColorPicker :editor="editor" />
      </template>
    </div>
  </div>

  <h3>HTML Output</h3>
  <pre class="output">{{ htmlContent }}</pre>

  <h3>Styled HTML Output</h3>
  <pre class="output-styled">{{ styledHtml }}</pre>

  <Teleport to="body">
    <div
      v-for="t in toasts"
      :key="t.id"
      :role="t.kind === 'success' ? 'status' : 'alert'"
      :class="['notion-demo-toast', t.kind === 'error' && 'notion-demo-toast--error']"
    >
      {{ t.message }}
    </div>
  </Teleport>
</template>
