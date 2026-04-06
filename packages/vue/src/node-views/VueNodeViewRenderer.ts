import { defineComponent, h, markRaw, provide, reactive, render } from 'vue';
import type { AppContext, Component } from 'vue';
import type { Editor, NodeViewContext } from '@domternal/core';
import { appContextStore } from '../utils.js';
import { NODE_VIEW_ON_DRAG_START, NODE_VIEW_CONTENT_REF } from './VueNodeViewContext.js';

/** ProseMirror node shape passed to node views. */
interface PMNode {
  type: { name: string; spec: { group?: string } };
  attrs: Record<string, unknown>;
  textContent: string;
}

/**
 * Props passed to custom Vue node view components.
 */
export interface VueNodeViewProps {
  editor: Editor;
  node: PMNode;
  selected: boolean;
  getPos: () => number;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  deleteNode: () => void;
  extension: { name: string; options: Record<string, unknown> };
  decorations: unknown[];
}

export interface VueNodeViewRendererOptions {
  /** Wrapper element tag. @default 'div' for block, 'span' for inline */
  as?: string;
  /** Additional CSS class on the wrapper element. */
  className?: string;
  /** Tag for the content DOM element. Set to null for no editable content. @default 'div' */
  contentDOMElement?: string | null;
}

/**
 * Converts a Vue component into a ProseMirror NodeView constructor.
 *
 * Uses Vue's low-level `render(h(), el)` API with appContext forwarding
 * so that provide/inject from the parent component tree works inside
 * node view components.
 *
 * @example
 * ```ts
 * const ImageExtension = Image.extend({
 *   addNodeView() {
 *     return VueNodeViewRenderer(ImageComponent);
 *   }
 * });
 * ```
 */
export function VueNodeViewRenderer(
  component: Component,
  options: VueNodeViewRendererOptions = {},
) {
  // Handle class-based Vue components with __vccOpts
  const normalizedComponent = typeof component === 'function' && '__vccOpts' in component
    ? (component as unknown as Record<string, Component>)['__vccOpts']
    : component;

  markRaw(normalizedComponent);

  const constructor = (node: PMNode, _view: unknown, getPos: () => number, decorations: unknown[]) => {
    const ctx = (constructor as unknown as { __domternalContext?: NodeViewContext }).__domternalContext;
    const editor = ctx?.editor as Editor;
    const extension = ctx?.extension ?? { name: node.type.name, options: {} };

    // Guard: if appContext not stored yet (EditorContent hasn't mounted), return empty NodeView
    const appContext = editor ? appContextStore.get(editor) : undefined;
    if (!appContext) {
      const dom = document.createElement('div');
      return { dom, update: () => false, destroy: () => {} } as unknown as ReturnType<typeof constructor>;
    }

    return new VueNodeView(normalizedComponent, {
      editor,
      node,
      getPos,
      decorations,
      extension,
    }, options, appContext);
  };

  return constructor;
}

interface VueNodeViewInit {
  editor: Editor;
  node: PMNode;
  getPos: () => number;
  decorations: unknown[];
  extension: { name: string; options: Record<string, unknown> };
}

class VueNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  private props: VueNodeViewProps;
  private editor: Editor;
  private appContext: AppContext;

  constructor(
    component: Component,
    init: VueNodeViewInit,
    options: VueNodeViewRendererOptions,
    appContext: AppContext,
  ) {
    this.editor = init.editor;
    this.appContext = appContext;

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

    const contentDOM = this.contentDOM;

    // Create reactive props - property mutations auto-trigger Vue re-renders
    this.props = reactive({
      editor: markRaw(init.editor),
      node: markRaw(init.node),
      selected: false,
      getPos: init.getPos,
      extension: init.extension,
      decorations: init.decorations,
      updateAttributes: (attrs: Record<string, unknown>) => {
        const pos = init.getPos();
        const { tr } = this.editor.view.state;
        tr.setNodeMarkup(pos, undefined, { ...this.props.node.attrs, ...attrs });
        this.editor.view.dispatch(tr);
      },
      deleteNode: () => {
        const pos = init.getPos();
        const { tr } = this.editor.view.state;
        tr.delete(pos, pos + 1);
        this.editor.view.dispatch(tr);
      },
    }) as VueNodeViewProps;

    // Create extended component that provides node view context
    const onDragStart = (event: DragEvent) => {
      if (this.editor.view.dragging) {
        event.dataTransfer?.setData('text/plain', this.props.node.textContent);
      }
    };

    const contentRefCallback = (el: HTMLElement | null) => {
      if (el && contentDOM && !el.contains(contentDOM)) {
        el.appendChild(contentDOM);
      }
    };

    const extended = defineComponent({
      extends: { ...component } as ReturnType<typeof defineComponent>,
      props: Object.keys(this.props) as (keyof VueNodeViewProps)[],
      setup: (reactiveProps: VueNodeViewProps) => {
        provide(NODE_VIEW_ON_DRAG_START, onDragStart);
        provide(NODE_VIEW_CONTENT_REF, contentRefCallback);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (component as any).setup?.(reactiveProps, { expose: () => {} });
      },
      // Preserve scoped CSS and devtools metadata
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __scopeId: (component as any).__scopeId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __cssModules: (component as any).__cssModules,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __name: (component as any).__name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __file: (component as any).__file,
    });

    // Render with appContext forwarding for provide/inject chain
    const vNode = h(extended, this.props);
    vNode.appContext = this.appContext;
    render(vNode, this.dom);
  }

  update(node: PMNode, decorations: unknown[]): boolean {
    if (node.type.name !== this.props.node.type.name) return false;
    this.props.node = markRaw(node);
    this.props.decorations = decorations;
    return true;
  }

  selectNode() {
    this.props.selected = true;
  }

  deselectNode() {
    this.props.selected = false;
  }

  destroy() {
    render(null, this.dom);
  }

  ignoreMutation(mutation: MutationRecord): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(mutation.target);
  }

  stopEvent(): boolean {
    return false;
  }
}
