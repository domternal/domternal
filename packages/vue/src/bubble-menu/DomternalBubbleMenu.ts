import { computed, defineComponent, h, ref, watch } from 'vue';
import type { PropType, ShallowRef, VNode } from 'vue';
import {
  ToolbarController,
  defaultIcons,
  positionFloatingOnce,
} from '@domternal/core';
import type { Editor, IconSet, ToolbarButton, ToolbarDropdown, BubbleMenuOptions } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useBubbleMenu } from './useBubbleMenu.js';

const DROPDOWN_CARET =
  '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
  '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface DomternalBubbleMenuProps {
  editor?: Editor;
  shouldShow?: BubbleMenuOptions['shouldShow'];
  placement?: 'top' | 'bottom';
  offset?: number;
  updateDelay?: number;
  items?: string[];
  contexts?: Record<string, string[] | true | null>;
  /** Custom icon overrides. Falls back to default Phosphor icons for unmapped keys. */
  icons?: IconSet;
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
    icons: { type: Object as PropType<IconSet>, default: undefined },
  },
  setup(props, { slots }) {
    const { editor: contextEditor } = useCurrentEditor();
    // `computed` returns ComputedRef but useBubbleMenu expects ShallowRef. Cast
    // is safe (both share the same .value interface and watch subscribes to either)
    // and matches the wrapper convention (see useEmojiPicker).
    const editorRef = computed(() => props.editor ?? contextEditor.value) as ShallowRef<Editor | null>;

    const {
      menuRef,
      resolvedItems,
      isItemActive,
      isItemDisabled,
      executeCommand,
      activeVersion,
      getCachedIcon,
      trailing,
      openColorPicker,
      openBlockContextMenu,
    } = useBubbleMenu({
      editor: editorRef,
      shouldShow: props.shouldShow,
      placement: props.placement,
      offset: props.offset,
      updateDelay: props.updateDelay,
      items: props.items,
      contexts: props.contexts,
    });

    // Only one dropdown is open at a time across the entire bubble menu - the
    // Angular component enforces the same constraint via `openDropdown` signal.
    const openDropdown = ref<string | null>(null);
    const closeDropdown = (): void => { openDropdown.value = null; };

    const executeSubItem = (sub: ToolbarButton): void => {
      closeDropdown();
      const ed = editorRef.value;
      if (!ed) return;
      ToolbarController.executeItem(ed as never, sub);
      requestAnimationFrame(() => { ed.view.focus(); });
    };

    // Refs to the trailing trigger buttons so we can pass the element as anchor
    // to the color picker and block context menu (positioning targets).
    const colorBtnRef = ref<HTMLButtonElement>();
    const blockMenuBtnRef = ref<HTMLButtonElement>();

    return () => {
      // Read activeVersion to establish reactive dependency
      void activeVersion.value;
      const t = trailing.value;

      const children: VNode[] = [];

      for (const item of resolvedItems.value) {
        if (item.type === 'separator') {
          children.push(h('span', { key: item.name, class: 'dm-toolbar-separator', role: 'separator' }));
          continue;
        }
        if (item.type === 'dropdown') {
          children.push(
            h(BubbleDropdown, {
              key: item.name,
              dropdown: item,
              isOpen: openDropdown.value === item.name,
              isItemActive,
              getCachedIcon,
              activeVersion: activeVersion.value,
              executeSubItem,
              onToggle: (): void => {
                openDropdown.value = openDropdown.value === item.name ? null : item.name;
              },
              onClose: closeDropdown,
            }),
          );
          continue;
        }
        const btn = item;
        const active = isItemActive(btn);
        children.push(h('button', {
          key: btn.name,
          type: 'button',
          class: ['dm-toolbar-button', active && 'dm-toolbar-button--active'],
          disabled: isItemDisabled(btn),
          'aria-label': btn.label,
          'aria-pressed': active,
          title: btn.label,
          innerHTML: getCachedIcon(btn.icon),
          onMousedown: (e: MouseEvent) => { e.preventDefault(); },
          onClick: (e: MouseEvent) => { executeCommand(btn, e); },
        }));
      }

      if (t.showColorPickerButton && !t.isNodeSelection) {
        children.push(
          h('span', { class: 'dm-toolbar-separator', role: 'separator' }),
          h('button', {
            ref: colorBtnRef,
            type: 'button',
            class: ['dm-toolbar-button', 'dm-ncp-trigger', t.hasAnyColor && 'dm-toolbar-button--active'],
            title: 'Text and background color',
            'aria-label': 'Text and background color',
            'aria-haspopup': 'dialog',
            onMousedown: (e: MouseEvent) => { e.preventDefault(); },
            onClick: () => { if (colorBtnRef.value) openColorPicker(colorBtnRef.value); },
          }, [
            h('span', {
              class: 'dm-ncp-trigger-glyph',
              style: t.currentTextColorVar ? { color: t.currentTextColorVar } : undefined,
            }, 'A'),
            h('span', {
              class: 'dm-ncp-trigger-underline',
              style: t.currentBgColorVar ? { backgroundColor: t.currentBgColorVar } : undefined,
            }),
          ]),
        );
      }

      if (t.showBlockMenuButton && !t.isNodeSelection) {
        children.push(
          h('span', { class: 'dm-toolbar-separator', role: 'separator' }),
          h('button', {
            ref: blockMenuBtnRef,
            type: 'button',
            class: 'dm-toolbar-button',
            disabled: t.blockMenuButtonDisabled,
            title: t.blockMenuButtonDisabled
              ? 'Block actions (select within a single block)'
              : 'More options',
            'aria-label': 'More options',
            'aria-haspopup': 'menu',
            innerHTML: getCachedIcon('dotsThree'),
            onMousedown: (e: MouseEvent) => { e.preventDefault(); },
            onClick: () => { if (blockMenuBtnRef.value) openBlockContextMenu(blockMenuBtnRef.value); },
          }),
        );
      }

      const slotContent = slots['default']?.();
      if (slotContent) children.push(...slotContent);

      return h('div', {
        ref: menuRef,
        class: 'dm-bubble-menu',
        role: 'toolbar',
        'aria-label': 'Text formatting',
      }, children);
    };
  },
});

