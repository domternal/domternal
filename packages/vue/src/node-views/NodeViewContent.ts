import { defineComponent, h, inject } from 'vue';
import { NODE_VIEW_CONTENT_REF } from './VueNodeViewContext.js';

/**
 * Placeholder for editable nested content within a node view.
 * ProseMirror manages the content DOM - do not render children inside this component.
 *
 * @example
 * ```vue
 * <template>
 *   <NodeViewWrapper>
 *     <h3>Custom heading</h3>
 *     <NodeViewContent />
 *   </NodeViewWrapper>
 * </template>
 * ```
 */
export const NodeViewContent = defineComponent({
  name: 'NodeViewContent',
  props: {
    as: { type: String, default: 'div' },
  },
  setup(props, { attrs }) {
    const nodeViewContentRef = inject(NODE_VIEW_CONTENT_REF, undefined);

    return () => {
      const baseProps: Record<string, unknown> = {
        ...attrs,
        'data-node-view-content': '',
        style: { whiteSpace: 'pre-wrap', ...(attrs.style as Record<string, string> | undefined) },
      };
      if (nodeViewContentRef) {
        baseProps['ref'] = nodeViewContentRef;
      }
      return h(props.as, baseProps);
    };
  },
});
