import { defineComponent, h, ref, watchEffect } from 'vue';
import type { PropType } from 'vue';
import type { AnyExtension, Content, FocusPosition } from '@domternal/core';
import { useEditor, type UseEditorOptions } from './useEditor.js';
import { provideEditor, useCurrentEditor } from './EditorContext.js';

export interface DomternalProps extends UseEditorOptions {
  // All UseEditorOptions props are inherited
}

/**
 * Composable root component that creates an editor and provides it to all
 * subcomponents via inject. No need to pass `editor` prop to children.
 *
 * Supports namespaced subcomponents in `<script setup>` templates:
 *
 * @example
 * ```vue
 * <script setup>
 * import { Domternal } from '@domternal/vue';
 * </script>
 * <template>
 *   <Domternal :extensions="extensions" :content="content">
 *     <Domternal.Toolbar />
 *     <Domternal.Content />
 *     <Domternal.BubbleMenu :contexts="{ text: ['bold', 'italic'] }" />
 *     <Domternal.EmojiPicker :emojis="emojis" />
 *   </Domternal>
 * </template>
 * ```
 */
export const Domternal = defineComponent({
  name: 'Domternal',
  props: {
    extensions: { type: Array as PropType<AnyExtension[]>, default: undefined },
    content: { type: [String, Object] as PropType<Content>, default: '' },
    editable: { type: Boolean, default: true },
    autofocus: { type: [Boolean, String, Number] as PropType<FocusPosition>, default: false },
    outputFormat: { type: String as PropType<'html' | 'json'>, default: 'html' },
    immediatelyRender: { type: Boolean, default: false },
    onCreate: { type: Function as PropType<UseEditorOptions['onCreate']>, default: undefined },
    onUpdate: { type: Function as PropType<UseEditorOptions['onUpdate']>, default: undefined },
    onSelectionChange: { type: Function as PropType<UseEditorOptions['onSelectionChange']>, default: undefined },
    onFocus: { type: Function as PropType<UseEditorOptions['onFocus']>, default: undefined },
    onBlur: { type: Function as PropType<UseEditorOptions['onBlur']>, default: undefined },
    onDestroy: { type: Function as PropType<UseEditorOptions['onDestroy']>, default: undefined },
  },
  setup(props, { slots }) {
    const { editor } = useEditor({
      ...(props.extensions && { extensions: props.extensions }),
      content: props.content,
      editable: props.editable,
      autofocus: props.autofocus,
      outputFormat: props.outputFormat,
      immediatelyRender: props.immediatelyRender,
      ...(props.onCreate && { onCreate: props.onCreate }),
      ...(props.onUpdate && { onUpdate: props.onUpdate }),
      ...(props.onSelectionChange && { onSelectionChange: props.onSelectionChange }),
      ...(props.onFocus && { onFocus: props.onFocus }),
      ...(props.onBlur && { onBlur: props.onBlur }),
      ...(props.onDestroy && { onDestroy: props.onDestroy }),
    });

    provideEditor(editor);

    return () => slots['default']?.();
  },
}) as ReturnType<typeof defineComponent> & {
  Content: ReturnType<typeof defineComponent>;
  Loading: ReturnType<typeof defineComponent>;
  Toolbar: ReturnType<typeof defineComponent>;
  BubbleMenu: ReturnType<typeof defineComponent>;
  FloatingMenu: ReturnType<typeof defineComponent>;
  EmojiPicker: ReturnType<typeof defineComponent>;
};

// --- Subcomponents ---

/** Renders the editor content area. Mounts the editor view DOM from context. */
const DomternalContent = defineComponent({
  name: 'DomternalContent',
  props: {
    class: { type: String, default: undefined },
  },
  setup(props) {
    const { editor } = useCurrentEditor();
    const containerRef = ref<HTMLElement>();

    watchEffect(() => {
      const container = containerRef.value;
      const ed = editor.value;
      if (!container || !ed || ed.isDestroyed) return;

      const editorDom = ed.view.dom;
      if (editorDom.parentElement !== container) {
        container.appendChild(editorDom);
      }
    });

    return () => {
      const classes = props.class ? `dm-editor ${props.class}` : 'dm-editor';
      return h('div', { class: classes, 'data-dm-editor-ui': '' }, [h('div', { ref: containerRef })]);
    };
  },
});

/** Renders slot content only while editor is not yet ready (SSR loading state). */
const DomternalLoading = defineComponent({
  name: 'DomternalLoading',
  setup(_props, { slots }) {
    const { editor } = useCurrentEditor();
    return () => (editor.value ? null : slots['default']?.());
  },
});

Domternal.Content = DomternalContent;
Domternal.Loading = DomternalLoading;
// Toolbar, BubbleMenu, FloatingMenu, EmojiPicker are assigned in index.ts
