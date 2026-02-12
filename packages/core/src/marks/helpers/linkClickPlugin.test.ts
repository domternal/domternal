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
      attrs: { href: { default: null }, target: { default: null } },
      toDOM: (mark) => ['a', { href: mark.attrs['href'], target: mark.attrs['target'] }, 0],
      parseDOM: [{ tag: 'a[href]' }],
    },
  },
});

function createView(
  content: { text: string; linked?: boolean; href?: string; target?: string },
  pluginOptions?: any
): EditorView {
  const plugin = linkClickPlugin({
    type: schema.marks.link,
    ...pluginOptions,
  });

  let textNode;
  if (content.linked) {
    const linkMark = schema.marks.link.create({
      href: content.href ?? 'https://example.com',
      target: content.target ?? null,
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
  document.body.appendChild(container);
  return new EditorView(container, { state });
}

function findLinkElement(view: EditorView): HTMLAnchorElement | null {
  return view.dom.querySelector('a');
}

function mockClickEvent(opts: {
  target?: EventTarget | null;
  button?: number;
} = {}): MouseEvent {
  const event = new MouseEvent('click', {
    button: opts.button ?? 0,
    bubbles: true,
  });
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target });
  }
  return event;
}

describe('linkClickPlugin', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    if (view) {
      const container = view.dom.parentElement;
      view.destroy();
      container?.remove();
    }
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
    it('opens link on plain click when editable', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      expect(link).not.toBeNull();

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      const result = handler(view, 2, event);
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com',
        '_blank'
      );
    });

    it('returns false when openOnClick is false', () => {
      view = createView(
        { text: 'click me', linked: true },
        { openOnClick: false }
      );
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when clicking on non-linked text', () => {
      view = createView({ text: 'plain text', linked: false });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const textEl = view.dom.querySelector('p')!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: textEl });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when link has no href', () => {
      const plugin = linkClickPlugin({ type: schema.marks.link });
      const linkMark = schema.marks.link.create({ href: null });
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('no href', [linkMark]),
        ]),
      ]);

      const state = EditorState.create({ schema, doc, plugins: [plugin] });
      const container = document.createElement('div');
      document.body.appendChild(container);
      view = new EditorView(container, { state });

      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view);
      const target = link ?? view.dom.querySelector('p')!;

      const foundPlugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = foundPlugin!.props.handleClick as any;
      const event = mockClickEvent({ target });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false for right-click', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link, button: 2 });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('returns false when target is null', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: null });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('uses target attribute from link mark', () => {
      view = createView({ text: 'click me', linked: true, target: '_self' });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      const result = handler(view, 2, event);
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com',
        '_self'
      );
    });

    it('defaults to _blank when no target set', () => {
      view = createView({ text: 'click me', linked: true });
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      handler(view, 2, event);
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com',
        '_blank'
      );
    });

    it('selects full link range when enableClickSelection is true', () => {
      view = createView(
        { text: 'click me', linked: true },
        { enableClickSelection: true, openOnClick: false }
      );
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      const result = handler(view, 2, event);
      expect(result).toBe(true);
      expect(openSpy).not.toHaveBeenCalled();

      // Selection should span the full link text "click me" (pos 1-9)
      const { from, to } = view.state.selection;
      expect(to - from).toBe('click me'.length);
    });

    it('does not select when enableClickSelection is false', () => {
      view = createView(
        { text: 'click me', linked: true },
        { enableClickSelection: false, openOnClick: false }
      );

      const link = findLinkElement(view)!;
      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkClickPluginKey
      );

      const handler = plugin!.props.handleClick as any;
      const event = mockClickEvent({ target: link });

      const result = handler(view, 2, event);
      expect(result).toBe(false);
    });
  });
});
