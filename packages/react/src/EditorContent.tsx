import { useEffect, useRef, type HTMLAttributes, type Ref } from 'react';
import type { Editor } from '@domternal/core';

export interface EditorContentProps extends HTMLAttributes<HTMLDivElement> {
  /** The editor instance to render. */
  editor: Editor | null;
  /** Ref to the underlying div element. */
  innerRef?: Ref<HTMLDivElement>;
}

/**
 * Renders the ProseMirror editor view into a div element.
 *
 * Use this with `useEditor` for a flexible, decoupled pattern where the
 * editor hook and rendering are separated:
 *
 * @example
 * ```tsx
 * const { editor } = useEditor({ extensions, content });
 * return <EditorContent editor={editor} className="my-editor" />;
 * ```
 */
export function EditorContent({ editor, innerRef, ...htmlProps }: EditorContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor || editor.isDestroyed) return;

    // If the editor already has a view, move its DOM into this container
    const editorDom = editor.view.dom;
    if (editorDom.parentElement !== container) {
      container.appendChild(editorDom);
    }

    return () => {
      // Don't remove the DOM on unmount - the editor manages its own DOM lifecycle
    };
  }, [editor]);

  return (
    <div
      ref={(node) => {
        (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof innerRef === 'function') innerRef(node);
        else if (innerRef) (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      {...htmlProps}
    />
  );
}
