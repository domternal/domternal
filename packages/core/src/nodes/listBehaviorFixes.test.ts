/**
 * Regression tests for list/task behavior bugs found in the June 2026 list
 * audit. Each describe block maps to one fixed defect; together they guard the
 * cross-cutting fixes that span ListItem / TaskItem / ListKeymap / OrderedList /
 * createDocument so a future refactor cannot silently reintroduce them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { TaskItem } from './TaskItem.js';
import { TaskList } from './TaskList.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { ListItem } from './ListItem.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';
import { ListKeymap } from '../extensions/ListKeymap.js';

let editor: Editor | undefined;
afterEach(() => { if (editor && !editor.isDestroyed) editor.destroy(); });
const base = [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function caretAt(text: string, where: 'end' | 'start'): void {
  const ed = editor!;
  let pos = -1;
  ed.state.doc.descendants((node, p) => {
    if (node.type.name === 'paragraph' && node.textContent === text) {
      pos = where === 'end' ? p + 1 + node.content.size : p + 1;
    }
  });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}
function fire(itemExt: any, key: string): boolean | undefined {
  const ed = editor!;
  const nodeType = ed.state.schema.nodes[itemExt.name];
  const sc = itemExt.config.addKeyboardShortcuts?.call({ ...itemExt, editor: ed, nodeType, options: itemExt.options });
  return sc?.[key]?.();
}
function fireListKeymap(key: string): boolean | undefined {
  const ed = editor!;
  const sc: any = ListKeymap.config.addKeyboardShortcuts?.call({ ...ListKeymap, editor: ed, options: { listItem: 'listItem' } } as any);
  return sc?.[key]?.();
}
function countEmptyParas(): number {
  const ed = editor!;
  let n = 0;
  ed.state.doc.descendants((node) => { if (node.type.name === 'paragraph' && node.content.size === 0) n++; });
  return n;
}
function docValid(): boolean {
  try { editor!.state.doc.check(); return true; } catch { return false; }
}

describe('OrderedList start is validated (no NaN/null corruption)', () => {
  it('malformed start falls back to 1 and never serializes as null/NaN', () => {
    editor = new Editor({ extensions: base, content: '<ol start="abc"><li><p>x</p></li></ol>' });
    expect(editor.state.doc.firstChild!.attrs['start']).toBe(1);
    expect(editor.getHTML()).not.toContain('NaN');
    expect(JSON.stringify(editor.getJSON())).not.toContain('"start":null');
  });
  it('valid start is preserved; values < 1 clamp to 1', () => {
    editor = new Editor({ extensions: base, content: '<ol start="5"><li><p>x</p></li></ol>' });
    expect(editor.state.doc.firstChild!.attrs['start']).toBe(5);
    expect(editor.getHTML()).toContain('start="5"');
    editor.destroy();
    editor = new Editor({ extensions: base, content: '<ol start="-4"><li><p>x</p></li></ol>' });
    expect(editor.state.doc.firstChild!.attrs['start']).toBe(1);
  });
});

describe('GFM / markdown task lists import with checkbox + checked state', () => {
  it('contains-task-list maps to taskList; per-item checked derived from input', () => {
    editor = new Editor({
      extensions: base,
      content: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked> Done</li><li class="task-list-item"><input type="checkbox"> Todo</li></ul>',
    });
    const list = editor.state.doc.firstChild!;
    expect(list.type.name).toBe('taskList');
    expect(list.child(0).attrs['checked']).toBe(true);
    expect(list.child(1).attrs['checked']).toBe(false);
    expect(editor.getText()).toContain('Done');
  });
  it('data-checked parsing is case-insensitive', () => {
    editor = new Editor({
      extensions: base,
      content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="TRUE"><div><p>x</p></div></li></ul>',
    });
    expect(editor.state.doc.firstChild!.child(0).attrs['checked']).toBe(true);
  });
  it('an ordinary bullet list is NOT swallowed by the task-list fallback', () => {
    editor = new Editor({ extensions: base, content: '<ul><li><p>plain</p></li></ul>' });
    expect(editor.state.doc.firstChild!.type.name).toBe('bulletList');
  });
});

describe('Enter on a label with nested children keeps children under the original item', () => {
  it('bullet: caret at end of label -> fresh empty sibling, child stays nested', () => {
    editor = new Editor({ extensions: base, content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>' });
    caretAt('Parent', 'end');
    expect(fire(ListItem, 'Enter')).toBe(true);
    const outer = editor.state.doc.firstChild!;
    expect(outer.childCount).toBe(2);
    expect(outer.child(0).textContent).toContain('Child');
    expect(outer.child(1).textContent).toBe('');
  });
  it('task: caret at end of label -> fresh empty sibling, child stays nested', () => {
    editor = new Editor({ extensions: base, content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Child</p></div></li></ul></div></li></ul>' });
    caretAt('Parent', 'end');
    expect(fire(TaskItem, 'Enter')).toBe(true);
    const outer = editor.state.doc.firstChild!;
    expect(outer.childCount).toBe(2);
    expect(outer.child(0).textContent).toContain('Child');
    expect(outer.child(1).textContent).toBe('');
  });
  it('empty label with children does not spawn a stray empty item', () => {
    editor = new Editor({ extensions: base, content: '<ul><li><p>Top</p><ul><li><p></p><ul><li><p>Grandchild</p></li></ul></li></ul></li></ul>' });
    const before = countEmptyParas();
    caretAt('', 'start');
    fire(ListItem, 'Enter');
    expect(countEmptyParas()).toBe(before);
    expect(editor.getText()).toContain('Grandchild');
  });
});

describe('Cross-type outdent preserves item type + checked state (no data loss)', () => {
  const taskInBullet = '<ul><li><p>Parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Child</p></div></li></ul></li></ul>';

  it('Shift-Tab: a checked task nested in a bullet item survives as a taskList', () => {
    editor = new Editor({ extensions: base, content: taskInBullet });
    caretAt('Child', 'start');
    expect(fire(TaskItem, 'Shift-Tab')).toBe(true);
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).type.name).toBe('taskList');
    expect(doc.child(1).child(0).attrs['checked']).toBe(true);
    expect(editor.getText()).toContain('Child');
  });
  it('Backspace at start: a checked task nested in a bullet item survives', () => {
    editor = new Editor({ extensions: base, content: taskInBullet });
    caretAt('Child', 'start');
    expect(fire(TaskItem, 'Backspace')).toBe(true);
    expect(editor.getHTML()).toContain('data-checked="true"');
    expect(editor.state.doc.child(1).type.name).toBe('taskList');
  });
  it('Shift-Tab: a bullet item nested in a task survives as a bulletList', () => {
    editor = new Editor({ extensions: base, content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Task parent</p><ul><li><p>Bullet child</p></li></ul></div></li></ul>' });
    caretAt('Bullet child', 'start');
    expect(fireListKeymap('Shift-Tab')).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe('bulletList');
    expect(editor.getText()).toContain('Bullet child');
  });
  it('split case: a task in a NON-last bullet item splits the list, preserves all', () => {
    editor = new Editor({ extensions: base, content: '<ul><li><p>First</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Child</p></div></li></ul></li><li><p>Second</p></li></ul>' });
    caretAt('Child', 'start');
    expect(fire(TaskItem, 'Shift-Tab')).toBe(true);
    const text = editor.getText();
    expect(text).toContain('First');
    expect(text).toContain('Second');
    expect(text).toContain('Child');
    expect(editor.getHTML()).toContain('data-checked="true"');
    let hasTopTaskList = false;
    editor.state.doc.forEach((n) => { if (n.type.name === 'taskList') hasTopTaskList = true; });
    expect(hasTopTaskList).toBe(true);
  });
  it('inner wrapper with multiple items: only the target moves, all preserved, doc valid', () => {
    editor = new Editor({ extensions: base, content: '<ul><li><p>Parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>A</p></div></li><li data-type="taskItem" data-checked="false"><div><p>B</p></div></li></ul></li></ul>' });
    caretAt('A', 'start');
    expect(fire(TaskItem, 'Shift-Tab')).toBe(true);
    expect(docValid()).toBe(true);
    expect(editor.getText()).toContain('A');
    expect(editor.getText()).toContain('B');
    expect(editor.getHTML()).toContain('data-checked="true"');
  });
  it('three levels deep and ordered/nested-grandparent variants stay schema-valid + checked', () => {
    const cases = [
      '<ul><li><p>L1</p><ul><li><p>L2</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Deep</p></div></li></ul></li></ul></li></ul>',
      '<ol start="3"><li><p>Num</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Deep</p></div></li></ul></li></ol>',
      '<ul><li><p>Outer</p><ul><li><p>Mid</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>Deep</p></div></li></ul></li></ul></li></ul>',
    ];
    for (const content of cases) {
      editor?.destroy();
      editor = new Editor({ extensions: base, content });
      caretAt('Deep', 'start');
      expect(fire(TaskItem, 'Shift-Tab')).toBe(true);
      expect(docValid()).toBe(true);
      expect(editor.getText()).toContain('Deep');
      expect(editor.getHTML()).toContain('data-checked="true"');
    }
  });
  it('regression: same-type (task in task) still outdents one level, keeps checked', () => {
    editor = new Editor({ extensions: base, content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>P</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>C</p></div></li></ul></div></li></ul>' });
    caretAt('C', 'start');
    expect(fire(TaskItem, 'Shift-Tab')).toBe(true);
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe('taskList');
    expect(doc.child(0).childCount).toBe(2);
    expect(editor.getHTML()).toContain('data-checked="true"');
  });
});

describe('setContent of a mixed <ul> drops the content-fitter placeholder item', () => {
  it('task-first mixed ul: no leading empty bullet item; both items preserved', () => {
    editor = new Editor({
      extensions: base,
      content: '<ul><li data-type="taskItem" data-checked="true"><div><p>tasktext</p></div></li><li><p>plain</p></li></ul>',
    });
    const first = editor.state.doc.firstChild!;
    const firstIsEmptyPlaceholder = first.childCount === 1
      && first.child(0).childCount === 1
      && first.child(0).child(0).content.size === 0;
    expect(firstIsEmptyPlaceholder).toBe(false);
    expect(editor.getText()).toContain('tasktext');
    expect(editor.getText()).toContain('plain');
  });
  it('control: a normal single-item task list is left untouched', () => {
    editor = new Editor({
      extensions: base,
      content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>only</p></div></li></ul>',
    });
    expect(editor.state.doc.firstChild!.type.name).toBe('taskList');
    expect(editor.getText()).toContain('only');
  });
});
