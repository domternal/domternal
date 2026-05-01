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
import { findBestDragTarget } from './findBestDragTarget.js';
import { DEFAULT_DRAG_HANDLE_RULES } from './defaultRules.js';

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
 * position regardless of jsdom's incomplete layout. Stubs `nodeDOM` for
 * the resolved positions so `getBoundingClientRect` returns the rect
 * we want.
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

const RECT = (top: number, left: number, height: number, width: number): DOMRect => ({
  top, left, right: left + width, bottom: top + height,
  x: left, y: top, width, height, toJSON: () => ({}),
} as DOMRect);

describe('findBestDragTarget - Notion mode (no edge promotion)', () => {
  it('returns the deepest list item under the cursor', () => {
    const ed = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    // posAtCoords stub points inside the first paragraph's text.
    // PM positions for `<ul><li><p>One</p></li>...`: 0=before ul, 1=before li,
    // 2=before p, 3=text "O". $pos.before(d) → 0/1/2 at depths 1/2/3.
    stubViewLayout(ed, 3, new Map([
      [0, RECT(100, 200, 200, 400)],   // bulletList
      [1, RECT(105, 220, 30, 380)],    // first listItem
      [2, RECT(105, 240, 30, 360)],    // first paragraph
    ]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: DEFAULT_DRAG_HANDLE_RULES,
      edgeConfig: null,
      allowedNodeTypes: ['listItem'],
    });
    expect(out?.node.type.name).toBe('listItem');
  });

  it('falls through to top-level when no allowed type matches', () => {
    const ed = makeEditor('<p>Hello</p>');
    stubViewLayout(ed, 1, new Map([[0, RECT(100, 200, 50, 400)]]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: DEFAULT_DRAG_HANDLE_RULES,
      edgeConfig: null,
      allowedNodeTypes: ['listItem'], // paragraph is NOT allowed
    });
    expect(out).toBeNull();
  });

  it('honours allowedContainers (only resolve inside named ancestor)', () => {
    const ed = makeEditor('<p>Outside</p>');
    stubViewLayout(ed, 1, new Map([[0, RECT(100, 200, 50, 400)]]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: [],
      edgeConfig: null,
      allowedNodeTypes: ['paragraph'],
      allowedContainers: ['blockquote'], // paragraph is not inside a blockquote
    });
    expect(out).toBeNull();
  });
});

describe('findBestDragTarget - Tiptap mode (edge promotion)', () => {
  it('promotes deeper item to shallower ancestor near left edge', () => {
    // Cursor at left edge of the listItem AND its parent bulletList.
    // Without edge promotion: deepest listItem wins.
    // With promotion (strength 500 * depth):
    //   listItem (depth 2) deduction = 1000 → score = 0 → excluded
    //   bulletList (depth 1) deduction = 500  → score = 500 (default rule
    //     `listWrapperDeprioritize` excludes it, so net candidates empty)
    // But for the assertion we instead allow `paragraph` as the second
    // candidate type - it's at depth 3 with deduction 1500 → also excluded.
    // The cleanest test: with rules disabled, edge promotion picks the
    // shallowest near-edge candidate.
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, RECT(100, 200, 200, 400)],   // bulletList (depth 1)
      [1, RECT(105, 200, 30, 380)],    // listItem (depth 2) - same left edge
      [2, RECT(105, 200, 30, 360)],    // paragraph (depth 3) - same left edge
    ]));
    // Cursor RIGHT AT left edge of all three (200, 110).
    const out = findBestDragTarget(ed.view, 200, 110, {
      rules: [], // disable defaults so we see only edge-promotion math
      edgeConfig: { edges: ['left'], threshold: 12, strength: 500 },
      allowedNodeTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    // Depth 1 deduction = 500 → score = 500. Depth 2 = 1000 → 0 (excluded).
    // Depth 3 = 1500 → -500 (excluded). bulletList wins.
    expect(out?.node.type.name).toBe('bulletList');
  });

  it('keeps deepest match when cursor is far from any edge', () => {
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, RECT(100, 200, 200, 400)],
      [1, RECT(105, 220, 30, 380)],
      [2, RECT(105, 240, 30, 360)],
    ]));
    // Cursor centered in paragraph rect; no edge in range.
    const out = findBestDragTarget(ed.view, 400, 120, {
      rules: [],
      edgeConfig: { edges: ['left'], threshold: 12, strength: 500 },
      allowedNodeTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    expect(out?.node.type.name).toBe('paragraph');
  });
});

