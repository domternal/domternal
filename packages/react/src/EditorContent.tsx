import { useEffect, useRef, type HTMLAttributes, type Ref, type ReactNode } from 'react';
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
export function EditorContent({ editor, innerRef, ...htmlProps }: EditorContentProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor || editor.isDestroyed) return;

    editor.adoptDom(container);

    return () => {
      if (!editor.isDestroyed && editor.view.dom.parentElement === container) {
        editor.adoptDom(document.createElement('div'));
      }
    };
  }, [editor]);

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (typeof innerRef === 'function') innerRef(node);
        else if (innerRef) innerRef.current = node;
      }}
      data-dm-editor-ui=""
      {...htmlProps}
    />
  );
}
