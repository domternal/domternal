import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import { Document } from './Document.js';
import { Paragraph } from './Paragraph.js';
import { Text } from './Text.js';
import { Heading } from './Heading.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONAttribute, JSONContent } from '../types/index.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(levels?: number[], content = '<h1>A</h1><p>tail</p>'): Editor {
  editor = new Editor({ extensions: [Document, Paragraph, Text, levels ? Heading.configure({ levels }) : Heading], content });
  return editor;
}

/** Stores a value without validation, the way a bound collaborative document or an older client does. */
function store(ed: Editor, level: unknown): void {
  ed.view.dispatch(ed.state.tr.setNodeAttribute(0, 'level', level).setMeta('addToHistory', false));
}

function select(ed: Editor, pos: number): void {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

const heading = (level: JSONAttribute, text = 'A'): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

describe('rendering a stored heading level the configuration lacks', () => {
  it.each([[5], [6]])('renders level %i at the deepest configured level without rewriting the document', level => {
    const ed = mount();
    store(ed, level);
    expect(ed.view.dom.querySelector('h4')?.textContent).toBe('A');
    expect(ed.view.dom.querySelector('h1')).toBeNull();
    expect(ed.getHTML()).toBe('<h4>A</h4><p>tail</p>');
    expect(ed.getJSON().content?.[0]?.attrs?.['level']).toBe(level);
    ed.view.dispatch(ed.state.tr.insertText('!', ed.state.doc.content.size - 1));
    expect(ed.state.doc.lastChild?.textContent).toBe('tail!');
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(level);
  });

  it('renders a level between configured levels at the next deeper one', () => {
    const ed = mount([1, 5]);
    store(ed, 3);
    expect(ed.getHTML()).toBe('<h5>A</h5><p>tail</p>');
    store(ed, 6);
    expect(ed.getHTML()).toBe('<h5>A</h5><p>tail</p>');
  });

  it.each([['x', 'h1'], [null, 'h1'], [0, 'h1'], [7, 'h4'], [2.5, 'h3'], ['5', 'h4'], ['2', 'h2']])('renders the stored value %j as %s', (level, tag) => {
    const ed = mount();
    store(ed, level);
    expect(ed.getHTML()).toBe(`<${tag}>A</${tag}><p>tail</p>`);
  });

  it('renders a value that is not a number at the first configured level', () => {
    const ed = mount([3, 2], '<h2>A</h2>');
    store(ed, 'x');
    expect(ed.getHTML()).toBe('<h3>A</h3>');
  });

  it('keeps the heading level when generating HTML from JSON', () => {
    expect(generateHTML({ type: 'doc', content: [heading(5), heading(2, 'B')] }, [Document, Paragraph, Text, Heading]))
      .toBe('<h4>A</h4><h2>B</h2>');
  });
});

describe('the default heading level', () => {
  it('is the first configured level for content and commands without a level', () => {
    const ed = mount([2, 3], { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] } as never);
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(2);
    select(ed, ed.state.doc.content.size - 2);
    expect(ed.commands.setBlockType('heading')).toBe(true);
    expect(ed.state.doc.lastChild?.attrs['level']).toBe(2);
    expect(ed.getHTML()).toBe('<h2>A</h2><h2>B</h2>');
  });

  it('keeps level 1 for the default configuration', () => {
    const ed = mount(undefined, '<p>A</p>');
    expect(ed.commands.setBlockType('heading')).toBe(true);
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(1);
  });
});

describe('configured heading levels', () => {
  it.each([[[]], [[0]], [[7]], [['3']], [[1.5]]])('refuses levels %j when the editor, StarterKit or generateHTML builds the schema', levels => {
    const configured = Heading.configure({ levels: levels as number[] });
    expect(() => new Editor({ extensions: [Document, Paragraph, Text, configured] })).toThrow(ExtensionConfigurationError);
    expect(() => new Editor({ extensions: [StarterKit.configure({ heading: { levels: levels as number[] } })] }))
      .toThrow('Heading: levels must be a non-empty list of whole numbers from 1 to 6');
    expect(() => generateHTML({ type: 'doc', content: [] }, [Document, Paragraph, Text, configured])).toThrow(ExtensionConfigurationError);
  });

  it('accepts levels in any order and counts a repeated level once, at its first position', () => {
    const ed = mount([4, 2, 2], '<h2>A</h2><h4>B</h4><h3>C</h3>');
    expect(ed.getHTML()).toBe('<h2>A</h2><h4>B</h4><p>C</p>');
    select(ed, ed.state.doc.content.size - 1);
    expect(ed.commands.setBlockType('heading')).toBe(true);
    expect(ed.state.doc.lastChild?.attrs['level']).toBe(4);
  });
});

describe('repeated heading levels', () => {
  const headingOf = (ed: Editor): typeof Heading | undefined =>
    ed.extensionManager.extensions.find((extension): extension is typeof Heading => extension.name === 'heading');

  it('offers each level once in the toolbar, in the order first configured', () => {
    const ed = mount([4, 2, 2, 4]);
    const dropdown = ed.extensionManager.toolbarItems.find(item => item.name === 'heading');
    expect(dropdown?.type === 'dropdown' ? dropdown.items.map(item => item.name) : []).toEqual(['paragraph', 'heading4', 'heading2']);
  });

  it('offers each level once in the floating menu', () => {
    const ed = mount([2, 1, 2, 1, 3]);
    expect(ed.extensionManager.floatingMenuItems.map(item => item.name).filter(name => name.startsWith('heading-')))
      .toEqual(['heading-2', 'heading-1', 'heading-3']);
  });

  it('builds one parse rule and one shortcut per level', () => {
    const ed = mount([4, 2, 2]);
    expect(ed.schema.nodes['heading']?.spec.parseDOM?.map(rule => rule.tag)).toEqual(['h4', 'h2']);
    const shortcuts = Object.keys(headingOf(ed)?.config.addKeyboardShortcuts?.call(headingOf(ed) as never) ?? {})
      .filter(key => key.startsWith('Mod-Alt-'));
    expect(shortcuts).toEqual(['Mod-Alt-4', 'Mod-Alt-2']);
  });

  it.each([[[2, 2], [2]], [[1, 1, 1, 1], [1]], [[4, 2, 2], [4, 2]]])('treats %j as %j and keeps the first as the default', (levels, effective) => {
    const ed = mount(levels, '<p>Text</p>');
    expect(ed.schema.nodes['heading']?.spec.parseDOM?.map(rule => rule.tag)).toEqual(effective.map(level => `h${String(level)}`));
    select(ed, 1);
    expect(ed.commands.setHeading()).toBe(true);
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(effective[0]);
  });

  it('leaves the configured option as the application wrote it', () => {
    const levels = [4, 2, 2];
    const ed = mount(levels);
    expect(headingOf(ed)?.options.levels).toEqual([4, 2, 2]);
    expect(levels).toEqual([4, 2, 2]);
  });
});
