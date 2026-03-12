import { describe, it, expect, afterEach } from 'vitest';
import { autolinkPlugin, autolinkPluginKey } from './autolinkPlugin.js';
import { Schema } from '@domternal/pm/model';
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
  const plugin = autolinkPlugin({
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

describe('autolinkPlugin', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
  });

  describe('plugin creation', () => {
    it('creates a plugin', () => {
      const plugin = autolinkPlugin({ type: schema.marks.link });
      expect(plugin).toBeDefined();
    });

    it('uses autolinkPluginKey', () => {
      expect(autolinkPluginKey).toBeDefined();
    });

    it('has handleTextInput prop', () => {
      const plugin = autolinkPlugin({ type: schema.marks.link });
      expect(plugin.props.handleTextInput).toBeDefined();
    });
  });

  describe('handleTextInput', () => {
    it('auto-links URL followed by space', () => {
      view = createView('https://example.com');

      // Place cursor at end of text
      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(true);
      // Check that link mark was applied
      const $pos = view.state.doc.resolve(2);
      const linkMark = $pos.marks().find((m) => m.type === schema.marks.link);
      expect(linkMark).toBeDefined();
      expect(linkMark?.attrs['href']).toBe('https://example.com');
    });

    it('auto-links www URLs with default protocol', () => {
      view = createView('www.example.com');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(true);
      const $pos = view.state.doc.resolve(2);
      const linkMark = $pos.marks().find((m) => m.type === schema.marks.link);
      expect(linkMark?.attrs['href']).toBe('https://www.example.com');
    });

    it('auto-links bare domain with common TLD', () => {
      view = createView('example.com');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(true);
    });

    it('returns false for non-trigger characters', () => {
      view = createView('https://example.com');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, 'a');

      expect(result).toBe(false);
    });

    it('returns false when text before cursor is not a URL', () => {
      view = createView('just some text');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(false);
    });

    it('returns false when URL does not end right before trigger', () => {
      view = createView('https://example.com and more text');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(false);
    });

    it('rejects URL with disallowed protocol via custom protocols', () => {
      view?.destroy();
      // Only allow ftp: - so https:// URLs should be rejected
      view = createView('https://example.com', {
        protocols: ['ftp:'],
      });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(false);
    });

    it('respects shouldAutoLink callback', () => {
      view = createView('https://spam.com');
      // Recreate with shouldAutoLink
      view.destroy();
      view = createView('https://spam.com', {
        shouldAutoLink: (url: string) => !url.includes('spam'),
      });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(false);
    });

    it('does not re-link already linked text', () => {
      // Create view with already-linked text
      const plugin = autolinkPlugin({ type: schema.marks.link });
      const linkMark = schema.marks.link.create({
        href: 'https://example.com',
      });
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('https://example.com', [linkMark]),
        ]),
      ]);

      const state = EditorState.create({ schema, doc, plugins: [plugin] });
      const container = document.createElement('div');
      view = new EditorView(container, { state });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const foundPlugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = foundPlugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(false);
    });

    it('triggers on punctuation characters', () => {
      view = createView('https://example.com');

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, '.');

      expect(result).toBe(true);
    });

    it('uses custom defaultProtocol', () => {
      view = createView('www.example.com');
      view.destroy();
      view = createView('www.example.com', { defaultProtocol: 'http' });

      const endPos = view.state.doc.child(0).content.size + 1;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos)
        )
      );

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === autolinkPluginKey
      );
       
      const handler = plugin!.props.handleTextInput as any;
      const result = handler(view, endPos, endPos, ' ');

      expect(result).toBe(true);
      const $pos = view.state.doc.resolve(2);
      const mark = $pos.marks().find((m) => m.type === schema.marks.link);
      expect(mark?.attrs['href']).toBe('http://www.example.com');
    });
  });
});
