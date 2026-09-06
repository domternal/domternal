/**
 * Stored style values reach a style attribute only when they cannot add a
 * declaration or load a resource: text color, highlight, font family, font
 * size, alignment and line height. The stored value is kept; the style
 * commands refuse unsafe values.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Heading } from '../nodes/Heading.js';
import { TextStyle } from '../marks/TextStyle.js';
import { TextColor } from './TextColor.js';
import { Highlight } from './Highlight.js';
import { FontFamily } from './FontFamily.js';
import { FontSize } from './FontSize.js';
import { TextAlign } from './TextAlign.js';
import { LineHeight } from './LineHeight.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONAttribute, JSONContent } from '../types/Content.js';
import type { AnyExtension } from '../types/index.js';

const extensions: AnyExtension[] = [
  Document, Paragraph, Text, Heading, TextStyle, TextColor, Highlight, FontFamily, FontSize, TextAlign, LineHeight,
];
const UNSAFE: JSONAttribute[] = [
  'red;position:fixed;inset:0;z-index:2147483647',
  'url(https://probe.test/x)',
  'red !important',
  'red/**/',
  '\\3b',
  'expression(alert(1))',
  '@import url(x)',
  'red\nposition:fixed',
  '',
  ['red'],
  42,
  { color: 'red' },
];

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

const styled = (attrs: Record<string, JSONAttribute>): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs }] },
] }] });
const block = (attrs: Record<string, JSONAttribute>): JSONContent => ({ type: 'doc', content: [
  { type: 'paragraph', attrs, content: [{ type: 'text', text: 'x' }] },
] });

function mount(content: JSONContent | string = '<p>hello</p>', list: AnyExtension[] = extensions): Editor {
  editor = new Editor({ extensions: list, content });
  return editor;
}

function select(from: number, to: number): void {
  editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(editor!.state.doc, from, to)));
}

interface Rendered {
  /** Style attributes in the editor DOM, as the browser normalizes them. */
  readonly editor: string[];
  /** Style attributes written by getHTML and generateHTML, as rendered. */
  readonly html: string[];
}

/** Every style attribute the editor DOM, getHTML and generateHTML render for the content. */
function rendered(content: JSONContent, list: AnyExtension[] = extensions): Rendered {
  mount(content, list);
  const styles = (root: Element): string[] => Array.from(root.querySelectorAll('[style]')).map(element => element.getAttribute('style') ?? '');
  const fromHTML = (html: string): string[] => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return styles(host);
  };
  return { editor: styles(editor!.view.dom), html: [...fromHTML(editor!.getHTML()), ...fromHTML(generateHTML(content, list))] };
}

/**
 * Expects one declaration of `property` everywhere, and nothing else: the
 * browser DOM normalizes how a value is spelled, so the spelling itself is
 * checked on the attribute renderers below.
 */
function expectDeclaration(result: Rendered, property: string): void {
  expect(result.editor).toHaveLength(1);
  expect(result.html).toHaveLength(2);
  for (const style of [...result.editor, ...result.html]) {
    const element = document.createElement('span');
    element.setAttribute('style', style);
    expect(element.style.length, style).toBe(1);
    expect(element.style.getPropertyValue(property), style).not.toBe('');
  }
}

/** The style a global attribute renderer of `extension` writes for `attributes`. */
function rendererStyle(extension: AnyExtension, attribute: string, attributes: Record<string, unknown>): unknown {
  const specs = ((extension as { config: { addGlobalAttributes?: unknown } }).config.addGlobalAttributes as ((this: unknown) => { attributes: Record<string, { renderHTML?: (attrs: Record<string, unknown>) => unknown }> }[]) | undefined)
    ?.call(extension) ?? [];
  const rendered = specs[0]?.attributes[attribute]?.renderHTML?.(attributes);
  return (rendered as { style?: unknown } | null | undefined)?.style;
}

/** Expects no style anywhere. */
function expectNoStyle(result: Rendered): void {
  expect(result.editor).toEqual([]);
  expect(result.html).toEqual([]);
}