describe('findBestDragTarget - edge cases', () => {
  it('returns null when posAtCoords returns null', () => {
    const ed = makeEditor('<p>Hi</p>');
    const view = ed.view as unknown as {
      posAtCoords: () => null;
    };
    view.posAtCoords = (): null => null;
    const out = findBestDragTarget(ed.view, 0, 0, {
      rules: DEFAULT_DRAG_HANDLE_RULES,
      edgeConfig: null,
      allowedNodeTypes: ['paragraph'],
    });
    expect(out).toBeNull();
  });

  it('default rules exclude inline / text nodes from being targets', () => {
    const ed = makeEditor('<p>Hello</p>');
    stubViewLayout(ed, 1, new Map([[0, RECT(100, 200, 30, 400)]]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: DEFAULT_DRAG_HANDLE_RULES,
      edgeConfig: null,
      allowedNodeTypes: ['paragraph', 'text'],
    });
    // text excluded by `inlineContent` rule; paragraph wins.
    expect(out?.node.type.name).toBe('paragraph');
  });

  // ── allowedContainers + atom-leaf path coverage ─────────────────────────

  it('honours allowedContainers when ancestor matches (positive case)', () => {
    // Paragraph inside a blockquote; allowedContainers requires `blockquote`
    // ancestor. The matching ancestor is found, so the paragraph is selected.
    const ed = makeEditor('<blockquote><p>Quoted</p></blockquote>');
    // Doc structure: doc(0) > blockquote(1) > p(2) > text(3).
    stubViewLayout(ed, 3, new Map([
      [0, RECT(100, 200, 50, 400)],
      [1, RECT(100, 200, 50, 400)],
    ]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: [],
      edgeConfig: null,
      allowedNodeTypes: ['paragraph'],
      allowedContainers: ['blockquote'],
    });
    expect(out?.node.type.name).toBe('paragraph');
  });

  it('returns null when allowedContainers list is provided but no matching ancestor exists', () => {
    // Paragraph at document root; allowedContainers requires `blockquote`
    // ancestor that doesn't exist - no candidate qualifies.
    const ed = makeEditor('<p>Top level</p>');
    stubViewLayout(ed, 1, new Map([[0, RECT(100, 200, 50, 400)]]));
    const out = findBestDragTarget(ed.view, 250, 110, {
      rules: [],
      edgeConfig: null,
      allowedNodeTypes: ['paragraph'],
      allowedContainers: ['blockquote'],
    });
    expect(out).toBeNull();
  });

  it('synthesises a candidate for atom block (horizontal rule) at $pos.nodeAfter', () => {
    // Cursor lands at the position before <hr>. PM resolves no ancestor
    // for it - the only way to surface the handle is the atom-leaf
    // fallback that synthesises a candidate at depth + 1.
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    // Find the doc position right before the horizontalRule node.
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    expect(hrPos).toBeGreaterThan(-1);
    stubViewLayout(ed, hrPos, new Map([
      [hrPos, RECT(120, 200, 5, 400)],
    ]));
    const out = findBestDragTarget(ed.view, 300, 122, {
      rules: [],
      edgeConfig: null,
      allowedNodeTypes: ['horizontalRule'],
    });
    expect(out?.node.type.name).toBe('horizontalRule');
  });

  it('atom-leaf fallback respects edge deduction (still returns null when zeroed)', () => {
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    stubViewLayout(ed, hrPos, new Map([
      [hrPos, RECT(120, 200, 5, 400)],
    ]));
    const out = findBestDragTarget(ed.view, 200, 122, {
      rules: [],
      edgeConfig: { edges: ['left'], threshold: 12, strength: 10000 },
      allowedNodeTypes: ['horizontalRule'],
    });
    expect(out).toBeNull();
  });

  it('atom-leaf fallback skips when allowedNodeTypes excludes the atom', () => {
    const ed = makeEditor('<p>Before</p><hr><p>After</p>');
    let hrPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule' && hrPos === -1) hrPos = pos;
      return true;
    });
    stubViewLayout(ed, hrPos, new Map([
      [hrPos, RECT(120, 200, 5, 400)],
    ]));
    const out = findBestDragTarget(ed.view, 300, 122, {
      rules: [],
      edgeConfig: null,
      allowedNodeTypes: ['paragraph'], // hr is not in allowed types
    });
    expect(out).toBeNull();
  });

  it('returns null when edge deduction zeros every candidate (Mode C fallthrough)', () => {
    // Reproduces the BlockHandle resolveBlockAtCoords "Mode C fallthrough"
    // path: an edge config strict enough (huge `strength`) to push every
    // candidate below zero. The resolver MUST return null so the caller
    // can fall back to the top-level resolution path. Without this guard,
    // the resolver would silently pick a sub-zero candidate and the drag
    // handle would anchor on something the user didn't intend.
    const ed = makeEditor('<ul><li><p>One</p></li></ul>');
    stubViewLayout(ed, 3, new Map([
      [0, RECT(100, 200, 200, 400)],
      [1, RECT(105, 200, 30, 380)],
      [2, RECT(105, 200, 30, 360)],
    ]));
    const out = findBestDragTarget(ed.view, 200, 110, {
      rules: [],
      // strength 10000 * any depth >> BASE_SCORE → every candidate scores < 0.
      edgeConfig: { edges: ['left'], threshold: 12, strength: 10000 },
      allowedNodeTypes: ['bulletList', 'listItem', 'paragraph'],
    });
    expect(out).toBeNull();
  });
});
