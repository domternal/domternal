import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Text } from './nodes/Text.js';
import { Paragraph } from './nodes/Paragraph.js';
import { BulletList } from './nodes/BulletList.js';
import { BaseKeymap } from './extensions/BaseKeymap.js';

/**
 * Regression: extension instances must not be shared across editors. Each
 * editor clones its extensions, so binding one editor never clobbers another.
 * Previously, the same imported BulletList/ListItem reused across two editors
 * left the first editor's ListItem pointing at the second editor's schema, so
 * Enter fell back to splitBlock and dropped an indented child paragraph
 * instead of creating a new <li>.
 */
function caretAtEndOf(editor: Editor, text: string): void {
  let pos = -1; let size = 0;
  editor.state.doc.descendants((n, p) => {
    if (pos !== -1) return false;
    if (n.type.name === 'paragraph' && n.textContent === text) { pos = p; size = n.nodeSize; return false; }
    return true;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + size - 1)));
}

function pressEnter(editor: Editor): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

describe('multiple editors sharing the same extension instances', () => {
  let editors: Editor[] = [];
  afterEach(() => {
    for (const e of editors) if (!e.isDestroyed) e.destroy();
    editors = [];
  });

  it('list Enter still makes a sibling <li> on the FIRST editor after a SECOND is created', () => {
    // Same shared singleton instances passed to both editors.
    const shared = [Document, Text, Paragraph, BaseKeymap, BulletList];

    const first = new Editor({ extensions: shared, content: '<ul><li><p>Bullet1</p></li></ul>' });
    editors.push(first);
    // Creating the second editor used to clobber the first editor's binding.
    const second = new Editor({ extensions: shared, content: '<ul><li><p>Other</p></li></ul>' });
    editors.push(second);

    caretAtEndOf(first, 'Bullet1');
    pressEnter(first);

    const ul = first.state.doc.firstChild;
    expect(ul?.type.name).toBe('bulletList');
    // Correct: two <li> siblings. Bug produced ONE <li> with two paragraphs.
    expect(ul?.childCount).toBe(2);
    expect(ul?.firstChild?.childCount).toBe(1);
  });

  it('each editor binds its own extension clones (originals stay unbound)', () => {
    const shared = [Document, Text, Paragraph, BulletList];
    const a = new Editor({ extensions: shared, content: '<p>a</p>' });
    editors.push(a);
    const b = new Editor({ extensions: shared, content: '<p>b</p>' });
    editors.push(b);

    // The imported singleton must never be bound to an editor.
    expect(BulletList.editor).toBeNull();
    // The two editors must have independent schemas.
    expect(a.schema).not.toBe(b.schema);
    expect(a.schema.nodes['listItem']).not.toBe(b.schema.nodes['listItem']);
  });
});
