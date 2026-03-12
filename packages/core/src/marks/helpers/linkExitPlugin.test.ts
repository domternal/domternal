import { describe, it, expect, afterEach } from 'vitest';
import { linkExitPlugin, linkExitPluginKey } from './linkExitPlugin.js';
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
      inclusive: false,
      toDOM: (mark) => ['a', { href: mark.attrs['href'] }, 0],
      parseDOM: [{ tag: 'a[href]' }],
    },
    bold: {
      toDOM: () => ['strong', 0],
      parseDOM: [{ tag: 'strong' }],
    },
  },
});

function createView(
  nodes: { text: string; linked?: boolean; href?: string }[]
): EditorView {
  const plugin = linkExitPlugin({ type: schema.marks.link });

  const inlineNodes = nodes.map((n) => {
    if (n.linked) {
      const linkMark = schema.marks.link.create({
        href: n.href ?? 'https://example.com',
      });
      return schema.text(n.text, [linkMark]);
    }
    return schema.text(n.text);
  });

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, inlineNodes),
  ]);

  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView(container, { state });
}

function setCursorAt(view: EditorView, pos: number): void {
  const tr = view.state.tr.setSelection(
    TextSelection.create(view.state.doc, pos)
  );
  view.dispatch(tr);
}

function simulateArrowRight(view: EditorView): boolean {
  const plugin = view.state.plugins.find(
    (p) => p.spec.key === linkExitPluginKey
  );
  const handler = plugin!.props.handleKeyDown as (
    view: EditorView,
    event: KeyboardEvent
  ) => boolean;
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
  return handler(view, event);
}

describe('linkExitPlugin', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    if (view) {
      const container = view.dom.parentElement;
      view.destroy();
      container?.remove();
    }
  });

  describe('plugin creation', () => {
    it('creates a plugin', () => {
      const plugin = linkExitPlugin({ type: schema.marks.link });
      expect(plugin).toBeDefined();
    });

    it('uses linkExitPluginKey', () => {
      expect(linkExitPluginKey).toBeDefined();
    });

    it('has handleKeyDown prop', () => {
      const plugin = linkExitPlugin({ type: schema.marks.link });
      expect(plugin.props.handleKeyDown).toBeDefined();
    });
  });

  describe('handleKeyDown', () => {
    it('strips link from storedMarks at end of link', () => {
      // "hello" is linked, cursor at end of "hello" (pos 6)
      view = createView([{ text: 'hello', linked: true }]);
      setCursorAt(view, 6); // end of "hello" (after last char)

      const result = simulateArrowRight(view);
      expect(result).toBe(false); // doesn't prevent default

      // storedMarks should be set without the link mark
      const stored = view.state.storedMarks;
      expect(stored).not.toBeNull();
      expect(stored!.some((m) => m.type === schema.marks.link)).toBe(false);
    });

    it('strips link from storedMarks at boundary between linked and unlinked text', () => {
      // "hello" is linked, " world" is not linked
      view = createView([
        { text: 'hello', linked: true },
        { text: ' world', linked: false },
      ]);
      setCursorAt(view, 6); // end of "hello", before " world"

      simulateArrowRight(view);

      const stored = view.state.storedMarks;
      expect(stored).not.toBeNull();
      expect(stored!.some((m) => m.type === schema.marks.link)).toBe(false);
    });

    it('does nothing when cursor is in the middle of a link', () => {
      view = createView([{ text: 'hello', linked: true }]);
      setCursorAt(view, 3); // middle of "hello"

      simulateArrowRight(view);

      // storedMarks should NOT be set (cursor is still inside the link)
      const stored = view.state.storedMarks;
      expect(stored).toBeNull();
    });

    it('does nothing when cursor is not in a link', () => {
      view = createView([{ text: 'hello', linked: false }]);
      setCursorAt(view, 3);

      simulateArrowRight(view);

      const stored = view.state.storedMarks;
      expect(stored).toBeNull();
    });

    it('ignores non-ArrowRight keys', () => {
      view = createView([{ text: 'hello', linked: true }]);
      setCursorAt(view, 6);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === linkExitPluginKey
      );
      const handler = plugin!.props.handleKeyDown as (
        view: EditorView,
        event: KeyboardEvent
      ) => boolean;
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
      const result = handler(view, event);
      expect(result).toBe(false);

      const stored = view.state.storedMarks;
      expect(stored).toBeNull();
    });

    it('ignores non-empty selections', () => {
      view = createView([{ text: 'hello', linked: true }]);
      // Set a range selection instead of cursor
      const tr = view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, 4)
      );
      view.dispatch(tr);

      simulateArrowRight(view);

      const stored = view.state.storedMarks;
      expect(stored).toBeNull();
    });

    it('preserves other marks when stripping link', () => {
      // Create text with both link and bold marks
      const linkMark = schema.marks.link.create({ href: 'https://example.com' });
      const boldMark = schema.marks.bold.create();
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('hello', [boldMark, linkMark]),
        ]),
      ]);

      const plugin = linkExitPlugin({ type: schema.marks.link });
      const state = EditorState.create({ schema, doc, plugins: [plugin] });
      const container = document.createElement('div');
      document.body.appendChild(container);
      view = new EditorView(container, { state });

      setCursorAt(view, 6); // end of "hello"
      simulateArrowRight(view);

      const stored = view.state.storedMarks;
      expect(stored).not.toBeNull();
      expect(stored!.some((m) => m.type === schema.marks.link)).toBe(false);
      expect(stored!.some((m) => m.type === schema.marks.bold)).toBe(true);
    });

    it('always returns false (never prevents default)', () => {
      view = createView([{ text: 'hello', linked: true }]);

      // At boundary
      setCursorAt(view, 6);
      expect(simulateArrowRight(view)).toBe(false);

      // In middle
      setCursorAt(view, 3);
      expect(simulateArrowRight(view)).toBe(false);

      // On unlinked text
      view.destroy();
      view.dom.parentElement?.remove();
      view = createView([{ text: 'hello', linked: false }]);
      setCursorAt(view, 3);
      expect(simulateArrowRight(view)).toBe(false);
    });
  });
});
