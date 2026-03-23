import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactNodeViewProvider, type ReactNodeViewContextValue } from './ReactNodeViewContext.js';
import type { Editor } from '@domternal/core';

/**
 * Props passed to custom React node view components.
 */
export interface ReactNodeViewProps {
  /** The editor instance. */
  editor: Editor;
  /** The ProseMirror node being rendered. */
  node: { type: { name: string; spec: { group?: string } }; attrs: Record<string, unknown>; textContent: string };
  /** Whether this node is selected via NodeSelection. */
  selected: boolean;
  /** Get the document position of this node. */
  getPos: () => number;
  /** Update the node's attributes. */
  updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Delete this node from the document. */
  deleteNode: () => void;
}

export interface ReactNodeViewRendererOptions {
  /** Wrapper element tag. @default 'div' for block, 'span' for inline */
  as?: string;
  /** Additional CSS class on the wrapper element. */
  className?: string;
  /** Tag for the content DOM element. Set to null for no editable content. @default 'div' */
  contentDOMElement?: string | null;
}

interface NodeViewRendererProps {
  editor: Editor;
  node: ReactNodeViewProps['node'];
  getPos: () => number;
  decorations: unknown[];
  extension: { options: Record<string, unknown> };
}

/**
 * Converts a React component into a ProseMirror NodeView renderer.
 *
 * @example
 * ```ts
 * const ImageExtension = Image.extend({
 *   addNodeView() {
 *     return ReactNodeViewRenderer(ImageComponent);
 *   }
 * });
 * ```
 */
export function ReactNodeViewRenderer(
  component: React.ComponentType<ReactNodeViewProps>,
  options: ReactNodeViewRendererOptions = {},
) {
  return (props: NodeViewRendererProps) => {
    return new ReactNodeView(component, props, options);
  };
}

class ReactNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  private root: Root;
  private component: React.ComponentType<ReactNodeViewProps>;
  private editor: Editor;
  private node: ReactNodeViewProps['node'];
  private getPos: () => number;
  private selected = false;

  constructor(
    component: React.ComponentType<ReactNodeViewProps>,
    props: NodeViewRendererProps,
    options: ReactNodeViewRendererOptions,
  ) {
    this.component = component;
    this.editor = props.editor;
    this.node = props.node;
    this.getPos = props.getPos;

    const isInline = props.node.type.spec.group === 'inline';
    const tag = options.as ?? (isInline ? 'span' : 'div');

    this.dom = document.createElement(tag);
    this.dom.setAttribute('data-node-view-wrapper', '');
    if (options.className) {
      this.dom.className = options.className;
    }

    // Content DOM for editable nested content
    if (options.contentDOMElement !== null) {
      const contentTag = options.contentDOMElement ?? (isInline ? 'span' : 'div');
      this.contentDOM = document.createElement(contentTag);
      this.contentDOM.setAttribute('data-node-view-content', '');
      this.contentDOM.style.whiteSpace = 'pre-wrap';
    }

    this.root = createRoot(this.dom);
    this.render();
  }

  private render() {
    const contextValue: ReactNodeViewContextValue = {
      onDragStart: (event: DragEvent) => {
        const view = this.editor.view;
        const pos = this.getPos();
        // Set ProseMirror drag data
        if (view.dragging) {
          event.dataTransfer?.setData('text/plain', this.node.textContent);
        }
        void pos;
      },
      nodeViewContentRef: (el: HTMLElement | null) => {
        if (el && this.contentDOM && !el.contains(this.contentDOM)) {
          el.appendChild(this.contentDOM);
        }
      },
    };

    const props: ReactNodeViewProps = {
      editor: this.editor,
      node: this.node,
      selected: this.selected,
      getPos: this.getPos,
      updateAttributes: (attrs) => {
        const pos = this.getPos();
        const { tr } = this.editor.view.state;
        tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
        this.editor.view.dispatch(tr);
      },
      deleteNode: () => {
        const pos = this.getPos();
        const { tr } = this.editor.view.state;
        tr.delete(pos, pos + 1);
        this.editor.view.dispatch(tr);
      },
    };

    this.root.render(
      createElement(ReactNodeViewProvider, { value: contextValue },
        createElement(this.component, props),
      ),
    );
  }

  update(node: ReactNodeViewProps['node']): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.selected = true;
    this.render();
  }

  deselectNode() {
    this.selected = false;
    this.render();
  }

  destroy() {
    // Defer unmount to avoid React warnings about synchronous unmount
    const root = this.root;
    setTimeout(() => root.unmount(), 0);
  }

  ignoreMutation(mutation: MutationRecord): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(mutation.target);
  }

  stopEvent(): boolean {
    return false;
  }
}
