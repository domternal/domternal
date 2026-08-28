import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bold,
  BulletList,
  Document,
  Editor,
  ListItem,
  Node,
  Paragraph,
  Text,
  getClipboardImageDestination,
  registerClipboardImageDestination,
  setClipboardPasteBehavior,
} from '@domternal/core';
import { Slice } from '@domternal/pm/model';
import { Image } from './Image.js';
import type { ImageOptions } from './Image.js';

const table = Node.create({
  name: 'table', group: 'block', content: 'tableRow+', isolating: true,
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: () => ['table', ['tbody', 0]],
});
const tableRow = Node.create({
  name: 'tableRow', content: 'tableCell+',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0],
});
const tableCell = Node.create({
  name: 'tableCell', content: 'block+', isolating: true,
  parseHTML: () => [{ tag: 'td' }],
  renderHTML: () => ['td', 0],
});

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.restoreAllMocks();
});

function mount(uploadHandler: ((file: File) => Promise<string>) | null): Editor {
  editor = new Editor({
    extensions: [
      Document, Text, Paragraph, Bold, BulletList, ListItem,
      table, tableRow, tableCell, Image.configure({ uploadHandler }),
    ],
    content: '<p></p>',
  });
  editor.commands.selectAll();
  return editor;
}

function pasteWithImage(target: Editor, html: string, text = '', assetsAlreadyHandled = false): File {
  const file = new File(['image bytes'], 'clipboard.png', { type: 'image/png' });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '',
    },
  });
  if (assetsAlreadyHandled) setClipboardPasteBehavior(target.view, event as ClipboardEvent, { assetsAlreadyHandled: true });
  target.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return file;
}

describe.each(['base64', 'upload'] as const)('image paste ownership in %s mode', mode => {
  it('yields immediately for coordinated assets without reading clipboard files or uploading', () => {
    const upload = vi.fn(() => Promise.resolve('/uploaded.png'));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    const clipboard = vi.fn(() => { throw new Error('Handled assets must not reread the clipboard'); });
    Object.defineProperty(event, 'clipboardData', { get: clipboard });
    setClipboardPasteBehavior(instance.view, event, { assetsAlreadyHandled: true, preserveOrderedListStart: true });
    const handlers = instance.state.plugins.filter(plugin => plugin.props.handlePaste !== undefined && plugin.props.handleDrop !== undefined);
    expect(handlers).toHaveLength(mode === 'upload' ? 2 : 1);
    const state = instance.state;
    for (const plugin of handlers) expect(plugin.props.handlePaste?.call(plugin, instance.view, event, Slice.empty)).toBe(false);
    expect(instance.state).toBe(state);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboard).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a coordinated image-only HTML placement instead of starting another file insertion', () => {
    const upload = vi.fn(() => Promise.resolve('/uploaded.png'));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);
    const html = '<img src="/prepared.png" alt="Prepared">';
    pasteWithImage(instance, html, '', true);
    expect(instance.getHTML()).toBe(html);
    expect(instance.view.dom.querySelectorAll('img')).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: 'formatted paragraphs',
      html: '<p>Before <strong>formatted</strong> after</p><img src="/embedded.png" alt="Embedded">',
    },
    {
      kind: 'lists',
      html: '<ul><li><p>First</p></li><li><p>Second</p><img src="/embedded.png" alt="Embedded"></li></ul>',
    },
    {
      kind: 'tables',
      html: '<table><tbody><tr><td><p>Cell</p><img src="/embedded.png" alt="Embedded"></td><td><p>Other cell</p></td></tr></tbody></table>',
    },
  ])('preserves $kind when clipboard files accompany rich content', ({ html }) => {
    const upload = vi.fn(() => new Promise<string>(() => undefined));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);

    pasteWithImage(instance, html);

    expect(upload).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(instance.getHTML()).toBe(html);
    expect(instance.view.dom.querySelectorAll('img')).toHaveLength(1);
    expect(() => { instance.state.doc.check(); }).not.toThrow();
  });

  it('preserves plain text when a file accompanies it', () => {
    const upload = vi.fn(() => new Promise<string>(() => undefined));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);

    pasteWithImage(instance, '', 'Clipboard text');

    expect(upload).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(instance.getHTML()).toBe('<p>Clipboard text</p>');
  });

  it.each([
    { kind: 'a screenshot without HTML', html: '' },
    {
      kind: 'an image with alt text and empty wrappers',
      html: '<img src="/copied.png" alt="Descriptive image"><p> \u00a0 </p>',
    },
  ])('keeps file insertion for $kind', async ({ html }) => {
    const upload = vi.fn().mockResolvedValue('/uploaded.png');
    const instance = mount(mode === 'upload' ? upload : null);

    const file = pasteWithImage(instance, html);

    await vi.waitFor(() => {
      const images = instance.view.dom.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute('src')).toMatch(
        mode === 'upload' ? /^\/uploaded\.png$/ : /^data:image\/png;base64,/,
      );
    });
    if (mode === 'upload') expect(upload).toHaveBeenCalledExactlyOnceWith(file);
    else expect(upload).not.toHaveBeenCalled();
  });
});

