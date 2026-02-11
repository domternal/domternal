import { describe, it, expect, afterEach } from 'vitest';
import { linkPastePlugin, linkPastePluginKey } from './linkPastePlugin.js';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

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

      // Check that text was inserted with link mark
      const docText = view.state.doc.textContent;
      expect(docText).toContain('https://example.com');

      // Check link mark exists
      let hasLink = false;
      view.state.doc.descendants((node) => {
        if (node.isText && node.text?.includes('https://example.com')) {
          const linkMark = node.marks.find(
            (m) => m.type === schema.marks.link
          );
          if (linkMark) hasLink = true;
        }
      });
      expect(hasLink).toBe(true);
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
