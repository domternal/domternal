/**
 * DomternalNotionColorPicker
 *
 * Notion-style inline color picker rendered via `<Teleport>` into the
 * `.dm-editor` host. The teleport target keeps the panel inside the editor's
 * CSS-variable scope (theme tokens cascade) without imperative DOM moves.
 *
 * Opens in response to the `notionColorOpen` event emitted by the bubble
 * menu's "A" trigger. Two sections: text color (top), background color
 * (bottom). Each section is a default-swatch plus the named-token palette.
 *
 * The default UI is rendered when no slot content is provided. Pass a
 * default scoped slot to take over rendering while keeping the composable's
 * lifecycle - the slot receives the full `useNotionColorPicker` API.
 */
import { computed, defineComponent, h, Teleport, watch } from 'vue';
import type { PropType, ShallowRef, VNode } from 'vue';
import { positionFloating } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useNotionColorPicker, type UseNotionColorPickerResult } from './useNotionColorPicker.js';

export interface DomternalNotionColorPickerProps {
  /** The editor instance. If omitted, uses provideEditor context. */
  editor?: Editor;
}

export const DomternalNotionColorPicker = defineComponent({
  name: 'DomternalNotionColorPicker',
  props: {
    editor: { type: Object as PropType<Editor>, default: undefined },
  },
  setup(props, { slots }) {
    const { editor: contextEditor } = useCurrentEditor();
    // `computed` returns ComputedRef but the composables expect ShallowRef. Cast
    // is safe (both share the same .value interface and watch subscribes to either)
    // and matches the wrapper convention (see useEmojiPicker / DomternalBubbleMenu).
    const editorRef = computed(() => props.editor ?? contextEditor.value) as ShallowRef<Editor | null>;

    const api = useNotionColorPicker({ editor: editorRef });
    const {
      isOpen,
      hostEl,
      anchorEl,
      panelRef,
      currentTextToken,
      currentBgToken,
      palette,
      applyText,
      applyBg,
      tokenLabel,
      onPanelKeydown,
    } = api;

    // Position + two-rAF focus chain. `flush: 'post'` waits for the panel to
    // mount inside the Teleport target before measuring + focusing. Cleanup
    // cancels pending rAFs to avoid racing the panel unmount.
    watch(
      [isOpen, anchorEl],
      ([open, anchor], _old, onCleanup) => {
        if (!open || !anchor || !panelRef.value) return;
        const panel = panelRef.value;

        const cleanupFloating = positionFloating(anchor, panel, {
          placement: 'bottom-start',
          offsetValue: 4,
        });

        // Second rAF waits for paint so focus doesn't race the bubble-menu blur.
        let id2 = 0;
        const id1 = requestAnimationFrame(() => {
          id2 = requestAnimationFrame(() => {
            if (!panel.isConnected) return;
            const active = panel.querySelector<HTMLElement>('.dm-ncp-swatch.dm-ncp-active');
            const fallback = panel.querySelector<HTMLElement>('.dm-ncp-swatch--text[data-color="null"]');
            (active ?? fallback)?.focus({ preventScroll: true });
          });
        });

        onCleanup(() => {
          cancelAnimationFrame(id1);
          if (id2) cancelAnimationFrame(id2);
          cleanupFloating();
        });
      },
      { flush: 'post' },
    );

    const renderDefaultPanel = (): VNode[] => {
      const tToken = currentTextToken.value;
      const bToken = currentBgToken.value;
      const pal = palette.value;
      return [
        h('div', { class: 'dm-ncp-section' }, [
          h('div', { class: 'dm-ncp-label' }, 'Text color'),
          h('div', { class: 'dm-ncp-grid' }, [
            h('button', {
              type: 'button',
              class: ['dm-ncp-swatch', 'dm-ncp-swatch--text', tToken === null && 'dm-ncp-active'],
              'aria-pressed': tToken === null,
              'data-color': 'null',
              title: 'Default text color',
              'aria-label': 'Default text color',
              onMousedown: (e: MouseEvent) => { e.preventDefault(); },
              onClick: () => { applyText(null); },
            }),
            ...pal.map((t) => h('button', {
              key: t,
              type: 'button',
              class: ['dm-ncp-swatch', 'dm-ncp-swatch--text', tToken === t && 'dm-ncp-active'],
              'aria-pressed': tToken === t,
              'data-color': t,
              title: tokenLabel(t),
              'aria-label': `${tokenLabel(t)} text`,
              onMousedown: (e: MouseEvent) => { e.preventDefault(); },
              onClick: () => { applyText(t); },
            })),
          ]),
        ]),
        h('div', { class: 'dm-ncp-section' }, [
          h('div', { class: 'dm-ncp-label' }, 'Background color'),
          h('div', { class: 'dm-ncp-grid' }, [
            h('button', {
              type: 'button',
              class: ['dm-ncp-swatch', 'dm-ncp-swatch--bg', bToken === null && 'dm-ncp-active'],
              'aria-pressed': bToken === null,
              'data-color': 'null',
              title: 'Default background',
              'aria-label': 'Default background',
              onMousedown: (e: MouseEvent) => { e.preventDefault(); },
              onClick: () => { applyBg(null); },
            }),
            ...pal.map((t) => h('button', {
              key: t,
              type: 'button',
              class: ['dm-ncp-swatch', 'dm-ncp-swatch--bg', bToken === t && 'dm-ncp-active'],
              'aria-pressed': bToken === t,
              'data-color': t,
              title: `${tokenLabel(t)} background`,
              'aria-label': `${tokenLabel(t)} background`,
              onMousedown: (e: MouseEvent) => { e.preventDefault(); },
              onClick: () => { applyBg(t); },
            })),
          ]),
        ]),
      ];
    };

    return () => {
      // SSR-safe: render nothing until the picker is open AND the editor host
      // has been resolved. Teleport's target must be a real DOM node.
      if (!isOpen.value || !hostEl.value) return null;

      const slot = slots['default'];
      const slotChildren = slot ? slot({ api } as { api: UseNotionColorPickerResult }) : undefined;
      const panelChildren = slotChildren ?? renderDefaultPanel();

      return h(Teleport, { to: hostEl.value }, [
        h('div', {
          ref: panelRef,
          class: 'dm-notion-color-picker',
          'data-show': '',
          'data-dm-editor-ui': '',
          role: 'dialog',
          'aria-label': 'Text and background color',
          // Intentional non-modal: the picker doesn't trap focus (outside-click
          // closes, editor stays interactive). `role="dialog"` defaults to
          // modal=true for screen readers, so we explicitly opt out.
          'aria-modal': 'false',
          onKeydown: onPanelKeydown,
        }, panelChildren),
      ]);
    };
  },
});
