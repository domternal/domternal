import { Domternal, useCurrentEditor } from '@domternal/react';
import {
  Bold,
  Italic,
  Underline,
  Strike,
  Heading,
  BulletList,
  OrderedList,
  Link,
  LinkPopover,
  SelectionDecoration,
} from '@domternal/core';

const extensions = [
  Bold,
  Italic,
  Underline,
  Strike,
  Heading,
  BulletList,
  OrderedList,
  Link,
  LinkPopover,
  SelectionDecoration,
];

/** Custom component that pulls the editor from context via useCurrentEditor(). */
function EditorProbe() {
  const { editor } = useCurrentEditor();
  return (
    <div data-testid="editor-probe" data-dm-editor-ui="">
      <span data-testid="has-editor">{editor ? 'yes' : 'no'}</span>
      <button
        type="button"
        data-testid="inject-bold"
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor?.commands.toggleBold()}
      >
        Toggle Bold via inject
      </button>
    </div>
  );
}

/**
 * React demo for the <Domternal> compound component with namespaced
 * subcomponents (Domternal.Content / .Toolbar / .BubbleMenu) and the
 * useCurrentEditor() context hook. Mirrors the Vue CompoundDemo so both
 * wrappers cover the same provide/inject editor-sharing behaviour.
 */
export function CompoundDemo() {
  return (
    <div className="compound-demo" data-demo="compound">
      <h2>Compound Component Demo (&lt;Domternal&gt; with namespaced subcomponents)</h2>

      <Domternal extensions={extensions} content="<p>Compound root provides editor via context</p>">
        <Domternal.Toolbar />
        <Domternal.Content />
        <Domternal.BubbleMenu contexts={{ text: ['bold', 'italic', 'underline'] }} />

        <h3>Editor probe (uses useCurrentEditor context)</h3>
        <EditorProbe />
      </Domternal>
    </div>
  );
}
