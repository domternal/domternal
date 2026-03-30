import { defineComponent, h } from 'vue';
import type { PropType } from 'vue';
import type { ToolbarButton, ToolbarDropdown as ToolbarDropdownType } from '@domternal/core';
import { ToolbarDropdownPanel } from './ToolbarDropdownPanel.js';

export const ToolbarDropdown = defineComponent({
  name: 'ToolbarDropdown',
  props: {
    dropdown: { type: Object as PropType<ToolbarDropdownType>, required: true },
    isOpen: { type: Boolean, required: true },
    isActive: { type: Function as PropType<(name: string) => boolean>, required: true },
    isDropdownActive: { type: Boolean, required: true },
    isDisabled: { type: Boolean, required: true },
    tabIndex: { type: Number, required: true },
    triggerHtml: { type: String, required: true },
    getCachedItemContent: {
      type: Function as PropType<(icon: string, label: string, mode?: 'icon-text' | 'text' | 'icon') => string>,
      required: true,
    },
  },
  emits: ['toggle', 'itemClick', 'focus'],
  setup(props, { emit }) {
    return () => {
      const children = [
        h('button', {
          type: 'button',
          class: ['dm-toolbar-button', 'dm-toolbar-dropdown-trigger', props.isDropdownActive && 'dm-toolbar-button--active'],
          'aria-expanded': props.isOpen,
          'aria-haspopup': 'true',
          'aria-label': props.dropdown.label,
          title: props.dropdown.label,
          tabindex: props.tabIndex,
          disabled: props.isDisabled,
          'data-dropdown': props.dropdown.name,
          innerHTML: props.triggerHtml,
          onMousedown: (e: MouseEvent) => e.preventDefault(),
          onClick: () => emit('toggle', props.dropdown),
          onFocus: () => emit('focus', props.dropdown.name),
        }),
      ];

      if (props.isOpen) {
        children.push(
          h(ToolbarDropdownPanel, {
            dropdown: props.dropdown,
            isActive: props.isActive,
            getCachedItemContent: props.getCachedItemContent,
            onItemClick: (item: ToolbarButton, event: MouseEvent) => emit('itemClick', item, event),
          }),
        );
      }

      return h('div', { class: 'dm-toolbar-dropdown-wrapper' }, children);
    };
  },
});
