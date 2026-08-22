import { describe, it, expect, afterEach } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  ListItem,
  HorizontalRule,
  Editor,
} from '@domternal/core';
import { resolveDragTarget } from './resolveDragTarget.js';
import { DEFAULT_BLOCK_MATCHERS } from './defaultMatchers.js';

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

function makeEditor(html: string): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, Heading, Blockquote, BulletList, ListItem, HorizontalRule],
    content: html,
  });
  return editor;
}

/**
 * Stub `view.posAtCoords` so the resolver lands on a deterministic
 * position regardless of jsdom's incomplete layout, plus `nodeDOM` so
 * `getBoundingClientRect` returns a specific rect for each PM position.
 */
function stubViewLayout(
  ed: Editor,
  pos: number,
  rectsByPos: Map<number, DOMRect>,
): void {
  const view = ed.view as unknown as {
    posAtCoords: (c: { left: number; top: number }) => { pos: number; inside: number };
    nodeDOM: (pos: number) => HTMLElement | null;
  };
  view.posAtCoords = () => ({ pos, inside: pos });

  const origNodeDOM = ed.view.nodeDOM.bind(ed.view);
  view.nodeDOM = (p: number): HTMLElement | null => {
    const rect = rectsByPos.get(p);
    const dom = origNodeDOM(p);
    if (dom instanceof HTMLElement && rect) {
      Object.defineProperty(dom, 'getBoundingClientRect', {
        value: () => rect,
        configurable: true,
      });
    }
    return dom as HTMLElement | null;
  };
}

const rect = (top: number, left: number, height: number, width: number): DOMRect => ({
  top, left, right: left + width, bottom: top + height,
  x: left, y: top, width, height, toJSON: () => ({}),
});

describe('resolveDragTarget - deepest-match mode (no gutter bias)', () => {
  it('returns the deepest list item under the cursor', () => {
    const ed = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, rect(100, 200, 200, 400)],   // bulletList
      [1, rect(105, 220, 30, 380)],    // first listItem
      [2, rect(105, 240, 30, 360)],    // first paragraph
    ]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: DEFAULT_BLOCK_MATCHERS,
      gutterBias: null,
      allowedTypes: ['listItem'],
    });
    expect(out?.node.type.name).toBe('listItem');
  });

  it('returns null when no allowed type matches', () => {
    const ed = makeEditor('<p>Hello</p>');
    stubViewLayout(ed, 1, new Map([[0, rect(100, 200, 50, 400)]]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: DEFAULT_BLOCK_MATCHERS,
      gutterBias: null,
      allowedTypes: ['listItem'], // paragraph is NOT allowed
    });
    expect(out).toBeNull();
  });

  it('honours requiredAncestorTypes (only resolve inside named ancestor)', () => {
    const ed = makeEditor('<p>Outside</p>');
    stubViewLayout(ed, 1, new Map([[0, rect(100, 200, 50, 400)]]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: [],
      gutterBias: null,
      allowedTypes: ['paragraph'],
      requiredAncestorTypes: ['blockquote'],
    });
    expect(out).toBeNull();
  });
});

describe('resolveDragTarget - gutter-bias mode', () => {
  it('promotes deeper candidates to shallower ancestor near left edge', () => {
    // Cursor at left edge of every ancestor. With matchers disabled and
    // gutter penalty = strength * depth, the depth-1 ancestor has the
    // smallest penalty so its post-bias rank is highest.
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, rect(100, 200, 200, 400)],   // bulletList (depth 1)
      [1, rect(105, 200, 30, 380)],    // listItem (depth 2)
      [2, rect(105, 200, 30, 360)],    // paragraph (depth 3)
    ]));
    const out = resolveDragTarget(ed.view, 200, 110, {
      matchers: [],
      gutterBias: { edges: ['left'], threshold: 12, strength: 500 },
      allowedTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    expect(out?.node.type.name).toBe('bulletList');
  });

  it('keeps deepest match when cursor is away from any gutter edge', () => {
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, rect(100, 200, 200, 400)],
      [1, rect(105, 220, 30, 380)],
      [2, rect(105, 240, 30, 360)],
    ]));
    const out = resolveDragTarget(ed.view, 400, 120, {
      matchers: [],
      gutterBias: { edges: ['left'], threshold: 12, strength: 500 },
      allowedTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    expect(out?.node.type.name).toBe('paragraph');
  });
});

