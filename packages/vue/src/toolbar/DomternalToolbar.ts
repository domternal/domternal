import { computed, defineComponent, h, Fragment } from 'vue';
import type { PropType, ShallowRef } from 'vue';
import type {
  Editor,
  IconSet,
  ToolbarButton as ToolbarButtonType,
  ToolbarDropdown as ToolbarDropdownType,
  ToolbarItem,
  ToolbarLayoutEntry,
} from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useToolbarController } from './useToolbarController.js';
import { useToolbarIcons, DROPDOWN_CARET } from './useToolbarIcons.js';
import { useTooltip } from './useTooltip.js';
import { useKeyboardNav } from './useKeyboardNav.js';
import { getComputedStyleAtCursor, getInlineStyleAtCursor } from './useComputedStyle.js';
import { ToolbarButton } from './ToolbarButton.js';
import { ToolbarDropdown } from './ToolbarDropdown.js';

export interface DomternalToolbarProps {
  editor?: Editor;
  icons?: IconSet;
  layout?: ToolbarLayoutEntry[];
}

export const DomternalToolbar = defineComponent({
  name: 'DomternalToolbar',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
    icons: { type: Object as PropType<IconSet>, default: undefined },
    layout: { type: Array as PropType<ToolbarLayoutEntry[]>, default: undefined },
  },
  setup(props) {
    const { editor: contextEditor } = useCurrentEditor();

    const {
      controller: controllerRef,
      groups,
      focusedIndex,
      openDropdown,
      activeVersion,
      toolbarRef,
      isActive,
      isDisabled,
      isDropdownActive,
      getAriaExpanded,
      getFlatIndex,
      handleDropdownToggle,
      closeDropdown,
      executeCommand,
    } = useToolbarController(
      computed(() => props.editor ?? contextEditor.value) as ShallowRef<Editor | null>,
      props.layout,
    );

    const {
      getCachedIcon,
      getCachedItemContent,
      getDropdownTriggerHtml,
    } = useToolbarIcons(props.icons);

    const { getTooltip } = useTooltip();
    const { onKeyDown } = useKeyboardNav(controllerRef, toolbarRef, closeDropdown);

    function onButtonClick(item: ToolbarButtonType, event?: Event) {
      const editor = props.editor ?? contextEditor.value;
      if (!editor) return;

      if (controllerRef.current?.openDropdown) {
        closeDropdown();
      }

      if (item.emitEvent) {
        const anchor = (event?.target as HTMLElement)?.closest?.('.dm-toolbar-button') as HTMLElement ?? event?.target as HTMLElement;
        (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
        return;
      }
      executeCommand(item);

      // Always refocus editor after executing a command via toolbar button.
      // Mouse clicks already keep focus via mousedown.preventDefault();
      // keyboard activations (Enter/Space) need explicit refocus.
      requestAnimationFrame(() => editor.view.focus());
    }

    function onDropdownItemClick(item: ToolbarButtonType, event: MouseEvent) {
      const editor = props.editor ?? contextEditor.value;
      if (!editor) return;

      let anchor: HTMLElement | undefined;
      if (item.emitEvent) {
        const wrapper = (event.target as HTMLElement)?.closest?.('.dm-toolbar-dropdown-wrapper');
        anchor = wrapper?.querySelector('.dm-toolbar-dropdown-trigger') as HTMLElement | undefined;
      }

      closeDropdown();

      if (item.emitEvent) {
        (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      } else {
        executeCommand(item);
      }

      // Refocus editor so ::selection highlight stays visible
      requestAnimationFrame(() => editor.view.focus());
    }

    function onButtonFocus(name: string) {
      const index = controllerRef.current?.getFlatIndex(name) ?? -1;
      if (index >= 0) {
        controllerRef.current?.setFocusedIndex(index);
      }
    }

    return () => {
      const editor = props.editor ?? contextEditor.value;
      if (!editor) return null;

      // Read activeVersion to establish reactive dependency
      void activeVersion.value;

      return h(
        'div',
        {
          ref: toolbarRef,
          class: 'dm-toolbar',
          role: 'toolbar',
          'aria-label': 'Editor formatting',
          'data-dm-editor-ui': '',
          onKeydown: onKeyDown,
        },
        groups.value.map((group, gi) =>
          h(Fragment, { key: group.name }, [
            gi > 0 ? h('div', { class: 'dm-toolbar-separator', role: 'separator' }) : null,
            h(
              'div',
              { class: 'dm-toolbar-group', role: 'group', 'aria-label': group.name || 'Tools' },
              group.items.map((item: ToolbarItem) => {
                if (item.type === 'button') {
                  const btn = item as ToolbarButtonType;
                  return h(ToolbarButton, {
                    key: btn.name,
                    item: btn,
                    isActive: isActive(btn.name),
                    isDisabled: isDisabled(btn.name),
                    tabIndex: getFlatIndex(btn.name) === focusedIndex.value ? 0 : -1,
                    tooltip: getTooltip(btn),
                    iconHtml: getCachedIcon(btn.icon),
                    ariaExpanded: getAriaExpanded(btn),
                    onClick: (clickedItem: ToolbarButtonType, event: MouseEvent) => onButtonClick(clickedItem, event),
                    onFocus: onButtonFocus,
                  });
                }
                if (item.type === 'dropdown') {
                  const dd = item as ToolbarDropdownType;
                  const activeItem = dd.items.find((sub: ToolbarButtonType) => controllerRef.current?.activeMap.get(sub.name));

                  let triggerHtml = getDropdownTriggerHtml(dd, activeItem);
                  if (dd.dynamicLabel && !activeItem && dd.computedStyleProperty) {
                    let computed: string | null;
                    if (dd.computedStyleProperty === 'font-family') {
                      computed = getInlineStyleAtCursor(editor, dd.computedStyleProperty);
                      if (computed) {
                        const first = computed.split(',')[0]?.replace(/['"]+/g, '').trim();
                        computed = first || null;
                      }
                    } else {
                      computed = getComputedStyleAtCursor(editor, dd.computedStyleProperty);
                    }
                    if (computed) {
                      triggerHtml = `<span class="dm-toolbar-trigger-label">${computed}</span>${DROPDOWN_CARET}`;
                    }
                  }

                  return h(ToolbarDropdown, {
                    key: dd.name,
                    dropdown: dd,
                    isOpen: openDropdown.value === dd.name,
                    isActive,
                    isDropdownActive: isDropdownActive(dd),
                    isDisabled: isDisabled(dd.name),
                    tabIndex: getFlatIndex(dd.name) === focusedIndex.value ? 0 : -1,
                    triggerHtml,
                    getCachedItemContent,
                    onToggle: handleDropdownToggle,
                    onItemClick: onDropdownItemClick,
                    onFocus: onButtonFocus,
                  });
                }
                return null;
              }),
            ),
          ]),
        ),
      );
    };
  },
});
