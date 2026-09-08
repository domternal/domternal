/**
 * Readers see a normalized node attribute as it renders: a heading level the
 * configuration lacks reads as the level it renders at, and an unknown list
 * marker as the default. The stored value stays until an explicit write.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { ToolbarController } from './ToolbarController.js';
import type { ToolbarControllerEditor } from './ToolbarController.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { Heading } from './nodes/Heading.js';
import { ListItem } from './nodes/ListItem.js';
import { OrderedList } from './nodes/OrderedList.js';
import { Link } from './marks/Link.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; document.body.replaceChildren(); });

function mount(content: string, levels?: number[]): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, levels ? Heading.configure({ levels }) : Heading, ListItem, OrderedList, Link],
    content,
  });
  editors.push(editor);
  return editor;
}

/** Stores values without validation, as a bound collaborative document or another client does. */
function store(editor: Editor, pos: number, attribute: string, value: unknown): void {
  editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, attribute, value).setMeta('addToHistory', false));
}

function caret(editor: Editor, pos: number, to = pos): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos, to)));
}

const levels = (editor: Editor): unknown[] => (editor.getJSON().content ?? []).map(node => node.attrs?.['level'] ?? node.type);

describe('a stored heading level the configuration lacks', () => {
  it('reads as the level it renders at, while the document keeps the stored level', () => {
    const editor = mount('<h1>Five</h1>');
    store(editor, 0, 'level', 5);
    caret(editor, 2);
    expect(editor.getHTML()).toBe('<h4>Five</h4>');
    expect(levels(editor)).toEqual([5]);
    expect(editor.isActive('heading', { level: 4 })).toBe(true);
    expect(editor.isActive({ name: 'heading', attributes: { level: 4 } })).toBe(true);
    expect(editor.isActive('heading', { level: 5 })).toBe(false);
    expect(editor.isActive('heading', { level: '4' })).toBe(false);
    expect(editor.getAttributes('heading')).toMatchObject({ level: 4 });
    expect(editor.state.doc.firstChild?.attrs['level']).toBe(5);
  });

  it('toggles off at the level it renders at, and a level the configuration lacks never toggles', () => {
    const editor = mount('<h1>Five</h1>');
    store(editor, 0, 'level', 5);
    caret(editor, 2);
    expect(editor.commands.toggleHeading({ level: 5 })).toBe(false);
    expect(editor.commands.toggleHeading({ level: 4 })).toBe(true);
    expect(editor.getHTML()).toBe('<p>Five</p>');
  });

  it('toggles off through the Mod-Alt shortcut the toolbar shows', () => {
    const editor = mount('<h1>Five</h1>');
    store(editor, 0, 'level', 5);
    caret(editor, 2);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '4', code: 'Digit4', altKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(editor.getHTML()).toBe('<p>Five</p>');
  });

  it('stores the level an explicit write gives, with no visible change', () => {
    const editor = mount('<h1>Five</h1>');
    store(editor, 0, 'level', 5);
    caret(editor, 2);
    expect(editor.commands.setBlockType('heading', { level: 5 })).toBe(false);
    expect(editor.commands.setHeading({ level: 4 })).toBe(true);
    expect(levels(editor)).toEqual([4]);
    expect(editor.getHTML()).toBe('<h4>Five</h4>');
  });

  it('reads a level the configuration promotes to its shallowest level', () => {
    const editor = mount('<h2>One</h2>', [2, 3]);
    store(editor, 0, 'level', 1);
    caret(editor, 2);
    expect(editor.getHTML()).toBe('<h2>One</h2>');
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(editor.getAttributes('heading')['level']).toBe(2);
    expect(editor.commands.toggleHeading({ level: 2 })).toBe(true);
    expect(editor.getHTML()).toBe('<p>One</p>');
  });

  it.each([['5', 4], ['x', 1], [9, 4]])('reads a stored %j as %j, the level it renders at', (stored, rendered) => {
    const editor = mount('<h1>Stored</h1>');
    store(editor, 0, 'level', stored);
    caret(editor, 2);
    expect(editor.getHTML()).toBe(`<h${String(rendered)}>Stored</h${String(rendered)}>`);
    expect(editor.isActive('heading', { level: rendered })).toBe(true);
    expect(editor.getAttributes('heading')['level']).toBe(rendered);
    expect(editor.state.doc.firstChild?.attrs['level']).toBe(stored);
  });

  it('reads every level as stored when the configuration has all six', () => {
    const editor = mount('<h5>Five</h5>', [1, 2, 3, 4, 5, 6]);
    caret(editor, 2);
    expect(editor.isActive('heading', { level: 5 })).toBe(true);
    expect(editor.isActive('heading', { level: 4 })).toBe(false);
    expect(editor.getAttributes('heading')['level']).toBe(5);
  });

  it('toggles a selection off when every heading renders at the level, and on otherwise', () => {
    const editor = mount('<h1>Five</h1><h4>Four</h4>');
    store(editor, 0, 'level', 5);
    caret(editor, 2, editor.state.doc.content.size - 2);
    expect(editor.commands.toggleHeading({ level: 4 })).toBe(true);
    expect(editor.getHTML()).toBe('<p>Five</p><p>Four</p>');

    const mixed = mount('<h1>Five</h1><h3>Three</h3>');
    store(mixed, 0, 'level', 5);
    caret(mixed, 2, mixed.state.doc.content.size - 2);
    expect(mixed.commands.toggleHeading({ level: 4 })).toBe(true);
    expect(levels(mixed)).toEqual([4, 4]);
  });

  it('marks the toolbar item of the rendered level active', () => {
    const editor = mount('<h1>Five</h1>');
    store(editor, 0, 'level', 5);
    caret(editor, 2);
    const toolbar = new ToolbarController(editor as unknown as ToolbarControllerEditor, () => undefined);
    toolbar.subscribe();
    expect(toolbar.activeMap.get('heading4')).toBe(true);
    expect(['heading1', 'heading2', 'heading3', 'paragraph'].some(name => toolbar.activeMap.get(name) === true)).toBe(false);
    toolbar.destroy();
  });
});

describe('an unknown stored list marker', () => {
  it('reads as the default marker it renders as, in the selection path and as a selected node', () => {
    const editor = mount('<ol><li><p>Item</p></li></ol>');
    store(editor, 0, 'listStyleType', 'foo');
    caret(editor, 3);
    expect(editor.isActive('orderedList', { listStyleType: null })).toBe(true);
    expect(editor.isActive('orderedList', { listStyleType: 'foo' })).toBe(false);
    expect(editor.getAttributes('orderedList')['listStyleType']).toBeNull();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.isActive('orderedList', { listStyleType: null })).toBe(true);
    expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBe('foo');
  });
});

describe('mark attributes', () => {
  it('read as stored, so a link editor can still fix or remove a refused href', () => {
    const editor = mount('<p>Link</p>');
    const link = editor.schema.marks['link'];
    if (!link) throw new Error('Expected the link mark');
    editor.view.dispatch(editor.state.tr.addMark(1, 5, link.create({ href: 'javascript:alert(1)' })));
    caret(editor, 3);
    expect(editor.isActive('link')).toBe(true);
    expect(editor.isActive('link', { href: 'javascript:alert(1)' })).toBe(true);
    expect(editor.getAttributes('link')['href']).toBe('javascript:alert(1)');
  });
});
