import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, History, Paragraph, Text } from '@domternal/core';
import { NodeSelection } from '@domternal/pm/state';
import { Image, type ImageOptions } from './Image.js';

const editors: Editor[] = [];
// This complete options object also verifies that existing typed configuration still compiles.
const legacyOptions: ImageOptions = {
  inline: false, allowBase64: true, HTMLAttributes: {}, uploadHandler: null,
  allowedMimeTypes: ['image/png'], maxFileSize: 0, maxFiles: 10,
  onUploadStart: null, onUploadError: null, placement: null,
};
const legacyAttrs = {
  src: '/image.png', alt: '', title: null, width: null, height: null,
  loading: null, crossorigin: null, float: 'none', align: 'none',
};
const legacyDoc = { type: 'doc', content: [{ type: 'image', attrs: legacyAttrs }] };
const geometry = { naturalWidth: 400, naturalHeight: 200, rotation: 90 };

function editor(options?: Partial<ImageOptions>): Editor {
  const instance = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, History, options === undefined ? Image : Image.configure(options)],
    content: legacyDoc,
  });
  editors.push(instance);
  instance.view.dispatch(instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, 0)));
  return instance;
}
afterEach(() => { editors.splice(0).forEach(value => { value.destroy(); }); });

describe('image geometry opt-in compatibility', () => {
  it.each([undefined, legacyOptions, { enableTransforms: false }])('keeps the existing schema, JSON and HTML with configuration %j', options => {
    const instance = editor(options);
    expect(instance.schema.nodes['image']?.spec.attrs).not.toHaveProperty('imageTransform');
    expect(instance.getJSON()).toEqual(legacyDoc);
    expect(instance.getHTML()).toBe('<img src="/image.png" alt="">');
    instance.commands.setContent(instance.getHTML());
    expect(instance.getJSON()).toEqual(legacyDoc);
    instance.commands.setContent(instance.getJSON());
    expect(instance.getJSON()).toEqual(legacyDoc);
    expect(instance.view.dom.querySelector('[data-dm-image-viewport]')).toBeNull();
  });

  it('keeps the existing inserted image shape without an opt-in', () => {
    const instance = editor();
    expect(instance.commands.setImage({ src: '/second.png', alt: '' })).toBe(true);
    expect(instance.getJSON()).toEqual({ type: 'doc', content: [{ type: 'image', attrs: { ...legacyAttrs, src: '/second.png' } }] });
    expect(instance.getHTML()).toBe('<img src="/second.png" alt="">');
    expect(instance.commands.undo()).toBe(true);
    expect(instance.getJSON()).toEqual(legacyDoc);
  });

  it.each([null, geometry, { naturalWidth: 400, naturalHeight: 200 }])('refuses explicit geometry %j without an opt-in and never dispatches a change', transform => {
    const instance = editor();
    const dispatch = vi.spyOn(instance.view, 'dispatch');
    expect(instance.can().setImageTransform(transform)).toBe(false);
    expect(instance.commands.setImageTransform(transform)).toBe(false);
    expect(instance.can().setImage({ src: '/second.png', imageTransform: transform })).toBe(false);
    expect(instance.commands.setImage({ src: '/second.png', imageTransform: transform })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(instance.getJSON()).toEqual(legacyDoc);
    expect(instance.commands.undo()).toBe(false);
  });

  it('adds and preserves geometry only when explicitly enabled', () => {
    const instance = editor({ enableTransforms: true });
    expect(instance.schema.nodes['image']?.spec.attrs).toHaveProperty('imageTransform');
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toBeNull();
    expect(instance.commands.setImage({ src: '/second.png', imageTransform: geometry })).toBe(true);
    expect(instance.state.doc.firstChild?.attrs['imageTransform']).toMatchObject(geometry);
    const doc = instance.getJSON();
    instance.commands.setContent(instance.getHTML());
    expect(instance.getJSON()).toEqual(doc);
    expect(instance.view.dom.querySelector('[data-dm-image-viewport]')).not.toBeNull();
  });
});
