import { type ElementType, type HTMLAttributes } from 'react';
import { useReactNodeView } from './ReactNodeViewContext.js';

export interface NodeViewWrapperProps extends HTMLAttributes<HTMLElement> {
  /** The HTML element type to render. @default 'div' */
  as?: ElementType;
}

/**
 * Container component for custom React node views.
 * Handles drag events and marks the element as a node view wrapper.
 */
export function NodeViewWrapper({ as: Tag = 'div', style, ...props }: NodeViewWrapperProps) {
  const { onDragStart } = useReactNodeView();

  return (
    <Tag
      {...props}
      data-node-view-wrapper=""
      style={{ whiteSpace: 'normal', ...style }}
      onDragStart={onDragStart}
    />
  );
}
