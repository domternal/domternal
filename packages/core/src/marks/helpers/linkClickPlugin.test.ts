import { describe, it, expect, vi, afterEach } from 'vitest';
import { linkClickPlugin, linkClickPluginKey } from './linkClickPlugin.js';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
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
  content: { text: string; linked?: boolean; href?: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pluginOptions?: any
) {
  const plugin = linkClickPlugin({
    type: schema.marks.link,
    ...pluginOptions,
  });

  let textNode;
  if (content.linked) {
    const linkMark = schema.marks.link.create({
      href: content.href ?? 'https://example.com',
    });
    textNode = schema.text(content.text, [linkMark]);
  } else {
    textNode = schema.text(content.text);
  }

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [textNode]),
  ]);

  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  const container = document.createElement('div');
  return new EditorView(container, { state });
}

function mockClickEvent(opts: {
  metaKey?: boolean;
  ctrlKey?: boolean;
} = {}): MouseEvent {
  const event = new MouseEvent('click', {
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
  });
  vi.spyOn(event, 'preventDefault');
  return event;
}

describe('linkClickPlugin', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    vi.restoreAllMocks();
  });

  describe('plugin creation', () => {
    it('creates a plugin', () => {
      const plugin = linkClickPlugin({ type: schema.marks.link });
      expect(plugin).toBeDefined();
    });

    it('uses linkClickPluginKey', () => {
      expect(linkClickPluginKey).toBeDefined();
    });

    it('has handleClick prop', () => {
      const plugin = linkClickPlugin({ type: schema.marks.link });
      expect(plugin.props.handleClick).toBeDefined();
    });
  });

  describe('handleClick', () => {
    it('opens link on Mod+click when editable', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ metaKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com',
        '_blank',
        'noopener,noreferrer'
      );
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('does not open link on plain click when editable', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent();

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when openOnClick is false', () => {
      view = createView(
        { text: 'click me', linked: true },
        { openOnClick: false }
      );
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ metaKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false for whenNotEditable when editor is editable', () => {
      view = createView(
        { text: 'click me', linked: true },
        { openOnClick: 'whenNotEditable' }
      );
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ metaKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when clicking on non-linked text', () => {
      view = createView({ text: 'plain text', linked: false });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ metaKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when link has no href', () => {
      // Create link with no href
      const plugin = linkClickPlugin({ type: schema.marks.link });
      const linkMark = schema.marks.link.create({ href: null });
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('no href', [linkMark]),
        ]),
      ]);

      const state = EditorState.create({ schema, doc, plugins: [plugin] });
      const container = document.createElement('div');
      view = new EditorView(container, { state });

      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const foundPlugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = foundPlugin!.props.handleClick as any;
      const event = mockClickEvent({ metaKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('opens link on Ctrl+click', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ ctrlKey: true });

      const result = handler(view, 2, event);
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalled();
    });
  });
});
