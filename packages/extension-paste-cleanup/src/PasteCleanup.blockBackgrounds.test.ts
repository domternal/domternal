import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlockColor, Document, Editor, Extension, Heading, Highlight, History, Paragraph, Text, TextStyle, UniqueID,
} from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { undoDepth } from '@domternal/pm/history';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DOMParser } from '@domternal/pm/model';
import type { Root } from 'hast';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import { getUnsupportedDestinationFeatures } from './destinationCapabilities.js';
import { normalizeClipboardHTML, normalizePasteHTML } from './html/normalize.js';
import { firstParagraphFormat } from './html/firstParagraph.js';
import { adaptParagraphBackgrounds, PARAGRAPH_BACKGROUND_FEATURES } from './html/paragraphBackgrounds.js';
import { assertOutputTreeBounds } from './html/treeBounds.js';
import { StructureLimitError } from './html/parse.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(content = '<p></p>', colors: AnyExtension[] = [BlockColor, TextStyle, Highlight], options: PasteCleanupOptions = {}, extra: AnyExtension[] = []): Editor {
  vi.stubGlobal('ClipboardEvent', Event);
  const editor = new Editor({ content, extensions: [Document, Paragraph, Text, Heading, History, UniqueID, ...colors, ...extra, PasteCleanup.configure(options)] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  return editor;
}
function nativePaste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : '' } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
const diagnostics = (result: ReturnType<typeof normalizePasteHTML>): string[] => result.diagnostics.map(item => item.code);
function normalizedFor(editor: Editor, html: string): ReturnType<typeof normalizePasteHTML> {
  return normalizeClipboardHTML(html, {}, undefined, undefined,
    features => getUnsupportedDestinationFeatures(editor.schema, document, features)).result;
}

describe('paragraph background normalization and destination support', () => {
  it.each(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('keeps a %s fill on its owner without making it a text highlight', tag => {
    const result = normalizePasteHTML(`<${tag} style="background:#002060">Dark <span style="background:#fff2cc">highlight</span></${tag}>`);
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe(`<${tag} style="background-color:#002060">Dark <span><span style="background-color:#fff2cc">highlight</span></span></${tag}>`);
    expect(result.diagnostics).toEqual([]);
    const editor = mount();
    const parsed = (html: string): unknown => DOMParser.fromSchema(editor.schema).parse(new globalThis.DOMParser().parseFromString(html, 'text/html').body).toJSON();
    expect(parsed(normalizePasteHTML(result.html).html)).toEqual(parsed(result.html));
  });

  it.each(['preserve', 'adapt'] as const)('keeps empty blocks and separate cell fills under %s', formatting => {
    const result = normalizePasteHTML('<table><tr><td style="background:#fff2cc"><p style="background:#002060"></p></td></tr></table>', { formatting });
    expect(result.status).toBe('cleaned');
    if (formatting === 'preserve') {
      expect(result.html).toContain('<p style="background-color:#002060"></p>');
      expect(result.html).toContain('data-background="#fff2cc"');
      expect(result.diagnostics).toEqual([]);
    } else {
      expect(result.html).not.toContain('background');
      expect(diagnostics(result).every(code => code === 'formatting-adapted')).toBe(true);
    }
  });

  it('probes the actual node type and heading level rather than assuming paragraph support covers every heading', () => {
    const paragraphs = mount('<p></p>', [BlockColor.configure({ types: ['paragraph'] })]);
    expect(getUnsupportedDestinationFeatures(paragraphs.schema, document, PARAGRAPH_BACKGROUND_FEATURES))
      .toEqual(PARAGRAPH_BACKGROUND_FEATURES.slice(1));
    const headings = mount('<p></p>', [BlockColor.configure({ types: ['heading'] })]);
    expect(getUnsupportedDestinationFeatures(headings.schema, document, PARAGRAPH_BACKGROUND_FEATURES))
      .toEqual(['paragraph-background', 'heading-5-background', 'heading-6-background']);
  });

  it('does not confirm a constant default background as a reader for authored colors', () => {
    const constant = Extension.create({ name: 'constantBackground', addGlobalAttributes: () => [{ types: ['paragraph'], attributes: { bgColor: { default: '#123456' } } }] });
    const editor = mount('<p></p>', [constant]);
    expect(getUnsupportedDestinationFeatures(editor.schema, document, ['paragraph-background'])).toEqual(['paragraph-background']);
  });

  it('uses the final adapted heading level to decide whether its full-width fill is retained', () => {
    const editor = mount('<p></p>', [BlockColor.configure({ types: ['heading'] }), TextStyle, Highlight]);
    const result = normalizedFor(editor, '<h6 style="background:#002060">Heading</h6>');
    expect(result.html).toBe('<h4 style="background-color:#002060">Heading</h4>');
    expect(diagnostics(result)).toEqual(['destination-heading-level-adapted']);
  });

  it('falls back to an inline highlight with a warning while retaining a nested independent highlight', () => {
    const editor = mount('<p></p>', [TextStyle, Highlight]);
    const result = normalizedFor(editor, '<p style="background:#002060">Outer <span style="background:#fff2cc">Inner</span></p>');
    expect(result.html).toBe('<p><span style="background-color:#002060">Outer <span><span style="background-color:#fff2cc">Inner</span></span></span></p>');
    expect(diagnostics(result)).toEqual(['destination-formatting-unconfirmed']);
    editor.view.pasteHTML('<p style="background:#002060">Outer <span style="background:#fff2cc">Inner</span></p>');
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs['backgroundColor']).toBe('#002060');
    expect(editor.state.doc.firstChild?.lastChild?.marks[0]?.attrs['backgroundColor']).toBe('#fff2cc');
  });

  it('keeps text or an empty paragraph when neither full-width nor inline background support is available', () => {
    const editor = mount('<p></p>', []);
    for (const text of ['Text', '']) {
      const result = normalizedFor(editor, `<p style="background:#002060">${text}</p>`);
      expect(result.html).toBe(`<p>${text}</p>`);
      expect(diagnostics(result)).toEqual(['destination-formatting-unconfirmed']);
    }
  });

  it('keeps generated fallback spans within output node and depth limits', () => {
    const tree: Root = { type: 'root', children: [{ type: 'element', tagName: 'p', properties: { style: 'background-color:#002060' }, children: [{ type: 'text', value: 'Text' }] }] };
    expect(adaptParagraphBackgrounds(tree, features => features.filter(feature => feature !== 'highlight'), () => undefined)).toBe(true);
    expect(() => { assertOutputTreeBounds(tree, 4, 3); }).not.toThrow();
    expect(() => { assertOutputTreeBounds(tree, 3, 3); }).toThrow(StructureLimitError);
    expect(() => { assertOutputTreeBounds(tree, 4, 2); }).toThrow(StructureLimitError);
  });
});

