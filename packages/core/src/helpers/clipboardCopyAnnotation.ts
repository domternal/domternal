import { DOMSerializer } from '@domternal/pm/model';
import type { Fragment } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

/**
 * Receives the serialized copy before ProseMirror adds its slice marker and its table
 * wrappers. It may only annotate existing elements, never add, remove or reorder nodes.
 */
export type ClipboardCopyAnnotator = (fragment: DocumentFragment) => void;

interface Registration { readonly annotate: ClipboardCopyAnnotator }

const annotations = new WeakMap<EditorView, Registration>();

/**
 * @experimental Annotate the HTML this view serializes for copy, cut, drag and
 * `serializeForClipboard`, including a serializer from `clipboardHTMLTransform` or a plugin.
 * Views without a registration serialize exactly as before. A view accepts one active
 * registration: a second one throws instead of silently taking ownership. The returned
 * function removes only this registration. An annotator that throws never breaks the copy.
 */
export function registerClipboardCopyAnnotation(view: EditorView, annotate: ClipboardCopyAnnotator): () => void {
  if (typeof annotate !== 'function') throw new TypeError('Expected a clipboard copy annotator');
  if (view.isDestroyed) throw new Error('Cannot annotate clipboard copies of a destroyed view');
  if (annotations.has(view)) throw new Error('This view already has a clipboard copy annotation');
  const registration: Registration = { annotate };
  annotations.set(view, registration);
  return () => {
    if (annotations.get(view) === registration) annotations.delete(view);
  };
}

/** @internal Wrap the resolved clipboard serializer so a registered annotator sees its output. */
export function annotateClipboardSerializer(view: EditorView, serializer: DOMSerializer | undefined): DOMSerializer | undefined {
  const registration = annotations.get(view);
  if (registration === undefined) return serializer;
  const base = serializer ?? DOMSerializer.fromSchema(view.state.schema);
  // Every other member resolves through the prototype, so callers see the same serializer.
  return Object.create(base, {
    serializeFragment: {
      value: (fragment: Fragment, options?: { document?: Document }, target?: HTMLElement | DocumentFragment) => {
        const output = base.serializeFragment(fragment, options, target);
        if (target === undefined && output.nodeType === 11) {
          try { registration.annotate(output as DocumentFragment); } catch { /* Annotation is advisory; the copy must succeed. */ }
        }
        return output;
      },
    },
  }) as DOMSerializer;
}