describe.each([
  ['color', 'color', ['#ff0000', 'rgb(1, 2, 3)', 'red', 'var(--c)']],
  ['backgroundColor', 'background-color', ['#ff0000', 'rgb(1, 2, 3)', 'yellow', 'var(--c)']],
  ['fontSize', 'font-size', ['18px', '1.2em', 'larger', 'calc(1em + 2px)']],
])('the %s attribute (G1, G2, G4)', (attribute, property, safe) => {
  it.each(safe)('renders the safe value %j in the editor, getHTML and generateHTML', (value) => {
    expectDeclaration(rendered(styled({ [attribute]: value })), property);
  });

  it.each(safe)('writes %j as it is stored', (value) => {
    const owner = attribute === 'color' ? TextColor : attribute === 'backgroundColor' ? Highlight : FontSize;
    expect(rendererStyle(owner, attribute, { [attribute]: value })).toBe(`${property}: ${value}`);
  });

  it.each(UNSAFE.map(value => [JSON.stringify(value), value]))('does not render %s, and keeps it stored', (_label, value) => {
    expectNoStyle(rendered(styled({ [attribute]: value })));
    expect(editor!.state.doc.firstChild?.firstChild?.marks[0]?.attrs[attribute]).toEqual(value);
    expect(editor!.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.[attribute]).toEqual(value);
  });

  it('renders the safe declarations of a mark whose other value is unsafe', () => {
    const other = attribute === 'color' ? { fontSize: '18px' } : { color: '#123456' };
    const result = rendered(styled({ [attribute]: 'red;position:fixed', ...other }));
    expect(result.editor).toHaveLength(1);
    for (const style of [...result.editor, ...result.html]) {
      expect(style).not.toContain(property);
      expect(style).not.toContain('position');
    }
    expectDeclaration(result, attribute === 'color' ? 'font-size' : 'color');
  });
});

describe('font family (G3)', () => {
  it.each([
    ['Arial', 'font-family: Arial'],
    ['Times New Roman', "font-family: 'Times New Roman'"],
    ['微软雅黑', 'font-family: 微软雅黑'],
    ['Times New Roman, serif', "font-family: 'Times New Roman', serif"],
    ['"Times New Roman", Georgia, serif', "font-family: 'Times New Roman', Georgia, serif"],
    ["'Noto Sans JP'", "font-family: 'Noto Sans JP'"],
    ['var(--font-body)', 'font-family: var(--font-body)'],
  ])('renders %j as %j', (value, declaration) => {
    expect(rendererStyle(FontFamily, 'fontFamily', { fontFamily: value })).toBe(declaration);
    expectDeclaration(rendered(styled({ fontFamily: value })), 'font-family');
  });

  it.each([
    ["x';background:url(y);'"],
    ['x";background:url(y);"'],
    ['Arial;position:fixed'],
    ['url(https://probe.test/font)'],
    ['Arial\\3b position:fixed'],
    ['Arial, url(x)'],
    ['""'],
    [', ,'],
  ])('does not render %j, and keeps it stored', (value) => {
    expectNoStyle(rendered(styled({ fontFamily: value })));
    expect(editor!.state.doc.firstChild?.firstChild?.marks[0]?.attrs['fontFamily']).toBe(value);
  });

  it('writes the dropdown preview the same way', () => {
    const configured = FontFamily.configure({ fontFamilies: ['Arial', 'Times New Roman, serif', 'x;position:fixed'] });
    const dropdown = configured.config.addToolbarItems?.call(configured)[0];
    const styles = dropdown?.type === 'dropdown' ? dropdown.items.map(item => item.style) : [];
    expect(styles).toEqual(['font-family: Arial', "font-family: 'Times New Roman', serif", undefined]);
  });
});

describe('text alignment (G5)', () => {
  it.each(['center', 'right', 'justify', 'start', 'end', 'CENTER'])('renders the keyword %s', (textAlign) => {
    expect(rendererStyle(TextAlign, 'textAlign', { textAlign })).toBe(`text-align: ${textAlign.toLowerCase()}`);
    expectDeclaration(rendered(block({ textAlign })), 'text-align');
  });

  it.each(['left;position:fixed;inset:0', 'center !important', 'url(x)', 'middle', 'var(--align)'])('does not render %j, and keeps it stored', (textAlign) => {
    expectNoStyle(rendered(block({ textAlign })));
    expect(editor!.state.doc.firstChild?.attrs['textAlign']).toBe(textAlign);
  });

  it('refuses an alignment that is not a CSS keyword even when configured', () => {
    mount('<p>x</p>', [Document, Paragraph, Text, TextAlign.configure({ alignments: ['left', 'center', 'left;position:fixed'] })]);
    select(1, 2);
    expect(editor!.commands.setTextAlign('left;position:fixed')).toBe(false);
    expect(editor!.getHTML()).toBe('<p>x</p>');
    expect(editor!.commands.setTextAlign('center')).toBe(true);
    expect(editor!.state.doc.firstChild?.attrs['textAlign']).toBe('center');
  });
});

