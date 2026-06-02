import { useEffect } from 'react';
import { useEditor } from '@domternal/react';
import { StarterKit, type AnyExtension } from '@domternal/core';

/**
 * "Tab + lists" demo (React). Two StarterKit editors embedded between form
 * fields, the page-builder / form scenario from issue #98.
 *
 *  - LEFT  (default StarterKit): `listIndent` is OFF. Tab on a paragraph that
 *    merely follows a list moves focus to the next field.
 *  - RIGHT (StarterKit.configure({ listIndent: true })): opt-in. Tab on the
 *    paragraph after the list pulls it INTO the list, focus stays.
 *
 * E2E hook: `window.__TAB_EDITORS__` = [defaultEditor, optInEditor]. Next-field
 * inputs carry data-testid `tab-next-0` / `tab-next-1`.
 */

const CONTENT =
  '<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>' +
  '<p>Para after list</p>' +
  '<p>Plain paragraph</p>';

// Built once (configure() returns a new extension; must not re-run per render).
const DEFAULT_EXT: AnyExtension[] = [StarterKit];
const OPT_IN_EXT: AnyExtension[] = [StarterKit.configure({ listIndent: true }) as AnyExtension];

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
const fieldStyle: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box' };

export function TabIndentDemo() {
  const a = useEditor({ extensions: DEFAULT_EXT, content: CONTENT });
  const b = useEditor({ extensions: OPT_IN_EXT, content: CONTENT });

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAB_EDITORS__ = [a.editor, b.editor].filter(Boolean);
    return () => { delete w.__TAB_EDITORS__; };
  }, [a.editor, b.editor]);

  return (
    <div className="app-tab-indent-demo">
      <p style={{ color: 'var(--dm-text-muted,#9a9aa2)', margin: '0 0 16px' }}>
        Two StarterKit editors embedded between form fields. Put the caret in "Para after list" and press Tab. Left
        (default): focus jumps to the next field. Right (listIndent: true): the paragraph is pulled into the list and
        focus stays.
      </p>

      <div style={gridStyle}>
        <div className="tab-indent-panel" data-editor-index={0} style={panelStyle}>
          <strong style={{ display: 'block', margin: '0 0 8px' }}>StarterKit (default - listIndent OFF)</strong>
          <input type="text" data-testid="tab-prev-0" placeholder="Field before editor 0" style={{ ...fieldStyle, margin: '0 0 8px' }} />
          <div className="dm-editor"><div ref={a.editorRef} /></div>
          <input type="text" data-testid="tab-next-0" placeholder="Field after editor 0" style={{ ...fieldStyle, margin: '8px 0 0' }} />
        </div>

        <div className="tab-indent-panel" data-editor-index={1} style={panelStyle}>
          <strong style={{ display: 'block', margin: '0 0 8px' }}>StarterKit({'{ listIndent: true }'})</strong>
          <input type="text" data-testid="tab-prev-1" placeholder="Field before editor 1" style={{ ...fieldStyle, margin: '0 0 8px' }} />
          <div className="dm-editor"><div ref={b.editorRef} /></div>
          <input type="text" data-testid="tab-next-1" placeholder="Field after editor 1" style={{ ...fieldStyle, margin: '8px 0 0' }} />
        </div>
      </div>
    </div>
  );
}
