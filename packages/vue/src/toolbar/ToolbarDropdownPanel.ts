import { defineComponent, h } from 'vue';
import type { PropType, VNode } from 'vue';
import type { ToolbarButton, ToolbarDropdown } from '@domternal/core';

export const ToolbarDropdownPanel = defineComponent({
  name: 'ToolbarDropdownPanel',
  props: {
    dropdown: { type: Object as PropType<ToolbarDropdown>, required: true },
    isActive: { type: Function as PropType<(name: string) => boolean>, required: true },
    getCachedItemContent: {
      type: Function as PropType<(icon: string, label: string, mode?: 'icon-text' | 'text' | 'icon') => string>,
      required: true,
    },
  },
  emits: ['itemClick'],
  setup(props, { emit }) {
    return () => {
      const { dropdown, isActive, getCachedItemContent } = props;

      if (dropdown.layout === 'grid') {
        return h(
          'div',
          {
            class: 'dm-toolbar-dropdown-panel dm-color-palette',
            role: 'menu',
            style: { '--dm-palette-columns': String(dropdown.gridColumns ?? 10) },
          },
          dropdown.items.map((sub: ToolbarButton) =>
            sub.color
              ? h('button', {
                  key: sub.name,
                  type: 'button',
                  class: ['dm-color-swatch', isActive(sub.name) && 'dm-color-swatch--active'],
                  role: 'menuitem',
                  tabindex: -1,
                  'aria-label': sub.label,
                  title: sub.label,
                  style: { backgroundColor: sub.color },
                  onMousedown: (e: MouseEvent) => e.preventDefault(),
                  onClick: (e: MouseEvent) => emit('itemClick', sub, e),
                })
              : h('button', {
                  key: sub.name,
                  type: 'button',
                  class: 'dm-color-palette-reset',
                  role: 'menuitem',
                  tabindex: -1,
                  'aria-label': sub.label,
                  innerHTML: getCachedItemContent(sub.icon, sub.label),
                  onMousedown: (e: MouseEvent) => e.preventDefault(),
                  onClick: (e: MouseEvent) => emit('itemClick', sub, e),
                }),
          ),
        );
      }

      return h(
        'div',
        {
          class: 'dm-toolbar-dropdown-panel',
          role: 'menu',
          'data-display-mode': dropdown.displayMode ?? null,
        },
        dropdown.items.map((sub: ToolbarButton) =>
          h('button', {
            key: sub.name,
            type: 'button',
            class: ['dm-toolbar-dropdown-item', isActive(sub.name) && 'dm-toolbar-dropdown-item--active'],
            role: 'menuitem',
            tabindex: -1,
            'aria-label': sub.label,
            title: sub.label,
            innerHTML: getCachedItemContent(sub.icon, sub.label, dropdown.displayMode),
            onVnodeMounted: (vnode: VNode) => {
              if (sub.style && vnode.el) (vnode.el as HTMLElement).setAttribute('style', sub.style);
            },
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: (e: MouseEvent) => emit('itemClick', sub, e),
          }),
        ),
      );
    };
  },
});
