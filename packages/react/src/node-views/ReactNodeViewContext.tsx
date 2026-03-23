import { createContext, useContext, type RefCallback } from 'react';

export interface ReactNodeViewContextValue {
  onDragStart: (event: DragEvent) => void;
  nodeViewContentRef: RefCallback<HTMLElement>;
}

const ReactNodeViewContext = createContext<ReactNodeViewContextValue | null>(null);

export const ReactNodeViewProvider = ReactNodeViewContext.Provider;

/**
 * Access node view internals from within a custom React node view component.
 * Used by NodeViewWrapper and NodeViewContent.
 */
export function useReactNodeView(): ReactNodeViewContextValue {
  const context = useContext(ReactNodeViewContext);
  if (!context) {
    throw new Error('useReactNodeView must be used within a ReactNodeViewRenderer component');
  }
  return context;
}
