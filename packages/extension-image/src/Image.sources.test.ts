/**
 * Image sources through the core URL policy (F1 to F5): an address is judged
 * the way a browser reads it, so a leading space, a control character or a
 * line break cannot hide a script scheme or a data URL that allowBase64
 * refuses. Every entry and every sink applies the same decision, and an
 * allowed source is stored and rendered in its cleaned spelling.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, Editor, generateHTML } from '@domternal/core';
import type { AnyExtension, JSONContent } from '@domternal/core';
import { NodeSelection } from '@domternal/pm/state';
import { Image } from './Image.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** Sources every configuration allows, with the spelling that is stored and rendered. */
const ALLOWED: [source: string, url: string][] = [
  ['https://example.com/a.png', 'https://example.com/a.png'],
  ['HTTPS://EXAMPLE.COM/A.PNG', 'HTTPS://EXAMPLE.COM/A.PNG'],
  ['http://example.com/a.png', 'http://example.com/a.png'],
  [' https://example.com/a.png', 'https://example.com/a.png'],
  ['https://example.com/a.png ', 'https://example.com/a.png'],
  ['\u0001https://example.com/a.png', 'https://example.com/a.png'],
  ['https://exa\nmple.com/a.png', 'https://example.com/a.png'],
  ['https://example.com/\ta.png', 'https://example.com/a.png'],
  ['/images/a.png', '/images/a.png'],
  ['./a.png', './a.png'],
  ['../a.png', '../a.png'],
  ['a.png', 'a.png'],
  ['?q=1', '?q=1'],
  ['//cdn.example/a.png', '//cdn.example/a.png'],
  ['images\\a.png', 'images\\a.png'],
  ['/\\cdn.example/a.png', '/\\cdn.example/a.png'],
  ['blob:https://example.com/0000', 'blob:https://example.com/0000'],
  ['myapp://open/a.png', 'myapp://open/a.png'],
  ['ftp://example.com/a.png', 'ftp://example.com/a.png'],
  ['localhost:3000/a.png', 'localhost:3000/a.png'],
  ['https:example.com/a.png', 'https:example.com/a.png'],
  ['javascript%3Aalert(1)', 'javascript%3Aalert(1)'],
  // A literal entity is a relative path with a fragment: nothing decodes it into a scheme.
  ['&#106;avascript:alert(1)', '&#106;avascript:alert(1)'],
];

/** Sources no configuration allows. */
const REFUSED: string[] = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'java\tscr\nipt:alert(1)',
  'java\rscript:alert(1)',
  'java\u0000script:alert(1)',
  'java​script:alert(1)',
  '‮https://example.com/a.png',
  'https://example.com/\ud800.png',
  'vbscript:msgbox(1)',
  ' vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  ' data:text/html;base64,PHNjcmlwdD4=',
  'https://user:pass@example.com/a.png',
  'https://google.com@evil.example/a.png',
  'file:///etc/passwd',
  ' file:///etc/passwd',
  '%6Aavascript:alert(1)',
  'ｊavascript:alert(1)',
  'jаvascript:alert(1)',
  'javascript :x',
  ' javascript:x',
  '1abc:x',
  'https://exa mple.com/a.png',
];

/** Data images: allowed with allowBase64, refused without, however they are spelled. */
const DATA_IMAGES: [source: string, url: string][] = [
  [PNG, PNG],
  [` ${PNG}`, PNG],
  [`\u0001${PNG}`, PNG],
  [`da\nta:image/png;base64,iVBORw0KGgo=`, PNG],
  ['DATA:IMAGE/PNG;base64,iVBORw0KGgo=', 'DATA:IMAGE/PNG;base64,iVBORw0KGgo='],
  ['data:image/svg+xml,<svg onload="alert(1)"/>', 'data:image/svg+xml,<svg onload="alert(1)"/>'],
];

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

const extensions = (allowBase64 = true): AnyExtension[] => [Document, Text, Paragraph, Image.configure({ allowBase64 })];

const imageDoc = (src: unknown): JSONContent => ({ type: 'doc', content: [{ type: 'image', attrs: { src: src as string } }] });

function mount(content: JSONContent | string, allowBase64 = true): Editor {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = new Editor({ extensions: extensions(allowBase64), content });
  return editor;
}

const storedSource = (): unknown => {
  let src: unknown = 'no image';
  editor!.state.doc.descendants(node => { if (node.type.name === 'image') src = node.attrs['src']; });
  return src;
};

/** The src attribute of the image in the editor DOM, getHTML and generateHTML: null when absent. */
function renderedSources(content: JSONContent, allowBase64 = true): (string | null)[] {
  mount(content, allowBase64);
  const source = (root: Element): string | null => {
    const img = root.querySelector('img');
    return img ? img.getAttribute('src') : 'no image';
  };
  const parse = (html: string): string | null => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return source(host);
  };
  return [
    source(editor!.view.dom),
    parse(editor!.getHTML()),
    parse(generateHTML(content, extensions(allowBase64))),
  ];
}

