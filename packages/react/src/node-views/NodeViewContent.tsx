import { type ElementType, type HTMLAttributes } from 'react';
import { useReactNodeView } from './ReactNodeViewContext.js';

export interface NodeViewContentProps extends HTMLAttributes<HTMLElement> {
  /** The HTML element type to render. @default 'div' */
  as?: ElementType;
}

/**
 * Placeholder for editable nested content within a custom React node view.
 * ProseMirror manages the content DOM inside this element.
 */
export function NodeViewContent({ as: Tag = 'div', style, ...props }: NodeViewContentProps) {
  const { nodeViewContentRef } = useReactNodeView();

  return (
    <Tag
      {...props}
      ref={nodeViewContentRef}
      data-node-view-content=""
      style={{ whiteSpace: 'pre-wrap', ...style }}
    />
  );
}
