import { describe, it, expect, afterEach, vi } from 'vitest';
import { linkPastePlugin, linkPastePluginKey } from './linkPastePlugin.js';
import { DOMParser, Schema } from '@domternal/pm/model';
import { registerClipboardImageDestination } from '../../clipboard.js';
import { EditorState, TextSelection } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    link: {
      attrs: { href: { default: null } },
      toDOM: (mark) => ['a', { href: mark.attrs['href'] }, 0],
      parseDOM: [{ tag: 'a[href]' }],
    },
  },
});

function createView(
  text: string,
   
  pluginOptions?: any
): EditorView {
  const plugin = linkPastePlugin({
    type: schema.marks.link,
    ...pluginOptions,
  });

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : []),
  ]);

  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  const container = document.createElement('div');
  return new EditorView(container, { state });
}

function mockPasteEvent(text: string): ClipboardEvent {
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as DataTransfer;

  return { clipboardData } as ClipboardEvent;
}

describe('linkPastePlugin', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
  });

  describe('plugin creation', () => {
    it('creates a plugin', () => {
      const plugin = linkPastePlugin({ type: schema.marks.link });
      expect(plugin).toBeDefined();
    });

    it('uses linkPastePluginKey', () => {
      expect(linkPastePluginKey).toBeDefined();
    });

    it('has handlePaste prop', () => {
      const plugin = linkPastePlugin({ type: schema.marks.link });
      expect(plugin.props.handlePaste).toBeDefined();
    });
  });

  describe('handlePaste', () => {
    it('inserts pasted URL as linked text when no selection', () => {
      view = createView('hello ');

      // Place cursor at end
      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('https://example.com');

      const result = handler(view, event);
      expect(result).toBe(true);

      expect(view.state.doc.toJSON()).toEqual({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'https://example.com', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        }],
      });
    });

    it('wraps selected text in link when URL is pasted', () => {
      view = createView('click here to visit');

      // Select "click here"
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 1, 11)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('https://example.com');

      const result = handler(view, event);
      expect(result).toBe(true);

      // Original text should still be there
      expect(view.state.doc.textContent).toContain('click here');

      // Check that the selected text now has a link mark
      const $pos = view.state.doc.resolve(2);
      const linkMark = $pos.marks().find((m) => m.type === schema.marks.link);
      expect(linkMark).toBeDefined();
      expect(linkMark?.attrs['href']).toBe('https://example.com');
    });

    it('returns false for non-URL paste', () => {
      view = createView('hello');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('just plain text');

      const result = handler(view, event);
      expect(result).toBe(false);
    });

    it('returns false for empty clipboard', () => {
      view = createView('hello');

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('');

      const result = handler(view, event);
      expect(result).toBe(false);
    });

    it('returns false for disallowed protocol', () => {
      view = createView('hello');

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('ftp://files.example.com');

      const result = handler(view, event);
      expect(result).toBe(false);
    });

    it('respects custom validate callback', () => {
      view?.destroy();
      view = createView('hello', {
        validate: (url: string) => !url.includes('blocked'),
      });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('https://blocked.com');

      const result = handler(view, event);
      expect(result).toBe(false);
    });

    it('allows custom protocols', () => {
      view?.destroy();
      view = createView('hello', { protocols: ['http:', 'https:', 'ftp:'] });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = mockPasteEvent('ftp://files.example.com');

      const result = handler(view, event);
      expect(result).toBe(true);
    });

    it('returns false when clipboardData is null', () => {
      view = createView('hello');

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkPastePluginKey
      );
       
      const handler = plugin!.props.handlePaste as any;
      const event = { clipboardData: null } as ClipboardEvent;

      const result = handler(view, event);
      expect(result).toBe(false);
    });
  });
});

describe('linkPastePlugin with clipboard image files', () => {
  let view: EditorView | undefined;
  afterEach(() => { view?.destroy(); view = undefined; });

  const imageSchema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      photo: { group: 'block', atom: true, attrs: { src: { default: null }, alt: { default: null } }, toDOM: () => ['img'], parseDOM: [{ tag: 'img' }] },
      text: { group: 'inline' },
    },
    marks: { link: { attrs: { href: { default: null } }, toDOM: mark => ['a', { href: mark.attrs['href'] as string }, 0], parseDOM: [{ tag: 'a[href]' }] } },
  });
  const URL_TEXT = 'https://example.com/picture.png';
  const file = new File(['bytes'], 'picture.png', { type: 'image/png' });

  function mount(insertFiles?: () => boolean): { view: EditorView; dispose: () => void } {
    const plugin = linkPastePlugin({ type: imageSchema.marks.link });
    const doc = imageSchema.node('doc', null, [imageSchema.node('paragraph')]);
    const created = new EditorView(document.createElement('div'), { state: EditorState.create({ schema: imageSchema, doc, plugins: [plugin] }) });
    view = created;
    const dispose = registerClipboardImageDestination(created, () => ({
      nodeTypeName: 'photo', sourceAttribute: 'src', inline: false, allowEmbedded: true,
      allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: 'test:1',
    }), insertFiles);
    return { view: created, dispose };
  }

  function paste(target: EditorView, html: string): boolean {
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: {
      types: html === '' ? ['text/plain', 'Files'] : ['text/html', 'text/plain', 'Files'], files: [file],
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      getData: (type: string) => (type === 'text/plain' ? URL_TEXT : type === 'text/html' ? html : ''),
    } });
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const slice = html === '' ? DOMParser.fromSchema(imageSchema).parseSlice(Object.assign(document.createElement('div'), { textContent: URL_TEXT }))
      : DOMParser.fromSchema(imageSchema).parseSlice(holder);
    return target.someProp('handlePaste', f => f(target, event, slice)) === true;
  }

  it('gives way to the image file when the HTML holds only the image the URL addresses', () => {
    const insert = vi.fn(() => true);
    const { view: target } = mount(insert);

    expect(paste(target, `<meta charset="utf-8"><img src="${URL_TEXT}">`)).toBe(true);

    expect(insert).toHaveBeenCalledExactlyOnceWith({ files: [file] });
    expect(target.state.doc.textContent).toBe('');
  });

  it('links the URL when the HTML has text of its own, when there is no HTML, or when no destination takes the file', () => {
    for (const [html, insertFiles] of [[`<p>See ${URL_TEXT}</p>`, () => true], ['', () => true], [`<img src="${URL_TEXT}">`, () => false]] as const) {
      const { view: target, dispose } = mount(insertFiles);
      expect(paste(target, html)).toBe(true);
      expect(target.state.doc.textContent).toBe(URL_TEXT);
      dispose();
      target.destroy();
    }
  });
});
