import { defineComponent, h } from 'vue';
import type { PropType } from 'vue';
import type { ToolbarButton, ToolbarDropdown as ToolbarDropdownType } from '@domternal/core';
import { DROPDOWN_CARET } from './useToolbarIcons.js';
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
    activeItem: { type: Object as PropType<ToolbarButton>, default: undefined },
    computedLabel: { type: String, default: undefined },
    getCachedIcon: { type: Function as PropType<(icon: string) => string>, required: true },
  },
  emits: ['toggle', 'itemClick', 'focus'],
  setup(props, { emit }) {
    return () => {
      const { dropdown, activeItem } = props;
      const isGrid = dropdown.layout === 'grid';
      const label = !isGrid && dropdown.dynamicLabel
        ? props.computedLabel ?? activeItem?.label ?? dropdown.dynamicLabelFallback
        : undefined;
      const labelLanguage = props.computedLabel ? undefined : (activeItem ? activeItem.labelLanguage : dropdown.labelLanguage);
      const icon = !isGrid && dropdown.dynamicIcon && activeItem ? activeItem.icon : dropdown.icon;
      const color = isGrid ? activeItem?.color ?? dropdown.defaultIndicatorColor : undefined;
      const children = [
        h('button', {
          type: 'button',
          class: ['dm-toolbar-button', 'dm-toolbar-dropdown-trigger', props.isDropdownActive && 'dm-toolbar-button--active'],
          'aria-expanded': props.isOpen,
          'aria-haspopup': 'true',
          'aria-label': dropdown.label,
          lang: dropdown.labelLanguage ?? '',
          title: dropdown.label,
          tabindex: props.tabIndex,
          disabled: props.isDisabled,
          'data-dropdown': dropdown.name,
          onMousedown: (e: MouseEvent) => { e.preventDefault(); },
          onClick: () => { emit('toggle', dropdown); },
          onFocus: () => { emit('focus', dropdown.name); },
        }, [
          label !== undefined
            ? h('span', { class: 'dm-toolbar-trigger-label', lang: labelLanguage ?? '' }, label)
            : h('span', {
              class: dropdown.dynamicLabel && !isGrid ? 'dm-toolbar-trigger-label' : undefined,
              style: dropdown.dynamicLabel && !isGrid ? undefined : { display: 'contents' }, 'aria-hidden': 'true', innerHTML: props.getCachedIcon(icon),
            }),
          h('span', { style: { display: 'contents' }, 'aria-hidden': 'true', innerHTML: DROPDOWN_CARET }),
          color ? h('span', { class: 'dm-toolbar-color-indicator', style: { backgroundColor: color } }) : null,
        ]),
      ];

      if (props.isOpen) {
        children.push(h(ToolbarDropdownPanel, {
          dropdown,
          isActive: props.isActive,
          getCachedIcon: props.getCachedIcon,
          onItemClick: (item: ToolbarButton, event: MouseEvent) => { emit('itemClick', item, event); },
        }));
      }
      return h('div', { class: 'dm-toolbar-dropdown-wrapper' }, children);
    };
  },
});
