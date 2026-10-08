/**
 * Alt text: decorative and not described. In HTML an empty alt marks a decorative image, which
 * assistive technology skips, while a missing alt means the image has no description yet, which
 * accessibility checkers flag. The node stores the two as '' and null, and every path keeps them
 * apart: the schema's toDOM, getHTML() and generateHTML(), an HTML round trip, the node view when
 * it is created and after every update, the Markdown input rule and the Edit alt text menu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, History, Editor, generateHTML, generateJSON } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import type { EditorView } from '@domternal/pm/view';
import { Image } from './Image.js';

const SRC = 'https://example.com/a.png';
const extensions = [Document, Text, Paragraph, History, Image];

let editor: Editor | undefined;
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

function mount(content: JSONContent | string): Editor {
  editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions, content });
  return editor;
}

/** A document of one image per alt value, in order. */
function imagesJSON(...alts: (string | null)[]): JSONContent {
  return { type: 'doc', content: alts.map(alt => ({ type: 'image', attrs: { src: SRC, alt } })) };
}

/** The stored alt of every image, in document order. */
function storedAlts(ed: Editor): unknown[] {
  const alts: unknown[] = [];
  ed.state.doc.descendants(node => { if (node.type.name === 'image') alts.push(node.attrs['alt']); });
  return alts;
}

/** The alt attribute of every rendered img in an HTML string, or null where it has none. */
function htmlAlts(html: string): (string | null)[] {
  return (html.match(/<img\b[^>]*>/g) ?? []).map(tag => /\salt="([^"]*)"/.exec(tag)?.[1] ?? null);
}

/** The alt attribute of every img the node views show, or null where it has none. */
function liveAlts(ed: Editor): (string | null)[] {
  return Array.from(ed.view.dom.querySelectorAll('.dm-image-resizable img')).map(img => img.getAttribute('alt'));
}

function imagePositions(ed: Editor): number[] {
  const positions: number[] = [];
  ed.state.doc.descendants((node, pos) => { if (node.type.name === 'image') positions.push(pos); });
  return positions;
}

type TextInputHandler = (view: EditorView, from: number, to: number, text: string, deflt: () => Transaction) => boolean | undefined;

/** Types text at the selection, as the browser's text input reaches the input rules. */
function type(ed: Editor, text: string): void {
  const { from, to } = ed.view.state.selection;
  const insert = (): Transaction => ed.view.state.tr.insertText(text, from, to);
  const handled = ed.view.someProp('handleTextInput', handler => (handler as TextInputHandler)(ed.view, from, to, text, insert));
  if (handled !== true) ed.view.dispatch(insert());
}

/** Opens the Edit alt text menu on the image at `pos`, as its bubble menu action does. */
function openAltMenu(ed: Editor, pos: number): HTMLInputElement {
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
  (ed as unknown as { emit: (event: string, payload: unknown) => void }).emit('editImage', {});
  const input = document.querySelector<HTMLInputElement>('.dm-image-popover[data-show] .dm-image-popover-alt-input');
  if (!input) throw new Error('the Edit alt text menu did not open');
  return input;
}