describe('full background insertion into the first paragraph', () => {
  for (const route of ['native', 'programmatic'] as const) for (const color of ['#002060', 'red', 'rgba(0,0,0,0.3)']) {
    it(`preserves the ${color} source fill in an empty paragraph through ${route}`, async () => {
      const editor = mount('<p style="background-color:#fff2cc"></p>');
      await vi.waitFor(() => { expect(editor.state.doc.firstChild?.attrs['id']).toEqual(expect.any(String)); });
      const before = editor.getJSON();
      const identity = editor.state.doc.firstChild?.attrs['id'];
      const html = `<p style="background:${color}">Source</p>`;
      if (route === 'native') nativePaste(editor, html);
      else editor.view.pasteHTML(html);
      const expected = color === 'red' ? '#ff0000' : color.startsWith('rgba') ? 'rgba(0, 0, 0, 0.3)' : color;
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ bgColor: expected, id: identity });
      expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
      expect(undoDepth(editor.state)).toBe(1);
      const after = editor.getJSON();
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(before);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.getJSON()).toEqual(after);
    });
  }

  it('keeps a nonempty destination background and does not spread a source fill over existing text', () => {
    const editor = mount('<p style="background-color:#fff2cc">Before</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    editor.view.pasteHTML('<p style="background:#002060">Source</p>');
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('#fff2cc');
    expect(editor.state.doc.textContent).toBe('BefSourceore');
  });

  it('retains the destination fill under Adapt or when the source has no explicit fill', () => {
    for (const adapt of [false, true]) {
      const editor = mount('<p style="background-color:#fff2cc"></p>', [BlockColor], adapt ? { formatting: 'adapt' } : {});
      editor.view.pasteHTML(adapt ? '<p style="background:#002060">Source</p>' : '<p>Source</p>');
      expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('#fff2cc');
    }
  });

  it('does not restore a fill that a later host transform deliberately removed', () => {
    const host = Extension.create({ name: 'hostBackground', priority: 50, addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML: html => html.replaceAll('background-color:#002060', ''),
    } })] });
    const editor = mount('<p style="background-color:#fff2cc"></p>', [BlockColor], {}, [host]);
    editor.view.pasteHTML('<p style="background:#002060">Source</p>');
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('#fff2cc');
  });

  it('carries a background intent privately and only for external Preserve content', () => {
    const result = normalizePasteHTML('<p style="background:#002060">Source</p>');
    expect(firstParagraphFormat(result)).toMatchObject({ bgColor: '#002060', text: 'Source' });
    expect(firstParagraphFormat({ ...result })).toBeUndefined();
    expect(firstParagraphFormat(normalizePasteHTML('<p style="background:#002060">Source</p>', { formatting: 'adapt' }))).toBeUndefined();
  });
});
