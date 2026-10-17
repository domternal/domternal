import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Gapcursor, History, Paragraph, Text, TrailingNode } from '@domternal/core';
import type { ChainedCommands, CommandProps } from '@domternal/core';
import { NodeSelection } from '@domternal/pm/state';
import { Image } from './Image.js';
import { normalizeImageTransform } from './imageTransform.js';

const editors: Editor[] = [];
const geometry = { naturalWidth: 400, naturalHeight: 200, crop: { left: .25, right: .25 }, rotation: 90, flipX: true };
function editor(attrs: Record<string, unknown> = {}): Editor {
  const instance = new Editor({
    element: document.createElement('div'), extensions: [Document, Paragraph, Text, History, Gapcursor, Image.configure({ enableTransforms: true })],
    content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', alt: '', ...attrs } }] },
  });
  editors.push(instance);
  instance.view.dispatch(instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, 0)));
  return instance;
}
afterEach(() => { editors.splice(0).forEach(value => { value.destroy(); }); vi.restoreAllMocks(); });

describe('image transform rendering and authoring', () => {
  it('keeps ordinary images unwrapped and omits identity metadata', () => {
    const instance = editor();
    expect(instance.getHTML()).toBe('<img src="/image.png" alt="">');
    expect(instance.view.dom.querySelector('[data-dm-image-viewport]')).toBeNull();
    expect(instance.commands.setImageTransform({ naturalWidth: 400, naturalHeight: 200 })).toBe(true);
    expect(instance.getHTML()).toBe('<img src="/image.png" alt="">');
  });
  it.each(['left', 'right', 'center', 'none'])('round trips geometry and %s float through HTML', float => {
    const instance = editor({ imageTransform: geometry, width: '120px', height: 10, float, title: 'Example' });
    const html = instance.getHTML();
    const surface = document.createElement('div');
    surface.innerHTML = html;
    const viewport = surface.querySelector<HTMLElement>('[data-dm-image-viewport]');
    expect(viewport?.style.width).toBe('120px');
    expect(viewport?.style.aspectRatio).toBe('200/200');
    expect(surface.querySelector('img')?.getAttribute('alt')).toBe('');
    instance.commands.setContent(html);
    expect(instance.state.doc.firstChild?.attrs).toMatchObject({ imageTransform: normalizeImageTransform(geometry), width: '120px', height: '10', float, alt: '', title: 'Example' });
  });
  it.each(['left', 'center', 'right'])('retains %s alignment independently of float', align => {
    const instance = editor({ imageTransform: geometry, align });
    instance.commands.setContent(instance.getHTML());
    expect(instance.state.doc.firstChild?.attrs).toMatchObject({ align, float: 'none', imageTransform: normalizeImageTransform(geometry) });
  });
  it('preserves image DOM identity and supports undo', () => {
    const instance = editor({ width: 120 });
    const img = instance.view.dom.querySelector('img');
    const before = instance.state.doc.toJSON();
    expect(instance.commands.setImageTransform(geometry)).toBe(true);
    expect(instance.view.dom.querySelector('img')).toBe(img);
    expect(instance.view.dom.querySelector<HTMLElement>('[data-dm-image-viewport]')?.style.width).toBe('120px');
    expect(img?.parentElement?.style.transform).toContain('rotate(90deg)');
    expect(img?.style.width).toBe('200%');
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.toJSON()).toEqual(before);
    expect(instance.view.dom.querySelector('img')).toBe(img);
    expect(instance.view.dom.querySelector('[data-dm-image-viewport]')).toBeNull();
  });
  it('undoes a chained selection and transform with TrailingNode back to the exact source', () => {
    const instance = new Editor({ element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, History, TrailingNode, Image.configure({ enableTransforms: true })],
      content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', imageTransform: geometry } }] } });
    editors.push(instance);
    const before = instance.state.doc.toJSON();
    // The runtime command helper is not part of the public ChainedCommands type.
    const chain = instance.chain() as ChainedCommands & { command: (fn: (props: CommandProps) => boolean) => ChainedCommands };
    expect(chain.command(({ tr }) => {
      tr.setSelection(NodeSelection.create(tr.doc, 0)); return true;
    }).setImageTransform(null).run()).toBe(true);
    expect(instance.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toBeNull();
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.toJSON()).toEqual(before);
    expect(instance.commands.undo()).toBe(false);
  });
  it('reads dimensions only when an explicit command targets a loaded image', () => {
    const instance = editor();
    const img = instance.view.dom.querySelector('img')!;
    Object.defineProperties(img, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
    const before = instance.state.doc.toJSON();
    img.dispatchEvent(new Event('load'));
    expect(instance.state.doc.toJSON()).toEqual(before);
    expect(instance.can().setImageTransform({ rotation: 90 })).toBe(true);
    expect(instance.state.doc.toJSON()).toEqual(before);
    expect(instance.commands.setImageTransform({ rotation: 90 })).toBe(true);
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toMatchObject({ naturalWidth: 640, naturalHeight: 480, rotation: 90 });
    expect(instance.commands.setImageTransform({ flipY: true })).toBe(true);
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toMatchObject({ naturalWidth: 640, naturalHeight: 480, rotation: 0, flipY: true });
    expect(instance.commands.setImageTransform(null)).toBe(true);
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toBeNull();
  });
  it('refuses unavailable dimensions, malformed geometry and non-image selections', () => {
    const instance = editor();
    const before = instance.state.doc.toJSON();
    expect(instance.commands.setImageTransform({ rotation: 45 })).toBe(false);
    expect(instance.commands.setImageTransform({ ...geometry, crop: { left: .8, right: .8 } })).toBe(false);
    expect(instance.commands.setImage({ src: '/other.png', imageTransform: { ...geometry, rotation: Number.NaN } })).toBe(false);
    expect(instance.state.doc.toJSON()).toEqual(before);
    instance.commands.setContent('<p>Text</p>');
    expect(instance.commands.setImageTransform(geometry)).toBe(false);
  });
  it('ignores malformed persisted geometry while retaining URL policy', () => {
    const instance = editor({ imageTransform: { ...geometry, rotation: 'url(example)' }, src: 'javascript:alert(1)' });
    expect(instance.getHTML()).toBe('<img src="" alt="">');
    expect(instance.view.dom.querySelector('img')?.getAttribute('src')).toBeNull();
    expect(instance.view.dom.querySelector('[data-dm-image-viewport]')).toBeNull();
  });
  it('keeps an oversized numeric width in a bounded CSS viewport instead of collapsing it', () => {
    const instance = editor({ imageTransform: geometry, width: 1e308 });
    expect(instance.view.dom.querySelector<HTMLElement>('[data-dm-image-viewport]')?.style.width).toBe('1000000px');
    const surface = document.createElement('div'); surface.innerHTML = instance.getHTML();
    expect(surface.querySelector<HTMLElement>('[data-dm-image-viewport]')?.style.width).toBe('1000000px');
    expect(instance.state.doc.firstChild?.attrs['width']).toBe(1e308);
  });
  it('resizes the occupied viewport while retaining crop and image pixel proportions', () => {
    const instance = editor({ imageTransform: geometry, width: 120 });
    const viewport = instance.view.dom.querySelector<HTMLElement>('[data-dm-image-viewport]')!;
    Object.defineProperty(viewport, 'offsetWidth', { get: () => Number.parseFloat(viewport.style.width) });
    const img = instance.view.dom.querySelector('img')!;
    instance.view.dom.querySelector('.dm-image-handle-se')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }));
    expect(viewport.style.width).toBe('160px');
    expect(img.style.width).toBe('200%');
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(instance.state.doc.firstChild?.attrs).toMatchObject({ width: 160, imageTransform: geometry });
  });
  it('keeps the selected crop viewport after a click that would otherwise create a gap cursor', () => {
    const instance = editor({ imageTransform: geometry });
    const viewport = instance.view.dom.querySelector<HTMLElement>('[data-dm-image-viewport]')!;
    const host = instance.view.dom.parentElement!;
    document.body.appendChild(host);
    vi.spyOn(instance.view, 'posAtCoords').mockReturnValue({ pos: 0, inside: -1 });
    try {
      viewport.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
      viewport.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 1, clientY: 1 }));
      expect(instance.state.selection).toBeInstanceOf(NodeSelection);
      expect(instance.view.dom.querySelector('.dm-image-resizable')?.classList.contains('ProseMirror-selectednode')).toBe(true);
    } finally { host.remove(); }
  });
});