describe('resolveDragTarget - edge cases', () => {
  it('returns null when posAtCoords returns null', () => {
    const ed = makeEditor('<p>Hi</p>');
    const view = ed.view as unknown as { posAtCoords: () => null };
    view.posAtCoords = (): null => null;
    const out = resolveDragTarget(ed.view, 0, 0, {
      matchers: DEFAULT_BLOCK_MATCHERS,
      gutterBias: null,
      allowedTypes: ['paragraph'],
    });
    expect(out).toBeNull();
  });

  it('default matchers reject inline / text nodes', () => {
    const ed = makeEditor('<p>Hello</p>');
    stubViewLayout(ed, 1, new Map([[0, rect(100, 200, 30, 400)]]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: DEFAULT_BLOCK_MATCHERS,
      gutterBias: null,
      allowedTypes: ['paragraph', 'text'],
    });
    expect(out?.node.type.name).toBe('paragraph');
  });

  it('honours requiredAncestorTypes when ancestor matches (positive case)', () => {
    const ed = makeEditor('<blockquote><p>Quoted</p></blockquote>');
    stubViewLayout(ed, 3, new Map([
      [0, rect(100, 200, 50, 400)],
      [1, rect(100, 200, 50, 400)],
    ]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: [],
      gutterBias: null,
      allowedTypes: ['paragraph'],
      requiredAncestorTypes: ['blockquote'],
    });
    expect(out?.node.type.name).toBe('paragraph');
  });

  it('returns null when requiredAncestorTypes has no match', () => {
    const ed = makeEditor('<p>Top level</p>');
    stubViewLayout(ed, 1, new Map([[0, rect(100, 200, 50, 400)]]));
    const out = resolveDragTarget(ed.view, 250, 110, {
      matchers: [],
      gutterBias: null,
      allowedTypes: ['paragraph'],
      requiredAncestorTypes: ['blockquote'],
    });
    expect(out).toBeNull();
  });

  it('synthesises a candidate for atom block (horizontal rule) at $pos.nodeAfter', () => {
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    expect(hrPos).toBeGreaterThan(-1);
    stubViewLayout(ed, hrPos, new Map([[hrPos, rect(120, 200, 5, 400)]]));
    const out = resolveDragTarget(ed.view, 300, 122, {
      matchers: [],
      gutterBias: null,
      allowedTypes: ['horizontalRule'],
    });
    expect(out?.node.type.name).toBe('horizontalRule');
  });

  it('atom-leaf fallback honours gutter bias rank (still picks the candidate)', () => {
    // Atom-leaf is the only candidate; gutter bias just lowers its rank,
    // it still wins.
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    stubViewLayout(ed, hrPos, new Map([[hrPos, rect(120, 200, 5, 400)]]));
    const out = resolveDragTarget(ed.view, 200, 122, {
      matchers: [],
      gutterBias: { edges: ['left'], threshold: 12, strength: 10000 },
      allowedTypes: ['horizontalRule'],
    });
    expect(out?.node.type.name).toBe('horizontalRule');
  });

  it('atom-leaf fallback skips when allowedTypes excludes the atom', () => {
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    stubViewLayout(ed, hrPos, new Map([[hrPos, rect(120, 200, 5, 400)]]));
    const out = resolveDragTarget(ed.view, 300, 122, {
      matchers: [],
      gutterBias: null,
      allowedTypes: ['paragraph'], // hr is not in allowed types
    });
    expect(out).toBeNull();
  });

  it('extreme gutter strength always promotes to the shallowest in-gutter candidate', () => {
    // The bias formula is `depth - strength * depth`. Even at extreme
    // strength values the shallowest candidate keeps the highest (least-
    // negative) rank, so it still wins. Callers wanting "no target" in
    // this case should narrow `allowedTypes` instead.
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, rect(100, 200, 200, 400)],
      [1, rect(105, 200, 30, 380)],
      [2, rect(105, 200, 30, 360)],
    ]));
    const out = resolveDragTarget(ed.view, 200, 110, {
      matchers: [],
      gutterBias: { edges: ['left'], threshold: 12, strength: 10000 },
      allowedTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    expect(out?.node.type.name).toBe('bulletList');
  });
});
