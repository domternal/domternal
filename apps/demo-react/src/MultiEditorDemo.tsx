import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, DomternalToolbar, DomternalBubbleMenu } from '@domternal/react';
import {
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
  type AnyExtension, type Editor,
} from '@domternal/core';

/**
 * "Multiple editors" demo (React). Several independent editors, every one built
 * from the SAME shared `extensions` array (the page-builder pattern). This is
 * the regression surface for the shared-extension-instance bug: before the
 * per-editor clone fix, creating a later editor clobbered earlier ones, so list
 * Enter on the earlier editors dropped an indented child paragraph instead of a
 * new <li>. Editor 0 gets a toolbar, the rest a bubble menu. Add / remove at
 * runtime must never break the others.
 *
 * E2E hooks: `window.__MULTI_EDITORS__` (core editors in panel order) and
 * `window.__DEMO_EDITOR__` (the first). Mirrors apps/demo-vanilla.
 */

/** ONE shared extensions array, intentionally reused for every editor. */
const sharedExtensions: AnyExtension[] = [
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
];

function sampleContent(n: number): string {
  return (
    `<h2>Editor ${String(n)}</h2>` +
    `<p>Independent editor built from the shared config. Put the caret at the end of a list item and press Enter.</p>` +
    `<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>` +
    `<ol><li><p>Ordered one</p></li></ol>` +
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task one</p></li></ul>`
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
  gap: 16,
  alignItems: 'start',
};
const panelStyle: React.CSSProperties = {
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: 8,
  padding: 12,
};
const headStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  margin: '0 0 8px',
};

interface PanelSpec { id: number; withToolbar: boolean }

function MultiEditorPanel({
  spec, index, onEditorReady, onRemove,
}: {
  spec: PanelSpec;
  index: number;
  onEditorReady: (id: number, editor: Editor | null) => void;
  onRemove: (id: number) => void;
}) {
  const { editor, editorRef } = useEditor({
    extensions: sharedExtensions,
    content: sampleContent(spec.id),
  });

  // Report the editor up; the parent owns the window globals. On unmount the
  // null report drops it from the parent map (ignored if the parent is also
  // unmounting, so it never resurrects the global the parent just cleared).
  useEffect(() => {
    onEditorReady(spec.id, editor ?? null);
    return () => onEditorReady(spec.id, null);
  }, [editor, spec.id, onEditorReady]);

  return (
    <div className="multi-editor-panel" data-editor-index={index} style={panelStyle}>
      <div style={headStyle}>
        <strong>Editor {spec.id} ({spec.withToolbar ? 'toolbar' : 'bubble menu'})</strong>
        <button data-testid="multi-remove-editor" onClick={() => onRemove(spec.id)}>Remove</button>
      </div>

      {spec.withToolbar && editor && <DomternalToolbar editor={editor} />}

      <div className="dm-editor">
        <div ref={editorRef} />
      </div>

      {!spec.withToolbar && editor && (
        <DomternalBubbleMenu
          editor={editor}
          contexts={{ text: ['bold', 'italic', 'underline', 'strike', 'code'] }}
        />
      )}
    </div>
  );
}

export function MultiEditorDemo() {
  // Initial layout: one toolbar editor (the "Hero") plus two bubble-menu
  // editors (the "columns") - the exact shape that exposed the bug.
  const [panels, setPanels] = useState<PanelSpec[]>([
    { id: 1, withToolbar: true },
    { id: 2, withToolbar: false },
    { id: 3, withToolbar: false },
  ]);
  // Monotonic id counter. Only mutated inside click handlers (not render /
  // effects), so it stays StrictMode-safe.
  const nextIdRef = useRef(4);
  const [editorMap, setEditorMap] = useState<Map<number, Editor>>(() => new Map());

  const onEditorReady = useCallback((id: number, editor: Editor | null) => {
    setEditorMap((prev) => {
      const next = new Map(prev);
      if (editor) next.set(id, editor);
      else next.delete(id);
      return next;
    });
  }, []);

  // SINGLE owner of the window globals: write in the body, delete in cleanup.
  // On mode switch this effect's cleanup runs and nothing else writes the
  // global afterwards (children only setState, ignored once unmounting), so it
  // ends up `undefined`, not a stale `[]`.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const ordered = panels
      .map((p) => editorMap.get(p.id))
      .filter((e): e is Editor => Boolean(e));
    w.__MULTI_EDITORS__ = ordered;
    w.__DEMO_EDITOR__ = ordered[0] ?? null;
    return () => {
      delete w.__MULTI_EDITORS__;
      delete w.__DEMO_EDITOR__;
    };
  }, [panels, editorMap]);

  const addEditor = (withToolbar: boolean): void => {
    const id = nextIdRef.current++;
    setPanels((p) => [...p, { id, withToolbar }]);
  };
  const removeEditor = (id: number): void => {
    setPanels((p) => p.filter((s) => s.id !== id));
  };

  return (
    <div className="app-multi-editor-demo">
      <p style={{ color: 'var(--dm-text-muted,#9a9aa2)', margin: '0 0 12px' }}>
        Several independent editors, all built from one shared extension config. Lists keep working in every
        editor, including ones mounted before later editors. Add or remove editors at runtime to confirm nothing
        else breaks.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '0 0 16px' }}>
        <button data-testid="multi-add-bubble" onClick={() => addEditor(false)}>+ Add editor (bubble menu)</button>
        <button data-testid="multi-add-toolbar" onClick={() => addEditor(true)}>+ Add editor (toolbar)</button>
      </div>

      <div className="multi-editor-grid" style={gridStyle}>
        {panels.map((spec, i) => (
          <MultiEditorPanel
            key={spec.id}
            spec={spec}
            index={i}
            onEditorReady={onEditorReady}
            onRemove={removeEditor}
          />
        ))}
      </div>
    </div>
  );
}
