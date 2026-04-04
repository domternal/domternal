import { inject } from 'vue';
import type { InjectionKey } from 'vue';

/**
 * Injection key for the drag start handler in node views.
 * Provided by VueNodeViewRenderer's extended component,
 * consumed by NodeViewWrapper.
 */
export const NODE_VIEW_ON_DRAG_START: InjectionKey<(event: DragEvent) => void> =
  Symbol('domternal-node-view-drag');

/**
 * Injection key for the content DOM ref callback in node views.
 * Provided by VueNodeViewRenderer's extended component,
 * consumed by NodeViewContent.
 */
export const NODE_VIEW_CONTENT_REF: InjectionKey<(el: HTMLElement | null) => void> =
  Symbol('domternal-node-view-content');

/**
 * Convenience composable for accessing node view context.
 * Use inside custom node view components built with VueNodeViewRenderer.
 *
 * @example
 * ```ts
 * const { onDragStart, nodeViewContentRef } = useVueNodeView();
 * ```
 */
export function useVueNodeView() {
  const onDragStart = inject(NODE_VIEW_ON_DRAG_START, undefined);
  const nodeViewContentRef = inject(NODE_VIEW_CONTENT_REF, undefined);
  return { onDragStart, nodeViewContentRef };
}
