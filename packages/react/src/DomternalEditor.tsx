import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Content, JSONContent, Editor } from '@domternal/core';
import { useEditor, type UseEditorOptions } from './useEditor.js';
import { useEditorState } from './useEditorState.js';
import { EditorProvider } from './EditorContext.js';

export interface DomternalEditorProps extends Omit<UseEditorOptions, 'outputFormat'> {
  /** Additional CSS class for the .dm-editor wrapper. */
  className?: string;
  /** Output format for onChange. @default 'html' */
  outputFormat?: 'html' | 'json';
  /** Controlled value. When provided, editor content syncs to this value. */
  value?: Content;
  /** Called when content changes (controlled mode). */
  onChange?: (value: string | JSONContent) => void;
  /** Additional content rendered inside the dm-editor wrapper. */
  children?: React.ReactNode;
}

export interface DomternalEditorRef {
  editor: Editor | null;
  htmlContent: string;
  jsonContent: JSONContent | null;
  isEmpty: boolean;
  isFocused: boolean;
  isEditable: boolean;
}

/**
 * All-in-one editor component with integrated state management and context.
 *
 * Wraps children with EditorProvider automatically, so toolbar, bubble menu,
 * and emoji picker components can access the editor via context.
 *
 * @example
 * ```tsx
 * const editorRef = useRef<DomternalEditorRef>(null);
 *
 * <DomternalEditor
 *   ref={editorRef}
 *   extensions={[Bold, Italic, Heading]}
 *   content="<p>Hello</p>"
 *   onUpdate={({ editor }) => console.log(editor.getHTML())}
 * />
 * ```
 *
 * @example Controlled mode
 * ```tsx
 * const [html, setHtml] = useState('<p>Hello</p>');
 * <DomternalEditor value={html} onChange={setHtml} outputFormat="html" />
 * ```
 */
export const DomternalEditor = forwardRef<DomternalEditorRef, DomternalEditorProps>(
  function DomternalEditor(props, ref) {
    const {
      className,
      outputFormat = 'html',
      value,
      onChange,
      content,
      children,
      ...editorOptions
    } = props;

    const { editor, editorRef } = useEditor({
      ...editorOptions,
      content: content ?? value ?? '',
      outputFormat,
    });

    const state = useEditorState(editor);

    // Expose editor + state via ref
    useImperativeHandle(ref, () => ({
      editor,
      htmlContent: state.htmlContent,
      jsonContent: state.jsonContent,
      isEmpty: state.isEmpty,
      isFocused: state.isFocused,
      isEditable: state.isEditable,
    }), [editor, state]);

    // Controlled mode: sync value prop to editor
    const prevValueRef = useRef(value);
    useEffect(() => {
      if (value === undefined || !editor || editor.isDestroyed) return;
      if (value === prevValueRef.current) return;
      prevValueRef.current = value;

      if (outputFormat === 'html') {
        if (value !== editor.getHTML()) {
          editor.setContent(value, false);
        }
      } else {
        if (JSON.stringify(value) !== JSON.stringify(editor.getJSON())) {
          editor.setContent(value, false);
        }
      }
    }, [value, editor, outputFormat]);

    // Controlled mode: call onChange on content changes
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
      if (!editor || editor.isDestroyed || !onChangeRef.current) return;

      const handler = () => {
        const cb = onChangeRef.current;
        if (!cb) return;
        const val = outputFormat === 'html' ? editor.getHTML() : editor.getJSON();
        cb(val);
      };

      editor.on('update', handler);
      return () => { editor.off('update', handler); };
    }, [editor, outputFormat]);

    const classes = className ? `dm-editor ${className}` : 'dm-editor';

    return (
      <EditorProvider editor={editor}>
        {children}
        <div className={classes}>
          <div ref={editorRef} />
        </div>
      </EditorProvider>
    );
  },
);
