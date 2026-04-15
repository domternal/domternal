import { defineComponent, h, markRaw, provide, render, shallowReactive } from 'vue';
import type { AppContext, Component } from 'vue';
import type { Editor, NodeViewContext } from '@domternal/core';
import { appContextStore, pendingAppContextStore } from '../utils.js';
import { NODE_VIEW_ON_DRAG_START, NODE_VIEW_CONTENT_REF } from './VueNodeViewContext.js';

/** ProseMirror node shape passed to node views. */
interface PMNode {
  type: { name: string; spec: { group?: string } };
  attrs: Record<string, unknown>;
  textContent: string;
  nodeSize: number;
}

/**
 * Props passed to custom Vue node view components.
 */
export interface VueNodeViewProps {
  editor: Editor;
  node: PMNode;
  selected: boolean;
  getPos: () => number | undefined;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  deleteNode: () => void;
  extension: { name: string; options: Record<string, unknown> };
  decorations: readonly unknown[];
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
  const normalizedComponent: Component = typeof component === 'function' && '__vccOpts' in component
    ? ((component as unknown as Record<string, Component>)['__vccOpts'] ?? component)
    : component;

  markRaw(normalizedComponent);

  const constructor = (node: PMNode, _view: unknown, getPos: () => number | undefined, decorations: readonly unknown[]): VueNodeView | { dom: HTMLElement; update: () => boolean; destroy: () => void } => {
    const ctx = (constructor as unknown as { __domternalContext?: NodeViewContext }).__domternalContext;
    const editor = ctx?.editor as Editor;
    const extension = ctx?.extension ?? { name: node.type.name, options: {} };

    // Look up appContext for this editor. Node view constructors fire DURING
    // new Editor() (before editor.value is set by useEditor), so the
    // per-editor store may be empty. Fall back to pendingAppContextStore
    // which provideEditor() populates synchronously on setup.
    // If neither is found, provideEditor() was never called - warn and bail.
    let appContext = editor ? appContextStore.get(editor) : undefined;
    if (!appContext) {
      appContext = pendingAppContextStore.value ?? undefined;
      if (appContext && editor) {
        // Associate with the editor so later updates use the per-editor entry
        appContextStore.set(editor, appContext);
      }
    }
    if (!appContext) {
      if (typeof globalThis !== 'undefined' && (globalThis as { __DEV__?: boolean }).__DEV__ !== false) {
        console.warn(
          '[VueNodeViewRenderer] appContext not found for editor. ' +
          'Custom Vue node views require provideEditor(editor) to be called, ' +
          'either manually after useEditor() or automatically via <Domternal> root.',
        );
      }
      const dom = document.createElement('div');
      return { dom, update: () => false, destroy: () => {} };
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
  getPos: () => number | undefined;
  decorations: readonly unknown[];
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

    // Shallow-reactive props: only top-level mutations trigger re-renders.
    // Editor/node are markRaw'd (skipped by reactivity anyway); shallowReactive
    // avoids Vue walking into them on every access.
    this.props = shallowReactive({
      editor: markRaw(init.editor),
      node: markRaw(init.node),
      selected: false,
      getPos: init.getPos,
      extension: init.extension,
      decorations: init.decorations,
      updateAttributes: (attrs: Record<string, unknown>) => {
        const pos = init.getPos();
        if (pos === undefined) return;
        const { tr } = this.editor.view.state;
        tr.setNodeMarkup(pos, undefined, { ...this.props.node.attrs, ...attrs });
        this.editor.view.dispatch(tr);
      },
      deleteNode: () => {
        const pos = init.getPos();
        if (pos === undefined) return;
        const { tr } = this.editor.view.state;
        tr.delete(pos, pos + this.props.node.nodeSize);
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

    // Wrapper component that provides node-view context to the user's
    // component and renders it as a child. Using a wrapper (instead of
    // h(component, reactiveProps) directly) ensures that mutations on
    // `reactiveProps` reliably propagate to the child: the wrapper's render
    // function re-runs on reactive changes, and the child component
    // receives a fresh props reference each time.
    const reactiveProps = this.props;
    const extended = defineComponent({
      setup() {
        provide(NODE_VIEW_ON_DRAG_START, onDragStart);
        provide(NODE_VIEW_CONTENT_REF, contentRefCallback);
        // Return render function that reads from reactiveProps - accessing
        // any reactive property creates a dependency, triggering re-render.
        return () =>
          h(component, {
            editor: reactiveProps.editor,
            node: reactiveProps.node,
            selected: reactiveProps.selected,
            getPos: reactiveProps.getPos,
            updateAttributes: reactiveProps.updateAttributes,
            deleteNode: reactiveProps.deleteNode,
            extension: reactiveProps.extension,
            decorations: reactiveProps.decorations,
          });
      },
    });

    // Render with appContext forwarding for provide/inject chain
    const vNode = h(extended);
    vNode.appContext = this.appContext;
    render(vNode, this.dom);
  }

  update(node: PMNode, decorations: readonly unknown[]): boolean {
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

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(mutation.target);
  }

  stopEvent(): boolean {
    return false;
  }
}
