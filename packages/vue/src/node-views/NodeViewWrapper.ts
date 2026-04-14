import { defineComponent, h, inject } from 'vue';
import { NODE_VIEW_ON_DRAG_START } from './VueNodeViewContext.js';

/**
 * Container component for custom Vue node view UIs.
 * Must wrap the root element of every VueNodeViewRenderer component.
 *
 * @example
 * ```vue
 * <template>
 *   <NodeViewWrapper as="div">
 *     <img :src="node.attrs.src" />
 *   </NodeViewWrapper>
 * </template>
 * ```
 */
export const NodeViewWrapper = defineComponent({
  name: 'NodeViewWrapper',
  props: {
    as: { type: String, default: 'div' },
  },
  setup(props, { slots, attrs }) {
    const onDragStart = inject(NODE_VIEW_ON_DRAG_START, undefined);

    return () =>
      h(
        props.as,
        {
          ...attrs,
          'data-node-view-wrapper': '',
          style: { whiteSpace: 'normal', ...(attrs.style as Record<string, string> | undefined) },
          onDragstart: onDragStart,
        },
        slots['default']?.(),
      );
  },
});
