import { defineComponent, h, ref, watch } from 'vue';
import type { PropType } from 'vue';
import type { Content, AnyExtension, FocusPosition, JSONContent } from '@domternal/core';
import { useEditor } from './useEditor.js';
import { useEditorState } from './useEditorState.js';
import { provideEditor } from './EditorContext.js';

export interface DomternalEditorProps {
  extensions?: AnyExtension[];
  content?: Content;
  editable?: boolean;
  autofocus?: FocusPosition;
  immediatelyRender?: boolean;
  outputFormat?: 'html' | 'json';
  modelValue?: Content;
  class?: string;
  onCreate?: (editor: import('@domternal/core').Editor) => void;
  onUpdate?: (props: { editor: import('@domternal/core').Editor }) => void;
  onSelectionChange?: (props: { editor: import('@domternal/core').Editor }) => void;
  onFocus?: (props: { editor: import('@domternal/core').Editor; event: FocusEvent }) => void;
  onBlur?: (props: { editor: import('@domternal/core').Editor; event: FocusEvent }) => void;
  onDestroy?: () => void;
}

/**
 * All-in-one editor component with v-model support and integrated context.
 *
 * Wraps children with provideEditor automatically, so toolbar, bubble menu,
 * and emoji picker components can access the editor via inject.
 *
 * @example Basic usage
 * ```vue
 * <DomternalEditor
 *   :extensions="[Bold, Italic, Heading]"
 *   content="<p>Hello</p>"
 * />
 * ```
 *
 * @example v-model (two-way binding)
 * ```vue
 * <DomternalEditor v-model="content" :extensions="extensions" />
 * ```
 *
 * @example With children (toolbar, bubble menu)
 * ```vue
 * <DomternalEditor :extensions="extensions" v-model="content">
 *   <DomternalToolbar />
 *   <DomternalBubbleMenu :contexts="{ text: ['bold', 'italic'] }" />
 * </DomternalEditor>
 * ```
 */
export const DomternalEditor = defineComponent({
  name: 'DomternalEditor',
  props: {
    extensions: { type: Array as PropType<AnyExtension[]>, default: undefined },
    content: { type: [String, Object] as PropType<Content>, default: undefined },
    editable: { type: Boolean, default: true },
    autofocus: { type: [Boolean, String, Number] as PropType<FocusPosition>, default: false },
    immediatelyRender: { type: Boolean, default: false },
    outputFormat: { type: String as PropType<'html' | 'json'>, default: 'html' },
    modelValue: { type: [String, Object] as PropType<Content>, default: undefined },
    class: { type: String, default: undefined },
    onCreate: { type: Function as PropType<(editor: import('@domternal/core').Editor) => void>, default: undefined },
    onUpdate: { type: Function as PropType<(props: { editor: import('@domternal/core').Editor }) => void>, default: undefined },
    onSelectionChange: { type: Function as PropType<(props: { editor: import('@domternal/core').Editor }) => void>, default: undefined },
    onFocus: { type: Function as PropType<(props: { editor: import('@domternal/core').Editor; event: FocusEvent }) => void>, default: undefined },
    onBlur: { type: Function as PropType<(props: { editor: import('@domternal/core').Editor; event: FocusEvent }) => void>, default: undefined },
    onDestroy: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:modelValue': (_value: Content | JSONContent) => true,
  },
  setup(props, { slots, emit, expose }) {
    const { editor, editorRef } = useEditor({
      ...(props.extensions && { extensions: props.extensions }),
      content: props.modelValue ?? props.content ?? '',
      editable: props.editable,
      autofocus: props.autofocus,
      immediatelyRender: props.immediatelyRender,
      outputFormat: props.outputFormat,
      ...(props.onCreate && { onCreate: props.onCreate }),
      ...(props.onUpdate && { onUpdate: props.onUpdate }),
      ...(props.onSelectionChange && { onSelectionChange: props.onSelectionChange }),
      ...(props.onFocus && { onFocus: props.onFocus }),
      ...(props.onBlur && { onBlur: props.onBlur }),
      ...(props.onDestroy && { onDestroy: props.onDestroy }),
    });

    const state = useEditorState(editor);

    // Expose editor + state via template ref
    expose({
      editor,
      htmlContent: state.htmlContent,
      jsonContent: state.jsonContent,
      isEmpty: state.isEmpty,
      isFocused: state.isFocused,
    });

    // Provide editor to descendant components
    provideEditor(editor);

    // v-model: sync modelValue prop to editor
    const prevModelValue = ref(props.modelValue);
    watch(
      () => props.modelValue,
      (newValue) => {
        if (newValue === undefined) return;
        const ed = editor.value;
        if (!ed || ed.isDestroyed) return;
        if (newValue === prevModelValue.value) return;
        prevModelValue.value = newValue;

        if (props.outputFormat === 'html') {
          if (newValue !== ed.getHTML()) {
            ed.setContent(newValue, false);
          }
        } else {
          if (JSON.stringify(newValue) !== JSON.stringify(ed.getJSON())) {
            ed.setContent(newValue, false);
          }
        }
      },
      { flush: 'post' },
    );

    // v-model: emit update:modelValue on content changes
    watch(editor, (ed, _oldEd, onCleanup) => {
      if (!ed || ed.isDestroyed) return;

      const handler = () => {
        const val: string | JSONContent = props.outputFormat === 'html'
          ? ed.getHTML()
          : ed.getJSON();
        prevModelValue.value = val;
        emit('update:modelValue', val);
      };

      ed.on('update', handler);
      onCleanup(() => { ed.off('update', handler); });
    }, { immediate: true });

    return () => {
      const classes = props.class ? `dm-editor ${props.class}` : 'dm-editor';
      return [
        h('div', { class: classes, 'data-dm-editor-ui': '' }, [h('div', { ref: editorRef })]),
        slots['default']?.(),
      ];
    };
  },
});
