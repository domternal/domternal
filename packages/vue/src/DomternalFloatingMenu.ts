import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type { PropType } from 'vue';
import {
  PluginKey,
  FloatingMenuController,
  defaultIcons,
} from '@domternal/core';
import type {
  Editor,
  FloatingMenuItem,
  FloatingMenuItemsOverride,
  IconSet,
} from '@domternal/core';
import { createFloatingMenuPlugin } from '@domternal/extension-block-menu';
import type {
  FloatingMenuKeymap,
  FloatingMenuOptions,
} from '@domternal/extension-block-menu';
import { useCurrentEditor } from './EditorContext.js';

export interface DomternalFloatingMenuProps {
  editor?: Editor;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: number;
  items?: FloatingMenuItemsOverride;
  keymap?: FloatingMenuKeymap;
  icons?: IconSet;
}

export const DomternalFloatingMenu = defineComponent({
  name: 'DomternalFloatingMenu',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
    shouldShow: { type: Function as PropType<FloatingMenuOptions['shouldShow']>, default: undefined },
    offset: { type: Number, default: 0 },
    items: {
      type: [Array, Function] as PropType<FloatingMenuItemsOverride>,
      default: undefined,
    },
    keymap: { type: Object as PropType<FloatingMenuKeymap>, default: undefined },
    icons: { type: Object as PropType<IconSet>, default: undefined },
  },
  setup(props, { slots }) {
    const { editor: contextEditor } = useCurrentEditor();
    const menuRef = ref<HTMLDivElement>();
    const pluginKey = new PluginKey(
      'vueFloatingMenu-' + Math.random().toString(36).slice(2, 8),
    );

    // Reactive controller state exposed to the render function.
    const controller = shallowRef<FloatingMenuController | null>(null);
    // Bump tracker forces re-renders when controller state changes without
    // swapping the controller instance.
    const version = ref(0);

    let registered = false;
    let stopWatch: (() => void) | null = null;
    let currentEditor: Editor | null = null;

    const resolveIcon = (name?: string): string => {
      if (!name) return '';
      return props.icons?.[name] ?? defaultIcons[name] ?? '';
    };

    const doRegister = (editor: Editor): void => {
      if (registered || editor.isDestroyed || !menuRef.value) return;
      registered = true;
      currentEditor = editor;

      const plugin = createFloatingMenuPlugin({
        pluginKey,
        editor,
        element: menuRef.value,
        ...(props.shouldShow && { shouldShow: props.shouldShow }),
        offset: props.offset,
        ...(props.keymap && { keymap: props.keymap }),
      });
      editor.registerPlugin(plugin);

      // Only create a controller when consumer did not supply custom
      // content via the default slot; in that case they own the rendering
      // and we stay out of their way.
      const hasCustomSlot = Boolean(slots['default']);
      if (!hasCustomSlot) {
        const ctl = new FloatingMenuController(editor, () => { version.value++; }, props.items);
        ctl.subscribe();
        controller.value = ctl;
      }
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

    // Imperatively focus the active menuitem when focusedIndex changes.
    watch(
      () => [controller.value?.focusedIndex ?? -1, version.value] as const,
      ([focusedIndex]) => {
        if (focusedIndex < 0 || !menuRef.value) return;
        void nextTick(() => {
          const target = menuRef.value?.querySelector<HTMLElement>(
            `[data-floating-menu-index="${String(focusedIndex)}"]`,
          );
          target?.focus();
        });
      },
    );

    onScopeDispose(() => {
      stopWatch?.();
      controller.value?.destroy();
      controller.value = null;
      const editor = currentEditor ?? props.editor ?? contextEditor.value;
      if (editor && !editor.isDestroyed) {
        editor.unregisterPlugin(pluginKey);
      }
    });

    const onItemClick = (item: FloatingMenuItem): void => {
      const ctl = controller.value;
      const ed = currentEditor;
      if (!ctl || !ed) return;
      ctl.execute(item);
      requestAnimationFrame(() => { ed.view.focus(); });
    };

    const onMenuKeyDown = (e: KeyboardEvent): void => {
      const ctl = controller.value;
      if (!ctl) return;
      const focused = ctl.focusedItem();
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          ctl.next();
          return;
        case 'ArrowUp':
          e.preventDefault();
          ctl.prev();
          return;
        case 'Home':
          e.preventDefault();
          ctl.first();
          return;
        case 'End':
          e.preventDefault();
          ctl.last();
          return;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          ctl.leaveMenu();
          currentEditor?.view.focus();
          return;
        case 'Enter':
        case ' ':
          if (focused) {
            e.preventDefault();
            onItemClick(focused);
          }
          return;
        default:
          return;
      }
    };

    return () => {
      // Custom slot: consumer owns rendering.
      if (slots['default']) {
        return h(
          'div',
          { ref: menuRef, class: 'dm-floating-menu', 'data-dm-editor-ui': '' },
          slots['default'](),
        );
      }

      // Default render: groups of menu items from the controller.
      const ctl = controller.value;
      // Read version to ensure reactivity on state changes.
      void version.value;
      const groups = ctl?.groups ?? [];
      const focusedIndex = ctl?.focusedIndex ?? -1;

      // Flat index map for roving tabindex.
      const flatNames = groups.flatMap((g) => g.items.map((i) => i.name));

      return h(
        'div',
        {
          ref: menuRef,
          class: 'dm-floating-menu',
          role: 'menu',
          'aria-label': 'Insert block',
          'data-dm-editor-ui': '',
          onKeydown: onMenuKeyDown,
        },
        groups.map((group, gi) => {
          const groupId = `dm-fm-g${String(gi)}`;
          return h('div', { key: group.name || `__group-${String(gi)}`, class: 'dm-floating-menu-group-wrapper' }, [
            group.name
              ? h('div', { class: 'dm-floating-menu-group-label', id: groupId }, group.name)
              : null,
            h(
              'div',
              {
                class: 'dm-floating-menu-group',
                role: 'group',
                ...(group.name ? { 'aria-labelledby': groupId } : {}),
              },
              group.items.map((item) => {
                const flatIndex = flatNames.indexOf(item.name);
                const isFocused = flatIndex === focusedIndex;
                const disabled = ctl?.isDisabled(item) ?? false;
                const iconHtml = resolveIcon(item.icon);
                return h(
                  'button',
                  {
                    key: item.name,
                    type: 'button',
                    role: 'menuitem',
                    class: 'dm-floating-menu-item',
                    'data-floating-menu-item': item.name,
                    'data-floating-menu-index': String(flatIndex),
                    tabindex: isFocused || (focusedIndex < 0 && flatIndex === 0) ? 0 : -1,
                    'aria-disabled': disabled ? 'true' : undefined,
                    'aria-keyshortcuts': item.shortcut,
                    disabled,
                    onMousedown: (e: Event) => { e.preventDefault(); },
                    onClick: () => { onItemClick(item); },
                  },
                  [
                    iconHtml
                      ? h('span', {
                        class: 'dm-floating-menu-item-icon',
                        'aria-hidden': 'true',
                        innerHTML: iconHtml,
                      })
                      : null,
                    h('span', { class: 'dm-floating-menu-item-label' }, item.label),
                    item.shortcut
                      ? h('span', { class: 'dm-floating-menu-item-shortcut', 'aria-hidden': 'true' }, item.shortcut)
                      : null,
                  ],
                );
              }),
            ),
          ]);
        }),
      );
    };
  },
});
