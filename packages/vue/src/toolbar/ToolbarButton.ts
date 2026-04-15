import { defineComponent, h } from 'vue';
import type { PropType } from 'vue';
import type { ToolbarButton as ToolbarButtonType } from '@domternal/core';

export const ToolbarButton = defineComponent({
  name: 'ToolbarButton',
  props: {
    item: { type: Object as PropType<ToolbarButtonType>, required: true },
    isActive: { type: Boolean, required: true },
    isDisabled: { type: Boolean, required: true },
    tabIndex: { type: Number, required: true },
    tooltip: { type: String, required: true },
    iconHtml: { type: String, required: true },
    ariaExpanded: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    click: (_item: ToolbarButtonType, _event: MouseEvent) => true,
    focus: (_name: string) => true,
  },
  setup(props, { emit }) {
    return () =>
      h('button', {
        type: 'button',
        class: ['dm-toolbar-button', props.isActive && 'dm-toolbar-button--active'],
        disabled: props.isDisabled,
        tabindex: props.tabIndex,
        innerHTML: props.iconHtml,
        'aria-pressed': props.isActive,
        'aria-expanded': props.ariaExpanded === 'true' ? true : undefined,
        'aria-label': props.item.label,
        title: props.tooltip,
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick: (e: MouseEvent) => emit('click', props.item, e),
        onFocus: () => emit('focus', props.item.name),
      });
  },
});