describe('line height (G8)', () => {
  it('renders only configured values, as before', () => {
    expectDeclaration(rendered(block({ lineHeight: '1.5' })), 'line-height');
    editor!.destroy();
    expectNoStyle(rendered(block({ lineHeight: '3' })));
  });

  it('renders only safe values when the list is empty, and the command refuses unsafe ones', () => {
    const list = [Document, Paragraph, Text, LineHeight.configure({ lineHeights: [] })];
    expectDeclaration(rendered(block({ lineHeight: '1.8' }), list), 'line-height');
    editor!.destroy();
    expectNoStyle(rendered(block({ lineHeight: '2;position:fixed' }), list));
    expect(editor!.state.doc.firstChild?.attrs['lineHeight']).toBe('2;position:fixed');
    select(1, 2);
    expect(editor!.commands.setLineHeight('2;position:fixed')).toBe(false);
    expect(editor!.commands.setLineHeight('2')).toBe(true);
  });
});

describe('style commands (G7)', () => {
  const REFUSED = ['red;position:fixed', 'url(x)', 'red !important', ''];

  it.each(REFUSED)('refuse %j and change nothing', (value) => {
    mount();
    select(1, 6);
    expect(editor!.commands.setTextColor(value)).toBe(false);
    expect(editor!.commands.setHighlight({ color: value })).toBe(false);
    expect(editor!.commands.toggleHighlight({ color: value })).toBe(false);
    expect(editor!.commands.setFontFamily(value)).toBe(false);
    expect(editor!.commands.setFontSize(value)).toBe(false);
    expect(editor!.can().setTextColor(value)).toBe(false);
    expect(editor!.getHTML()).toBe('<p>hello</p>');
  });

  it('accept safe values', () => {
    mount();
    select(1, 6);
    expect(editor!.commands.setTextColor('#123456')).toBe(true);
    expect(editor!.commands.setHighlight({ color: 'hsl(60 100% 50%)' })).toBe(true);
    expect(editor!.commands.setFontFamily('Times New Roman')).toBe(true);
    expect(editor!.commands.setFontSize('calc(1em + 2px)')).toBe(true);
    expect(editor!.state.doc.firstChild?.firstChild?.marks[0]?.attrs).toMatchObject({
      color: '#123456', backgroundColor: 'hsl(60 100% 50%)', fontFamily: 'Times New Roman', fontSize: 'calc(1em + 2px)',
    });
  });

  it('toggleHighlight still removes an existing highlight whatever color it is given', () => {
    mount('<p><span style="background-color: yellow">hello</span></p>');
    select(1, 6);
    expect(editor!.commands.toggleHighlight({ color: 'red;position:fixed' })).toBe(true);
    expect(editor!.getHTML()).toBe('<p>hello</p>');
  });

  it('refuse an unsafe configured default highlight color', () => {
    editor = new Editor({ extensions: [Document, Paragraph, Text, TextStyle, Highlight.configure({ defaultColor: 'red;position:fixed' })], content: '<p>hello</p>' });
    select(1, 6);
    expect(editor.commands.setHighlight()).toBe(false);
    expect(editor.commands.toggleHighlight()).toBe(false);
    expect(editor.getHTML()).toBe('<p>hello</p>');
  });
});

describe('parsing (G2)', () => {
  it('keeps what CSSOM reads from pasted HTML, one property each', () => {
    mount('<p><span style="color: rgb(255, 0, 0); font-size: 18px; font-family: &quot;Times New Roman&quot;, serif; background-color: rgb(255, 255, 0)">x</span></p>');
    expect(editor!.state.doc.firstChild?.firstChild?.marks[0]?.attrs).toMatchObject({
      color: '#ff0000', fontSize: '18px', fontFamily: 'Times New Roman, serif', backgroundColor: '#ffff00',
    });
    expect(rendererStyle(FontFamily, 'fontFamily', { fontFamily: 'Times New Roman, serif' })).toBe("font-family: 'Times New Roman', serif");
  });
});
