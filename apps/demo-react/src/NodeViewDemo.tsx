import { useEffect } from 'react';
import { useEditor, DomternalToolbar } from '@domternal/react';
import {
  Bold,
  Italic,
  Underline,
  Heading,
  BulletList,
  OrderedList,
  SelectionDecoration,
} from '@domternal/core';
import { Callout, type CalloutVariant } from './Callout.js';

const extensions = [Bold, Italic, Underline, Heading, BulletList, OrderedList, SelectionDecoration, Callout];

const initialContent = `
<h2>React NodeView Demo</h2>
<p>Below is a custom <strong>Callout</strong> block rendered by a React component via <code>ReactNodeViewRenderer</code>.</p>
<div data-type="callout" data-variant="info">
  <p>This is an info callout - try <strong>typing</strong> inside it, switching variant, or deleting it.</p>
</div>
<p>Below this paragraph you can insert more callouts using the buttons.</p>
`;

export function NodeViewDemo() {
  const { editor, editorRef } = useEditor({ extensions, content: initialContent });

  // Expose editor on window for E2E test access
  useEffect(() => {
    if (editor) {
      (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = editor;
    }
    return () => {
      (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] = undefined;
    };
  }, [editor]);

  const insertCallout = (variant: CalloutVariant) => {
    editor?.chain().focus().insertCallout(variant).run();
  };

  return (
    <div className="nodeview-demo" data-demo="nodeview">
      <h2>React NodeView Demo</h2>

      <div className="nodeview-controls">
        <button type="button" data-testid="insert-info" onClick={() => insertCallout('info')}>+ Info</button>
        <button type="button" data-testid="insert-warning" onClick={() => insertCallout('warning')}>+ Warning</button>
        <button type="button" data-testid="insert-success" onClick={() => insertCallout('success')}>+ Success</button>
        <button type="button" data-testid="insert-danger" onClick={() => insertCallout('danger')}>+ Danger</button>
      </div>

      {editor && <DomternalToolbar editor={editor} />}

      <div className="dm-editor">
        <div ref={editorRef} />
      </div>
    </div>
  );
}
