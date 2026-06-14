import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Bold,
  Italic,
  Editor,
} from '@domternal/core';
import { turnIntoWrapper } from './turnIntoWrapper.js';

const extensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Bold,
  Italic,
];

function makeEditor(content: string): Editor {
  return new Editor({ extensions, content });
}

/** Resolves the absolute pos of the first top-level block matching `predicate`. */
function findTopLevelPos(
  editor: Editor,
  predicate: (typeName: string) => boolean,
): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found !== -1) return;
    if (predicate(node.type.name)) found = offset;
  });
  if (found === -1) throw new Error('top-level block not found');
  return found;
}

describe('turnIntoWrapper', () => {
  it('wraps a paragraph in <ul><li><p>', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.type.name).toBe('listItem');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('Hello');
    editor.destroy();
  });

  it('wraps a paragraph in <ol><li><p>', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoOrderedList');
    expect(ok).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('orderedList');
    expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe('listItem');
    editor.destroy();
  });

  it('wraps a paragraph in <taskList><taskItem checked=false>', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoTaskList');
    expect(ok).toBe(true);
    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe('taskList');
    const item = list?.firstChild;
    expect(item?.type.name).toBe('taskItem');
    expect((item?.attrs as { checked: boolean }).checked).toBe(false);
    editor.destroy();
  });

  it('wraps a paragraph in <blockquote>', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    const ok = turnIntoWrapper(editor, pos, 'toggleBlockquote');
    expect(ok).toBe(true);
    const bq = editor.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('paragraph');
    expect(bq?.firstChild?.textContent).toBe('Hello');
    editor.destroy();
  });

  it('downgrades a heading to paragraph then wraps in a bullet list', () => {
    // listItem.content = 'paragraph block*' requires a paragraph as first
    // child. The helper step-downs heading → paragraph (drops `level`)
    // before the wrap so the schema accepts the result.
    const editor = makeEditor('<h2>Title</h2>');
    const pos = findTopLevelPos(editor, (t) => t === 'heading');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('Title');
    editor.destroy();
  });

  it('downgrades a code block to paragraph then wraps in a bullet list', () => {
    // codeBlock has `code: true`, content = `text*`. Step-down to paragraph
    // drops code semantics but preserves the text content.
    const editor = makeEditor('<pre><code>console.log("x")</code></pre>');
    const pos = findTopLevelPos(editor, (t) => t === 'codeBlock');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('bulletList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('console.log("x")');
    editor.destroy();
  });

  it('wraps a code block in <blockquote> without step-down', () => {
    // blockquote.content = 'block+' accepts codeBlock directly. The
    // wrapped codeBlock keeps `code: true` and its text content.
    const editor = makeEditor('<pre><code>const x = 1;</code></pre>');
    const pos = findTopLevelPos(editor, (t) => t === 'codeBlock');
    const ok = turnIntoWrapper(editor, pos, 'toggleBlockquote');
    expect(ok).toBe(true);
    const bq = editor.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('codeBlock');
    expect(bq?.firstChild?.textContent).toBe('const x = 1;');
    editor.destroy();
  });

  it('wraps a heading in <blockquote> without step-down', () => {
    // blockquote accepts heading; level attr survives.
    const editor = makeEditor('<h2>Quoted heading</h2>');
    const pos = findTopLevelPos(editor, (t) => t === 'heading');
    const ok = turnIntoWrapper(editor, pos, 'toggleBlockquote');
    expect(ok).toBe(true);
    const bq = editor.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    expect(bq?.firstChild?.type.name).toBe('heading');
    expect((bq?.firstChild?.attrs as { level: number }).level).toBe(2);
    editor.destroy();
  });

  it('returns false on a negative blockPos and does not dispatch', () => {
    const editor = makeEditor('<p>A</p>');
    const before = editor.state.doc.toJSON();
    const ok = turnIntoWrapper(editor, -1, 'turnIntoBulletList');
    expect(ok).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });

  it('returns false when blockPos is out of bounds', () => {
    const editor = makeEditor('<p>A</p>');
    const before = editor.state.doc.toJSON();
    const ok = turnIntoWrapper(editor, 9999, 'turnIntoBulletList');
    expect(ok).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });

  it('returns false when the targeted node is not a textblock', () => {
    // Pointing the helper at a list wrapper (non-textblock) should bail.
    const editor = makeEditor('<ul><li><p>A</p></li></ul>');
    const listPos = findTopLevelPos(editor, (t) => t === 'bulletList');
    const before = editor.state.doc.toJSON();
    const ok = turnIntoWrapper(editor, listPos, 'toggleBlockquote');
    expect(ok).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });

  // Cross-command coverage for the step-down path. Heading→bullet and
  // codeBlock→bullet validate the mechanism; these confirm the same path
  // produces the correct target list type for the other two commands.

  it('downgrades a heading to paragraph then wraps in an ordered list', () => {
    const editor = makeEditor('<h2>Title</h2>');
    const pos = findTopLevelPos(editor, (t) => t === 'heading');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoOrderedList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('orderedList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('Title');
    editor.destroy();
  });

  it('downgrades a heading to paragraph then wraps in a task list with checked=false', () => {
    const editor = makeEditor('<h2>Title</h2>');
    const pos = findTopLevelPos(editor, (t) => t === 'heading');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoTaskList');
    expect(ok).toBe(true);
    const list = editor.state.doc.firstChild;
    expect(list?.type.name).toBe('taskList');
    const item = list?.firstChild;
    expect(item?.type.name).toBe('taskItem');
    expect((item?.attrs as { checked: boolean }).checked).toBe(false);
    expect(item?.firstChild?.textContent).toBe('Title');
    editor.destroy();
  });

  it('downgrades a code block to paragraph then wraps in an ordered list', () => {
    const editor = makeEditor('<pre><code>x=1</code></pre>');
    const pos = findTopLevelPos(editor, (t) => t === 'codeBlock');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoOrderedList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('orderedList');
    expect(first?.firstChild?.firstChild?.type.name).toBe('paragraph');
    expect(first?.firstChild?.firstChild?.textContent).toBe('x=1');
    editor.destroy();
  });

  it('downgrades a code block to paragraph then wraps in a task list', () => {
    const editor = makeEditor('<pre><code>x=1</code></pre>');
    const pos = findTopLevelPos(editor, (t) => t === 'codeBlock');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoTaskList');
    expect(ok).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe('taskList');
    expect((first?.firstChild?.attrs as { checked: boolean }).checked).toBe(false);
    expect(first?.firstChild?.firstChild?.textContent).toBe('x=1');
    editor.destroy();
  });

  // Selection placement: after wrapping, the cursor should land inside
  // the new structure so the user can keep typing. The helper sets
  // selection to blockPos + 1 (inside the source textblock) before
  // dispatching the wrap; wrapRangeInList preserves the relative
  // position through schema-wrap mapping.

  it('places the selection inside the new list item paragraph after wrap', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    const sel = editor.state.selection;
    expect(sel.empty).toBe(true);
    const $cursor = editor.state.doc.resolve(sel.from);
    // Walk ancestors. Cursor should sit inside paragraph nested in
    // listItem nested in bulletList.
    const ancestorNames: string[] = [];
    for (let d = $cursor.depth; d >= 0; d--) ancestorNames.push($cursor.node(d).type.name);
    expect(ancestorNames).toContain('paragraph');
    expect(ancestorNames).toContain('listItem');
    expect(ancestorNames).toContain('bulletList');
    editor.destroy();
  });

  it('places the selection inside the new blockquote paragraph after wrap', () => {
    const editor = makeEditor('<p>Hello</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    turnIntoWrapper(editor, pos, 'toggleBlockquote');
    const $cursor = editor.state.doc.resolve(editor.state.selection.from);
    const ancestorNames: string[] = [];
    for (let d = $cursor.depth; d >= 0; d--) ancestorNames.push($cursor.node(d).type.name);
    expect(ancestorNames).toContain('paragraph');
    expect(ancestorNames).toContain('blockquote');
    editor.destroy();
  });

  // Inline marks live on text nodes, not on the textblock; wrapping the
  // textblock preserves its inline children verbatim. This guards
  // against regressions where step-down accidentally rebuilds content
  // through plain-text serialization.

  it('preserves inline marks (bold) through paragraph → bullet list', () => {
    const editor = makeEditor('<p>Hello <strong>world</strong></p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    const innerParagraph = editor.state.doc.firstChild?.firstChild?.firstChild;
    expect(innerParagraph?.type.name).toBe('paragraph');
    // Find the "world" text node and verify it still carries the bold mark.
    let foundBoldOnWorld = false;
    innerParagraph?.content.forEach((textNode) => {
      if (textNode.text === 'world') {
        foundBoldOnWorld = textNode.marks.some((m) => m.type.name === 'bold');
      }
    });
    expect(foundBoldOnWorld).toBe(true);
    editor.destroy();
  });

  it('preserves inline marks (italic) through heading → bullet list step-down', () => {
    const editor = makeEditor('<h2>Hello <em>world</em></h2>');
    const pos = findTopLevelPos(editor, (t) => t === 'heading');
    const ok = turnIntoWrapper(editor, pos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    const innerParagraph = editor.state.doc.firstChild?.firstChild?.firstChild;
    expect(innerParagraph?.type.name).toBe('paragraph');
    let foundItalicOnWorld = false;
    innerParagraph?.content.forEach((textNode) => {
      if (textNode.text === 'world') {
        foundItalicOnWorld = textNode.marks.some((m) => m.type.name === 'italic');
      }
    });
    expect(foundItalicOnWorld).toBe(true);
    editor.destroy();
  });

  // Empty source. Common case: user creates a paragraph with Enter, then
  // opens the menu before typing. The wrap must still produce a valid
  // list/quote with an empty paragraph inside.

  it('wraps an empty paragraph in a bullet list', () => {
    const editor = makeEditor('<p>A</p><p></p><p>B</p>');
    const pos = findTopLevelPos(editor, (t) => t === 'paragraph');
    // Find the SECOND paragraph (the empty one). The first match returns
    // pos of paragraph "A"; we need to keep walking.
    let emptyPos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (emptyPos !== -1) return;
      if (node.type.name === 'paragraph' && node.content.size === 0) emptyPos = offset;
    });
    expect(emptyPos).toBeGreaterThan(pos);
    const ok = turnIntoWrapper(editor, emptyPos, 'turnIntoBulletList');
    expect(ok).toBe(true);
    // Doc should now be: paragraph(A), bulletList(li(p(""))), paragraph(B)
    const second = editor.state.doc.child(1);
    expect(second.type.name).toBe('bulletList');
    expect(second.firstChild?.firstChild?.content.size).toBe(0);
    editor.destroy();
  });

  // Convert-in-place. When the targeted paragraph is already inside a
  // list of a DIFFERENT type, toggleList's Case 2 swaps the list type
  // without rebuilding items (or rebuilds items only when the listItem
  // type differs). The helper should route through the same path.

  it('converts ONLY the targeted item to an ordered list, splitting the bullet run (Notion per-item)', () => {
    const editor = makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    // Target the paragraph inside the first listItem.
    let paragraphPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (paragraphPos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === 'A') {
        paragraphPos = pos;
        return false;
      }
      return true;
    });
    expect(paragraphPos).toBeGreaterThan(0);
    const ok = turnIntoWrapper(editor, paragraphPos, 'turnIntoOrderedList');
    expect(ok).toBe(true);
    // Only "A" becomes ordered; "B" stays a bullet (the run splits around it).
    const types: string[] = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(['orderedList', 'bulletList']);
    expect(editor.state.doc.child(0).childCount).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe('A');
    expect(editor.state.doc.child(1).textContent).toBe('B');
    editor.destroy();
  });

  it('converts ONLY the targeted item to a to-do, splitting the bullet run (checked=false)', () => {
    const editor = makeEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    let paragraphPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (paragraphPos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === 'A') {
        paragraphPos = pos;
        return false;
      }
      return true;
    });
    const ok = turnIntoWrapper(editor, paragraphPos, 'turnIntoTaskList');
    expect(ok).toBe(true);
    const types: string[] = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(['taskList', 'bulletList']);
    const taskList = editor.state.doc.child(0);
    expect(taskList.childCount).toBe(1);
    expect(taskList.firstChild?.type.name).toBe('taskItem');
    expect((taskList.firstChild?.attrs as { checked: boolean }).checked).toBe(false);
    expect(taskList.textContent).toBe('A');
    expect(editor.state.doc.child(1).textContent).toBe('B');
    editor.destroy();
  });

  // Second-top-level-block target. The helper computes positions from
  // `state.doc`, not from `0`, so non-first targets must work the same.

  it('wraps the SECOND top-level paragraph, leaving the first intact', () => {
    const editor = makeEditor('<p>First</p><p>Second</p>');
    let secondPos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (secondPos !== -1) return;
      if (node.type.name === 'paragraph' && node.textContent === 'Second') secondPos = offset;
    });
    const ok = turnIntoWrapper(editor, secondPos, 'toggleBlockquote');
    expect(ok).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.textContent).toBe('First');
    const second = editor.state.doc.child(1);
    expect(second.type.name).toBe('blockquote');
    expect(second.firstChild?.textContent).toBe('Second');
    editor.destroy();
  });
});
