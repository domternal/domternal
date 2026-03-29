import { defineComponent, h, ref, watchEffect } from 'vue';
import type { PropType } from 'vue';
import type { Editor } from '@domternal/core';

/**
 * Renders the ProseMirror editor view into a div element.
 *
 * Use this with `useEditor` for a flexible, decoupled pattern where the
 * editor composable and rendering are separated.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useEditor, EditorContent } from '@domternal/vue';
 * const { editor } = useEditor({ extensions, content });
 * </script>
 * <template>
 *   <EditorContent :editor="editor" class="my-editor" />
 * </template>
 * ```
 */
export const EditorContent = defineComponent({
  name: 'EditorContent',
  props: {
    editor: {
      type: Object as PropType<Editor | null>,
      default: null,
    },
    class: {
      type: String,
      default: undefined,
    },
  },
  setup(props) {
    const containerRef = ref<HTMLElement>();

    watchEffect(() => {
      const container = containerRef.value;
      const editor = props.editor;
      if (!container || !editor || editor.isDestroyed) return;

      const editorDom = editor.view.dom;
      if (editorDom.parentElement !== container) {
        container.appendChild(editorDom);
      }
    });

    return () =>
      h('div', {
        ref: containerRef,
        class: props.class,
      });
  },
});