describe('built-in Image clipboard destination registration', () => {
  it('registers its actual policy through the plugin view and removes it on destruction', () => {
    const instance = mount(null);
    const view = instance.view;
    const policy = getClipboardImageDestination(view);
    expect(policy).toEqual({
      nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
      allowedMimeTypes: Image.options.allowedMimeTypes, maxFileBytes: Number.MAX_SAFE_INTEGER,
      policyVersion: 'builtin:1',
    });
    expect(getClipboardImageDestination(view)).not.toBe(policy);
    instance.destroy();
    editor = undefined;
    expect(getClipboardImageDestination(view)).toBeUndefined();
  });

  it('reads live options, including replacement of the editor-owned options object', () => {
    const instance = mount(null);
    const bound = instance.extensionManager.extensions.find(extension => extension.name === 'image') as Node<ImageOptions> | undefined;
    expect(bound).toBeDefined();
    if (bound === undefined) return;
    Object.defineProperty(bound, 'options', {
      value: { ...bound.options, allowBase64: false, maxFileSize: 512, allowedMimeTypes: ['image/jpeg'] },
    });
    expect(getClipboardImageDestination(instance.view)).toMatchObject({
      allowEmbedded: false, maxFileBytes: 512, allowedMimeTypes: ['image/jpeg'],
    });
    bound.options.maxFileSize = 1024;
    expect(getClipboardImageDestination(instance.view)?.maxFileBytes).toBe(1024);
  });

  it('registers configured inline and embedded-image settings independently of upload callbacks', () => {
    const upload = vi.fn(() => Promise.resolve('/uploaded.png'));
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image.configure({ inline: true, allowBase64: false, maxFileSize: 99, uploadHandler: upload })],
      content: '<p></p>',
    });
    expect(getClipboardImageDestination(editor.view)).toMatchObject({ inline: true, allowEmbedded: false, maxFileBytes: 99 });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports actual schema inline semantics after a live option changes', () => {
    const instance = mount(null);
    const bound = instance.extensionManager.extensions.find(extension => extension.name === 'image') as Node<ImageOptions> | undefined;
    if (bound === undefined) throw new Error('Expected bound image extension');
    bound.options.inline = true;
    expect(instance.schema.nodes['image']?.isInline).toBe(false);
    expect(getClipboardImageDestination(instance.view)?.inline).toBe(false);
  });

  it.each([
    { mode: 'replacement', initial: false, enabled: true },
    { mode: 'replacement', initial: true, enabled: false },
    { mode: 'in-place', initial: false, enabled: true },
    { mode: 'in-place', initial: true, enabled: false },
  ] as const)('keeps real data-image parsing aligned after $mode from $initial to $enabled', ({ mode, initial, enabled }) => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image.configure({ allowBase64: initial })], content: '<p></p>',
    });
    const bound = editor.extensionManager.extensions.find(extension => extension.name === 'image') as Node<ImageOptions> | undefined;
    if (bound === undefined) throw new Error('Expected bound image extension');
    if (mode === 'replacement') Object.defineProperty(bound, 'options', { value: { ...bound.options, allowBase64: enabled } });
    else bound.options.allowBase64 = enabled;
    expect(getClipboardImageDestination(editor.view)?.allowEmbedded).toBe(enabled);
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
    editor.commands.selectAll();
    pasteWithImage(editor, `<img src="${src}" alt="Prepared">`, '', true);
    const images: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs['src']); });
    expect(images).toEqual([enabled ? src : null]);
    if (enabled) expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(src);
    else expect(editor.view.dom.querySelector('img')?.getAttribute('src')).not.toBe(src);
  });

  it('disposes its capability when plugin views are removed, preserving a newer explicit registration', () => {
    const instance = mount(null);
    const explicit = {
      nodeTypeName: 'custom', sourceAttribute: 'url', inline: false, allowEmbedded: false,
      allowedMimeTypes: ['image/png'], maxFileBytes: 256, policyVersion: 'host:1',
    };
    const dispose = registerClipboardImageDestination(instance.view, () => explicit);
    instance.view.updateState(instance.state.reconfigure({ plugins: [] }));
    expect(instance.view.isDestroyed).toBe(false);
    expect(getClipboardImageDestination(instance.view)).toBe(explicit);
    dispose();
    expect(getClipboardImageDestination(instance.view)).toBeUndefined();
  });

  it('does not infer a capability from a different node named image', () => {
    const otherImage = Node.create({
      name: 'image', group: 'block', atom: true,
      addAttributes: () => ({ src: { default: null } }),
      parseHTML: () => [{ tag: 'img[src]' }], renderHTML: () => ['img'],
    });
    editor = new Editor({ extensions: [Document, Text, Paragraph, otherImage], content: '<p></p>' });
    expect(editor.schema.nodes['image']).toBeDefined();
    expect(getClipboardImageDestination(editor.view)).toBeUndefined();
  });
});
