import { defineComponent, h, ref, watch } from 'vue';
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

    // Avoid tracking reactive reads performed by plugin event subscribers.
    watch([containerRef, () => props.editor], ([container, editor], _previous, onCleanup) => {
      if (!container || !editor || editor.isDestroyed) return;

      editor.adoptDom(container);
      onCleanup(() => {
        if (!editor.isDestroyed && editor.view.dom.parentElement === container) {
          editor.adoptDom(document.createElement('div'));
        }
      });
    }, { immediate: true });

    return () =>
      h('div', {
        ref: containerRef,
        class: props.class,
        'data-dm-editor-ui': '',
      });
  },
});
