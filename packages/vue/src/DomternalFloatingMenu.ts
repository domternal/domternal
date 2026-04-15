import { defineComponent, h, onMounted, onScopeDispose, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { PluginKey, createFloatingMenuPlugin } from '@domternal/core';
import type { Editor, FloatingMenuOptions } from '@domternal/core';
import { useCurrentEditor } from './EditorContext.js';

export interface DomternalFloatingMenuProps {
  editor?: Editor;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: number;
}

export const DomternalFloatingMenu = defineComponent({
  name: 'DomternalFloatingMenu',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
    shouldShow: { type: Function as PropType<FloatingMenuOptions['shouldShow']>, default: undefined },
    offset: { type: Number, default: 0 },
  },
  setup(props, { slots }) {
    const { editor: contextEditor } = useCurrentEditor();
    const menuRef = ref<HTMLDivElement>();
    const pluginKey = new PluginKey('vueFloatingMenu-' + Math.random().toString(36).slice(2, 8));

    let registered = false;
    let stopWatch: (() => void) | null = null;
    const doRegister = (editor: Editor) => {
      if (registered || editor.isDestroyed || !menuRef.value) return;
      registered = true;

      const plugin = createFloatingMenuPlugin({
        pluginKey,
        editor,
        element: menuRef.value,
        ...(props.shouldShow && { shouldShow: props.shouldShow }),
        offset: props.offset,
      });
      editor.registerPlugin(plugin);
    };

    onMounted(() => {
      const ed = props.editor ?? contextEditor.value;
      if (ed) {
        doRegister(ed);
      } else {
        stopWatch = watch(
          () => props.editor ?? contextEditor.value,
          (editor) => {
            if (editor) {
              doRegister(editor);
              stopWatch?.();
              stopWatch = null;
            }
          },
        );
      }
    });

    onScopeDispose(() => {
      stopWatch?.();
      const editor = props.editor ?? contextEditor.value;
      if (editor && !editor.isDestroyed) {
        editor.unregisterPlugin(pluginKey);
      }
    });

    return () =>
      h('div', { ref: menuRef, class: 'dm-floating-menu' }, slots['default']?.());
  },
});
