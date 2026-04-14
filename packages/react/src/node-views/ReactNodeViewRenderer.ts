import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactNodeViewProvider, type ReactNodeViewContextValue } from './ReactNodeViewContext.js';
import type { Editor, NodeViewContext } from '@domternal/core';

/** ProseMirror node shape passed to node views. */
interface PMNode {
  type: { name: string; spec: { group?: string } };
  attrs: Record<string, unknown>;
  textContent: string;
  nodeSize: number;
}

/**
 * Props passed to custom React node view components.
 */
export interface ReactNodeViewProps {
  /** The editor instance. */
  editor: Editor;
  /** The ProseMirror node being rendered. */
  node: PMNode;
  /** Whether this node is selected via NodeSelection. */
  selected: boolean;
  /** Get the document position of this node. */
  getPos: () => number;
  /** Update the node's attributes. */
  updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Delete this node from the document. */
  deleteNode: () => void;
  /** The extension that created this node view (name, options). Injected by core. */
  extension: { name: string; options: Record<string, unknown> };
  /** ProseMirror decorations applied to this node. */
  decorations: unknown[];
}

export interface ReactNodeViewRendererOptions {
  /** Wrapper element tag. @default 'div' for block, 'span' for inline */
  as?: string;
  /** Additional CSS class on the wrapper element. */
  className?: string;
  /** Tag for the content DOM element. Set to null for no editable content. @default 'div' */
  contentDOMElement?: string | null;
}

/**
 * Converts a React component into a ProseMirror NodeView constructor.
 *
 * Returns a function matching ProseMirror's native `(node, view, getPos, decorations)` signature.
 * The editor and extension context are automatically injected by core via `__domternalContext`.
 *
 * @example
 * ```ts
 * const ImageExtension = Image.extend({
 *   addNodeView() {
 *     return ReactNodeViewRenderer(ImageComponent);
 *   }
 * });
 * ```
 *
 * @example Accessing extension options in the component
 * ```tsx
 * function ImageComponent({ node, extension, decorations }: ReactNodeViewProps) {
 *   const maxWidth = extension.options.maxWidth as number;
 *   return <NodeViewWrapper><img src={node.attrs.src} style={{ maxWidth }} /></NodeViewWrapper>;
 * }
 * ```
 */
export function ReactNodeViewRenderer(
  component: React.ComponentType<ReactNodeViewProps>,
  options: ReactNodeViewRendererOptions = {},
) {
  // Return ProseMirror-compatible NodeViewConstructor: (node, view, getPos, decorations) => NodeView
  const constructor = (node: PMNode, _view: unknown, getPos: () => number, decorations: unknown[]) => {
    // Read context injected by core's ExtensionManager.collectNodeViews()
    const ctx = (constructor as unknown as { __domternalContext?: NodeViewContext }).__domternalContext;
    const editor = ctx?.editor as Editor;
    const extension = ctx?.extension ?? { name: node.type.name, options: {} };

    return new ReactNodeView(component, {
      editor,
      node,
      getPos,
      decorations,
      extension,
    }, options);
  };

  return constructor;
}

interface ReactNodeViewInit {
  editor: Editor;
  node: PMNode;
  getPos: () => number;
  decorations: unknown[];
  extension: { name: string; options: Record<string, unknown> };
}

class ReactNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  private root: Root;
  private component: React.ComponentType<ReactNodeViewProps>;
  private editor: Editor;
  private node: PMNode;
  private getPos: () => number;
  private decorations: unknown[];
  private extension: { name: string; options: Record<string, unknown> };
  private selected = false;

  constructor(
    component: React.ComponentType<ReactNodeViewProps>,
    init: ReactNodeViewInit,
    options: ReactNodeViewRendererOptions,
  ) {
    this.component = component;
    this.editor = init.editor;
    this.node = init.node;
    this.getPos = init.getPos;
    this.decorations = init.decorations;
    this.extension = init.extension;

    const isInline = init.node.type.spec.group === 'inline';
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
        if (this.editor.view.dragging) {
          event.dataTransfer?.setData('text/plain', this.node.textContent);
        }
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
      extension: this.extension,
      decorations: this.decorations,
      updateAttributes: (attrs) => {
        const pos = this.getPos();
        const { tr } = this.editor.view.state;
        tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
        this.editor.view.dispatch(tr);
      },
      deleteNode: () => {
        const pos = this.getPos();
        const { tr } = this.editor.view.state;
        tr.delete(pos, pos + this.node.nodeSize);
        this.editor.view.dispatch(tr);
      },
    };

    this.root.render(
      createElement(ReactNodeViewProvider, { value: contextValue },
        createElement(this.component, props),
      ),
    );
  }

  update(node: PMNode, decorations: unknown[]): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.decorations = decorations;
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
