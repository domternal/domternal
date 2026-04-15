import { computed, defineComponent, h } from 'vue';
import type { PropType, ShallowRef } from 'vue';
import type { Editor, ToolbarButton, BubbleMenuOptions } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useBubbleMenu, type BubbleMenuItem } from './useBubbleMenu.js';

export interface DomternalBubbleMenuProps {
  editor?: Editor;
  shouldShow?: BubbleMenuOptions['shouldShow'];
  placement?: 'top' | 'bottom';
  offset?: number;
  updateDelay?: number;
  items?: string[];
  contexts?: Record<string, string[] | true | null>;
}

export const DomternalBubbleMenu = defineComponent({
  name: 'DomternalBubbleMenu',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
    shouldShow: { type: Function as PropType<BubbleMenuOptions['shouldShow']>, default: undefined },
    placement: { type: String as PropType<'top' | 'bottom'>, default: 'top' },
    offset: { type: Number, default: 8 },
    updateDelay: { type: Number, default: 0 },
    items: { type: Array as PropType<string[]>, default: undefined },
    contexts: { type: Object as PropType<Record<string, string[] | true | null>>, default: undefined },
  },
  setup(props, { slots }) {
    const { editor: contextEditor } = useCurrentEditor();

    const {
      menuRef,
      resolvedItems,
      isItemActive,
      isItemDisabled,
      executeCommand,
      activeVersion,
      getCachedIcon,
    } = useBubbleMenu({
      editor: computed(() => props.editor ?? contextEditor.value) as ShallowRef<Editor | null>,
      shouldShow: props.shouldShow,
      placement: props.placement,
      offset: props.offset,
      updateDelay: props.updateDelay,
      items: props.items,
      contexts: props.contexts,
    });

    return () => {
      // Read activeVersion to establish reactive dependency
      void activeVersion.value;

      return h('div', { ref: menuRef, class: 'dm-bubble-menu', role: 'toolbar', 'aria-label': 'Text formatting' }, [
        ...resolvedItems.value.map((item: BubbleMenuItem) => {
          if (item.type === 'separator') {
            return h('span', { key: item.name, class: 'dm-toolbar-separator', role: 'separator' });
          }

          const btn = item as ToolbarButton;
          const active = isItemActive(btn);
          return h('button', {
            key: btn.name,
            type: 'button',
            class: ['dm-toolbar-button', active && 'dm-toolbar-button--active'],
            disabled: isItemDisabled(btn),
            'aria-label': btn.label,
            'aria-pressed': active,
            title: btn.label,
            innerHTML: getCachedIcon(btn.icon),
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => executeCommand(btn),
          });
        }),
        slots['default']?.(),
      ]);
    };
  },
});