function pressEnter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('Image alt text: decorative and not described', () => {
  describe('rendering', () => {
    it('toDOM writes an empty alt and leaves out a missing one', () => {
      const toDOM = Image.createNodeSpec().toDOM!;
      const attrs = (alt: string | null): Record<string, unknown> =>
        ({ src: SRC, alt, title: null, width: null, height: null, loading: null, crossorigin: null, float: 'none', align: 'none' });
      const rendered = (alt: string | null): Record<string, unknown> =>
        (toDOM({ attrs: attrs(alt) } as never) as unknown as [string, Record<string, unknown>])[1];

      expect(rendered('')).toHaveProperty('alt', '');
      expect(rendered(null)).not.toHaveProperty('alt');
      expect(rendered('A cat')).toHaveProperty('alt', 'A cat');
    });

    it('getHTML() and generateHTML() write alt="" for a decorative image and no alt for one without', () => {
      const content = imagesJSON('A cat', '', null);
      expect(htmlAlts(mount(content).getHTML())).toEqual(['A cat', '', null]);
      expect(htmlAlts(generateHTML(content, extensions))).toEqual(['A cat', '', null]);
    });

    it('setImage({ alt: "" }) marks the image decorative, and setImage without alt leaves it undescribed', () => {
      const ed = mount('<p></p>');
      ed.commands.setImage({ src: SRC, alt: '' });
      expect(storedAlts(ed)).toEqual(['']);
      expect(htmlAlts(ed.getHTML())).toEqual(['']);

      ed.setContent('<p></p>', false);
      ed.commands.setImage({ src: SRC });
      expect(storedAlts(ed)).toEqual([null]);
      expect(htmlAlts(ed.getHTML())).toEqual([null]);
    });
  });

  describe('HTML round trip', () => {
    it('generateJSON(generateHTML()) keeps an empty alt and a missing one apart', () => {
      const json = generateJSON(generateHTML(imagesJSON('', null, 'A cat'), extensions), extensions);
      const alts = (json.content ?? []).filter(node => node.type === 'image').map(node => node.attrs?.['alt']);
      expect(alts).toEqual(['', null, 'A cat']);
    });

    it('content with alt="" stores the empty alt and getHTML() writes it again', () => {
      const ed = mount(`<img src="${SRC}" alt=""><img src="${SRC}">`);
      expect(storedAlts(ed)).toEqual(['', null]);
      expect(htmlAlts(ed.getHTML())).toEqual(['', null]);

      ed.setContent(ed.getHTML(), false);
      expect(storedAlts(ed)).toEqual(['', null]);
    });
  });

  describe('node view', () => {
    it('writes alt="" for a decorative image and no alt for one without when it is created', () => {
      expect(liveAlts(mount(imagesJSON('A cat', '', null)))).toEqual(['A cat', '', null]);
    });

    // The update path runs on every change of the node: a resize, a placement, a title or a remote change.
    it.each<[from: string | null, to: string | null, live: string | null]>([
      [null, null, null],
      ['A cat', null, null],
      ['', null, null],
      ['', '', ''],
      [null, '', ''],
      ['A cat', '', ''],
      ['', 'A dog', 'A dog'],
      [null, 'A dog', 'A dog'],
    ])('an update from alt %j to %j shows alt %j', (from, to, live) => {
      const ed = mount(imagesJSON(from));
      const img = ed.view.dom.querySelector('.dm-image-resizable img');
      const pos = imagePositions(ed)[0]!;
      const node = ed.state.doc.nodeAt(pos)!;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: to, title: 'Changed' }));

      // The same element, so the node view updated it rather than drawing a new one.
      expect(ed.view.dom.querySelector('.dm-image-resizable img')).toBe(img);
      expect(img?.getAttribute('title')).toBe('Changed');
      expect(liveAlts(ed)).toEqual([live]);
      expect(htmlAlts(ed.getHTML())).toEqual([live]);
    });
  });

  describe('input rule', () => {
    it('typing ![](src) stores an image without alt, as Markdown paste does', () => {
      const ed = mount(`<p>![](${SRC}</p>`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
      type(ed, ')');

      expect(storedAlts(ed)).toEqual([null]);
      expect(htmlAlts(ed.getHTML())).toEqual([null]);
    });

    it('typing ![text](src) stores the text as alt', () => {
      const ed = mount(`<p>![A cat](${SRC}</p>`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
      type(ed, ')');

      expect(storedAlts(ed)).toEqual(['A cat']);
    });
  });

  describe('Edit alt text menu', () => {
    it.each<[alt: string | null]>([[''], [null], ['A cat']])('applying the field unchanged on alt %j changes nothing', (alt) => {
      const ed = mount(imagesJSON(alt));
      const live = liveAlts(ed);
      const input = openAltMenu(ed, imagePositions(ed)[0]!);
      expect(input.value).toBe(alt ?? '');
      const doc = ed.state.doc;
      const depth: number = undoDepth(ed.state);

      pressEnter(input);

      expect(document.querySelector('.dm-image-popover[data-show]')).toBeNull();
      expect(ed.state.doc).toBe(doc);
      expect(undoDepth(ed.state)).toBe(depth);
      expect(storedAlts(ed)).toEqual([alt]);
      expect(liveAlts(ed)).toEqual(live);
    });

    it('clearing the field stores an image without alt, which shows no alt', () => {
      const ed = mount(imagesJSON('A cat'));
      const input = openAltMenu(ed, imagePositions(ed)[0]!);
      input.value = '';
      pressEnter(input);

      expect(storedAlts(ed)).toEqual([null]);
      expect(liveAlts(ed)).toEqual([null]);
      expect(htmlAlts(ed.getHTML())).toEqual([null]);
    });

    it('clearing the field of a decorative image after typing in it stores an image without alt', () => {
      const ed = mount(imagesJSON(''));
      const input = openAltMenu(ed, imagePositions(ed)[0]!);
      input.value = '   ';
      pressEnter(input);

      expect(storedAlts(ed)).toEqual([null]);
      expect(liveAlts(ed)).toEqual([null]);
    });

    it('a changed field stores the trimmed text in one undo step', () => {
      const ed = mount(imagesJSON(''));
      const depth: number = undoDepth(ed.state);
      const input = openAltMenu(ed, imagePositions(ed)[0]!);
      input.value = '  A dog  ';
      pressEnter(input);

      expect(storedAlts(ed)).toEqual(['A dog']);
      expect(liveAlts(ed)).toEqual(['A dog']);
      expect(undoDepth(ed.state)).toBe(depth + 1);
    });
  });
});