function inputRule(src: string): unknown {
  mount('<p>x</p>');
  const extension = editor!.extensionManager.extensions.find(candidate => candidate.name === 'image')!;
  const addInputRules = (extension as { config: { addInputRules?: unknown } }).config.addInputRules as
    (this: unknown) => { handler: (...args: unknown[]) => unknown }[];
  const rules = addInputRules.call(extension);
  const wrapper = `![a](${src})`;
  return rules[0]!.handler(editor!.state, [wrapper, wrapper, 'a', src], 1, 2);
}

describe('allowed image sources (F1, F3)', () => {
  it.each(ALLOWED)('parses %j from HTML as %j', (source, url) => {
    const host = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', source);
    host.appendChild(img);
    mount(host.innerHTML);
    expect(storedSource()).toBe(url);
  });

  it.each(ALLOWED)('renders a stored %j as %j in the node view, getHTML and generateHTML', (source, url) => {
    expect(renderedSources(imageDoc(source))).toEqual([url, url, url]);
    // Loading keeps the stored spelling; only what is rendered is cleaned.
    expect(storedSource()).toBe(source);
  });

  it.each(ALLOWED)('setImage stores %j as %j', (source, url) => {
    mount('<p>x</p>');
    expect(editor!.commands.setImage({ src: source })).toBe(true);
    expect(storedSource()).toBe(url);
  });

  it.each(ALLOWED.filter(([source]) => !/\s/.test(source)))('the input rule inserts %j as %j', (source, url) => {
    const tr = inputRule(source) as { doc: { descendants: (visit: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } | null;
    expect(tr).not.toBeNull();
    let src: unknown;
    tr!.doc.descendants(node => { if (node.type.name === 'image') src = node.attrs['src']; });
    expect(src).toBe(url);
  });
});

describe('refused image sources (F1)', () => {
  it.each(REFUSED)('parses %j from HTML as no source', (source) => {
    const host = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', source);
    host.appendChild(img);
    mount(host.innerHTML);
    expect(storedSource()).toBeNull();
    expect(editor!.getHTML()).not.toMatch(/javascript|vbscript|data:text|file:/i);
  });

  it.each(REFUSED)('renders a stored %j as an empty src, and none in the node view', (source) => {
    expect(renderedSources(imageDoc(source))).toEqual([null, '', '']);
    expect(storedSource()).toBe(source);
  });

  it.each(REFUSED)('setImage and the input rule refuse %j', (source) => {
    mount('<p>x</p>');
    expect(editor!.commands.setImage({ src: source })).toBe(false);
    expect(storedSource()).toBe('no image');
    expect(inputRule(source)).toBeNull();
  });

  it.each([[['javascript:alert(1)']], [42], [{ src: 'x' }], [true]])('renders a stored %j that is not a string as an empty src', (source) => {
    expect(renderedSources(imageDoc(source))).toEqual([null, '', '']);
  });
});

describe('data images and allowBase64 (F2)', () => {
  it.each(DATA_IMAGES)('allows %j as %j with allowBase64', (source, url) => {
    expect(renderedSources(imageDoc(source))).toEqual([url, url, url]);
    editor!.destroy();
    mount('<p>x</p>');
    expect(editor!.commands.setImage({ src: source })).toBe(true);
    expect(storedSource()).toBe(url);
  });

  it.each(DATA_IMAGES)('refuses %j everywhere without allowBase64', (source) => {
    expect(renderedSources(imageDoc(source), false)).toEqual([null, '', '']);
    editor!.destroy();
    const host = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', source);
    host.appendChild(img);
    mount(host.innerHTML, false);
    expect(storedSource()).toBeNull();
    editor!.destroy();
    mount('<p>x</p>', false);
    expect(editor!.commands.setImage({ src: source })).toBe(false);
  });
});

describe('no source (F4)', () => {
  it.each([[null], ['']])('keeps %j as no source, with no src in the node view or the HTML', (source) => {
    const [view, html, generated] = renderedSources(imageDoc(source));
    expect(view).toBeNull();
    expect(html).toBeNull();
    expect(generated).toBeNull();
  });

  it('the node view removes the source when an update refuses it, and sets it again when allowed', () => {
    mount(imageDoc('https://example.com/a.png'));
    const img = (): HTMLImageElement => editor!.view.dom.querySelector('img')!;
    expect(img().getAttribute('src')).toBe('https://example.com/a.png');
    const update = (src: unknown): void => {
      editor!.view.dispatch(editor!.state.tr.setNodeMarkup(0, undefined, { ...editor!.state.doc.firstChild!.attrs, src }));
    };
    update(' javascript:alert(1)');
    expect(img().hasAttribute('src')).toBe(false);
    update(null);
    expect(img().hasAttribute('src')).toBe(false);
    update(' https://example.com/b.png');
    expect(img().getAttribute('src')).toBe('https://example.com/b.png');
  });

  it('selecting an image keeps its source', () => {
    mount(imageDoc('https://example.com/a.png'));
    editor!.view.dispatch(editor!.state.tr.setSelection(NodeSelection.create(editor!.state.doc, 0)));
    expect(editor!.view.dom.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  });
});