// ===== Bubble-menu-embedded dropdown =====

/**
 * Bubble-menu-embedded dropdown (e.g. text-align). Manages its own outside-
 * click / Escape / `dm:dismiss-overlays` lifecycle. Panel stays INSIDE
 * `.dm-bubble-menu` so it inherits bubble-scoped active-state tokens.
 */
const BubbleDropdown = defineComponent({
  name: 'BubbleDropdown',
  props: {
    dropdown: { type: Object as PropType<ToolbarDropdown>, required: true },
    isOpen: { type: Boolean, required: true },
    isItemActive: { type: Function as PropType<(item: ToolbarButton) => boolean>, required: true },
    getCachedIcon: { type: Function as PropType<(name: string) => string>, required: true },
    activeVersion: { type: Number, required: true },
    executeSubItem: { type: Function as PropType<(sub: ToolbarButton) => void>, required: true },
  },
  emits: ['toggle', 'close'],
  setup(props, { emit }) {
    const triggerRef = ref<HTMLButtonElement>();
    const panelRef = ref<HTMLDivElement>();

    // Position dropdown + outside-close / Escape / cooperative dismissal via
    // a single AbortController. `flush: 'post'` waits for the panel to mount
    // before measuring + positioning.
    watch(
      () => props.isOpen,
      (open, _old, onCleanup) => {
        if (!open) return;
        const trigger = triggerRef.value;
        const panel = panelRef.value;
        if (!trigger || !panel) return;

        const cleanupFloating = positionFloatingOnce(trigger, panel, {
          placement: 'bottom-start',
          offsetValue: 4,
        });

        const controller = new AbortController();
        const { signal } = controller;

        document.addEventListener('mousedown', (e: MouseEvent) => {
          const target = e.target as Node | null;
          if (!target) return;
          if (panel.contains(target)) return;
          if (trigger.contains(target)) return;
          emit('close');
        }, { signal });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            emit('close');
          }
        }, { signal });

        // Cooperative dismissal: other overlays (color picker, link popover)
        // broadcast this event when opening; our dropdown closes in response.
        // We deliberately do NOT broadcast it ourselves - the bubble menu
        // plugin listens for it and would hide, taking our trigger with it.
        const editorEl = trigger.closest<HTMLElement>('.dm-editor');
        editorEl?.addEventListener('dm:dismiss-overlays', () => { emit('close'); }, { signal });

        onCleanup(() => {
          controller.abort();
          cleanupFloating();
        });
      },
      { flush: 'post' },
    );

    return () => {
      // Read activeVersion to subscribe to active-state changes.
      void props.activeVersion;
      const dropdown = props.dropdown;
      const dropdownActive = dropdown.items.some((sub) => props.isItemActive(sub));
      const activeChild = dropdown.dynamicIcon
        ? dropdown.items.find((sub) => props.isItemActive(sub))
        : undefined;
      const triggerIcon = activeChild?.icon ?? dropdown.icon;
      const triggerHtml = (defaultIcons[triggerIcon] ?? props.getCachedIcon(triggerIcon)) + DROPDOWN_CARET;

      return h('div', {
        class: 'dm-toolbar-dropdown-wrapper',
        'data-dropdown-wrapper': dropdown.name,
      }, [
        h('button', {
          ref: triggerRef,
          type: 'button',
          class: ['dm-toolbar-button', 'dm-toolbar-dropdown-trigger', dropdownActive && 'dm-toolbar-button--active'],
          'aria-expanded': props.isOpen,
          'aria-haspopup': 'true',
          'aria-label': dropdown.label,
          title: dropdown.label,
          'data-dropdown': dropdown.name,
          innerHTML: triggerHtml,
          onMousedown: (e: MouseEvent) => { e.preventDefault(); },
          onClick: () => { emit('toggle'); },
        }),
        props.isOpen
          ? h('div', {
            ref: panelRef,
            class: 'dm-toolbar-dropdown-panel',
            role: 'menu',
            'data-dm-editor-ui': '',
            'data-dropdown-panel': dropdown.name,
          }, dropdown.items.map((sub) => {
            const subActive = props.isItemActive(sub);
            const subHtml = `${defaultIcons[sub.icon] ?? props.getCachedIcon(sub.icon)} ${sub.label}`;
            return h('button', {
              key: sub.name,
              type: 'button',
              class: ['dm-toolbar-dropdown-item', subActive && 'dm-toolbar-dropdown-item--active'],
              role: 'menuitem',
              'aria-label': sub.label,
              innerHTML: subHtml,
              onMousedown: (e: MouseEvent) => { e.preventDefault(); },
              onClick: () => { props.executeSubItem(sub); },
            });
          }))
          : null,
      ]);
    };
  },
});
