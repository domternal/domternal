import { afterEach, describe, expect, it } from 'vitest';
import {
  Bold,
  BulletList,
  Document,
  Editor,
  Extension,
  FontFamily,
  FontSize,
  Highlight,
  History,
  LineHeight,
  ListItem,
  OrderedList,
  Paragraph,
  TaskItem,
  TaskList,
  Text,
  TextColor,
  TextStyle,
  UniqueID,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import type { Slice } from '@domternal/pm/model';
import { NodeSelection, Plugin, TextSelection } from '@domternal/pm/state';
import { PasteCleanup } from './index.js';
import type { PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function mount(
  content: string,
  options: PasteCleanupOptions = {},
  extensions: NonNullable<EditorOptions['extensions']> = []
): Editor {
  let sequence = 0;
  const editor = new Editor({
    extensions: [
      Document,
      Text,
      Paragraph,
      Bold,
      BulletList,
      OrderedList,
      ListItem,
      TaskList,
      TaskItem,
      TextStyle,
      FontFamily,
      FontSize,
      TextColor,
      Highlight,
      LineHeight.configure({ lineHeights: [] }),
      History,
      UniqueID.configure({ generateID: () => `generated-${String(++sequence)}` }),
      PasteCleanup.configure(options),
      ...extensions,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function positionOfID(editor: Editor, id: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.attrs['id'] === id) found = position;
  });
  if (found === undefined) throw new Error(`Missing node ${id}`);
  return found;
}

function copy(editor: Editor): { html: string; text: string; slice: Slice } {
  const result = editor.view.serializeForClipboard(editor.state.selection.content());
  expect(result.dom.querySelector('[data-pm-slice]')).not.toBeNull();
  return { html: result.dom.innerHTML, text: result.text, slice: result.slice };
}

function paste(editor: Editor, copied: { html: string; text: string }): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [],
      files: [],
      getData: (type: string) =>
        type === 'text/html' ? copied.html : type === 'text/plain' ? copied.text : '',
    },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(() => {
    editor.state.doc.check();
  }).not.toThrow();
}

const nestedLists =
  '<ol id="outer-list" start="7"><li id="outer-item"><p id="parent-label">Parent</p><ul id="tasks" data-type="taskList"><li id="checked-task" data-type="taskItem" data-checked="true"><p id="checked-label">Checked nested</p><ol id="inner-list" start="3"><li id="inner-item"><p id="inner-label">Deep ordered</p></li></ol></li><li id="unchecked-task" data-type="taskItem" data-checked="false"><p id="unchecked-label">Unchecked</p></li></ul></li></ol>';

describe('PasteCleanup internal clipboard contract', () => {
  it('keeps source block IDs when a serialized copy replaces its own document', () => {
    const editor = mount('<p id="first">First</p><p id="second"><strong>Second</strong></p>');
    editor.commands.selectAll();
    const before = editor.state.doc;
    const copied = copy(editor);

    paste(editor, copied);

    expect(editor.state.doc.eq(before)).toBe(true);
    expect(editor.state.doc.child(0).attrs['id']).toBe('first');
    expect(editor.state.doc.child(1).attrs['id']).toBe('second');
  });

  it.each(['before', 'after'] as const)(
    'keeps the incumbent ID and assigns a fresh ID to a copy pasted %s it',
    (destination) => {
      const content =
        destination === 'before'
          ? '<p id="target"></p><p id="original">Original</p>'
          : '<p id="original">Original</p><p id="target"></p>';
      const editor = mount(content);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, positionOfID(editor, 'original'))
        )
      );
      const copied = copy(editor);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, positionOfID(editor, 'target') + 1)
        )
      );

      paste(editor, copied);

      const paragraphs = [editor.state.doc.child(0), editor.state.doc.child(1)];
      expect(paragraphs.map((node) => node.textContent)).toEqual(['Original', 'Original']);
      const originalIndex = destination === 'before' ? 1 : 0;
      const copyIndex = destination === 'before' ? 0 : 1;
      expect(paragraphs[originalIndex]?.attrs['id']).toBe('original');
      expect(paragraphs[copyIndex]?.attrs['id']).toMatch(/^generated-/);
      expect(new Set(paragraphs.map((node) => node.attrs['id'])).size).toBe(2);
    }
  );

  it('round-trips nested ordered and task lists with checked state and source IDs', () => {
    const source = mount(nestedLists);
    source.commands.selectAll();
    const copied = copy(source);
    const target = mount('<p id="target"></p>');
    target.commands.selectAll();

    paste(target, copied);

    expect(target.getJSON()).toEqual(source.getJSON());
    expect(target.state.doc.firstChild?.attrs['start']).toBe(7);
    const tasks: { checked: unknown; text: string }[] = [];
    target.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem')
        tasks.push({ checked: node.attrs['checked'], text: node.textContent });
    });
    expect(tasks).toEqual([
      { checked: true, text: 'Checked nestedDeep ordered' },
      { checked: false, text: 'Unchecked' },
    ]);
  });

  it('restores serializer context for a selection inside nested checked tasks', () => {
    const source = mount(nestedLists);
    const start = positionOfID(source, 'checked-label') + 1;
    source.view.dispatch(
      source.state.tr.setSelection(
        TextSelection.create(source.state.doc, start, start + 'Checked nested'.length)
      )
    );
    const copied = copy(source);
    expect(copied.html).toContain('orderedList');
    expect(copied.html).toContain('taskItem');
    const parsed: Slice[] = [];
    const probe = Extension.create({
      name: 'inspectInternalSlice',
      priority: 1100,
      addProseMirrorPlugins: () => [
        new Plugin({
          props: {
            transformPasted(slice) {
              parsed.push(slice);
              return slice;
            },
          },
        }),
      ],
    });
    const target = mount('<p id="target"></p>', {}, [probe]);
    target.commands.selectAll();

    paste(target, copied);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.toJSON()).toEqual(copied.slice.toJSON());
    const checked: unknown[] = [];
    parsed[0]?.content.descendants((node) => {
      if (node.type.name === 'taskItem') checked.push(node.attrs['checked']);
    });
    expect(checked).toEqual([true]);
    expect(target.state.doc.textContent).toBe('Checked nested');
  });

  it('preserves editor color tokens, fonts, and line height for internal copies in adapt mode', () => {
    const source = mount(
      '<p id="styled" style="line-height:1.7"><span data-text-color="red" data-bg-color="blue" style="font-family:Arial;font-size:18px"><strong>Styled copy</strong></span></p>'
    );
    source.commands.selectAll();
    const copied = copy(source);
    const target = mount('<p id="target"></p>', { formatting: 'adapt' });
    target.commands.selectAll();

    paste(target, copied);

    expect(target.getJSON()).toEqual(source.getJSON());
    expect(target.state.doc.firstChild?.attrs['lineHeight']).toBe('1.7');
    const mark = target.state.doc.firstChild?.firstChild?.marks.find(
      (value) => value.type.name === 'textStyle'
    );
    expect(mark?.attrs).toMatchObject({
      colorToken: 'red',
      backgroundColorToken: 'blue',
      fontFamily: 'Arial',
      fontSize: '18px',
    });
  });

  it('sanitizes a forged serializer marker and drops unknown context without losing safe text', () => {
    const target = mount('<p id="target"></p>', { formatting: 'adapt' });
    target.commands.selectAll();

    paste(target, {
      html: '<p data-pm-slice=\'1 1 ["unregisteredNode",{"id":"forged","onclick":"alert(1)","src":"https://unsafe.test/image","style":"background:url(https://unsafe.test/image)","__proto__":{"polluted":true}}]\' onclick="alert(2)"><span data-text-color="red;url(https://unsafe.test/image)" style="font-size:18px;background-image:url(https://unsafe.test/image)">Safe text</span><img src="https://unsafe.test/pixel"></p>',
      text: 'Unsafe fallback text',
    });

    expect(target.state.doc.textContent).toBe('Safe text');
    expect(target.getHTML()).not.toMatch(
      /(?:unsafe\.test|onclick|data-pm-slice|font-size|background-image|polluted|forged)/
    );
    expect(target.view.dom.querySelector('img, [onclick], [src], [data-text-color]')).toBeNull();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
});
