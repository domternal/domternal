import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, Heading, Editor } from '@domternal/core';
import { clampToContent } from './clampCoords.js';

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
    extensions: [Document, Text, Paragraph, Heading],
    content: html,
  });
  return editor;
}

function stubChildRect(child: Element, rect: Partial<DOMRect>): void {
  const full: DOMRect = {
    top: 100,
    left: 200,
    right: 600,
    bottom: 200,
    width: 400,
    height: 100,
    x: 200,
    y: 100,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  Object.defineProperty(child, 'getBoundingClientRect', {
    value: () => full,
    configurable: true,
  });
}

describe('clampToContent', () => {
  it('returns null when the view DOM has no element children', () => {
    const ed = makeEditor('<p>One</p>');
    // Force the empty-children case by stripping firstElementChild.
    Object.defineProperty(ed.view.dom, 'firstElementChild', { value: null, configurable: true });
    Object.defineProperty(ed.view.dom, 'lastElementChild', { value: null, configurable: true });
    expect(clampToContent(ed.view, 0, 0)).toBeNull();
  });

  it('clamps Y above first block to first.top + inset', () => {
    const ed = makeEditor('<p>One</p><p>Two</p>');
    const first = ed.view.dom.firstElementChild!;
    const last = ed.view.dom.lastElementChild!;
    stubChildRect(first, { top: 100, bottom: 130, left: 200, right: 600 });
    stubChildRect(last, { top: 140, bottom: 170, left: 200, right: 600 });
    const out = clampToContent(ed.view, 400, 50, 5);
    expect(out?.y).toBe(105);
  });

  it('clamps Y below last block to last.bottom - inset', () => {
    const ed = makeEditor('<p>One</p><p>Two</p>');
    const first = ed.view.dom.firstElementChild!;
    const last = ed.view.dom.lastElementChild!;
    stubChildRect(first, { top: 100, bottom: 130, left: 200, right: 600 });
    stubChildRect(last, { top: 140, bottom: 170, left: 200, right: 600 });
    const out = clampToContent(ed.view, 400, 999, 5);
    expect(out?.y).toBe(165);
  });

  it('clamps X left of content to first.left + inset', () => {
    const ed = makeEditor('<p>One</p>');
    const first = ed.view.dom.firstElementChild!;
    stubChildRect(first, { top: 100, bottom: 130, left: 200, right: 600 });
    const out = clampToContent(ed.view, 50, 110, 5);
    expect(out?.x).toBe(205);
  });

  it('clamps X right of content to first.right - inset', () => {
    const ed = makeEditor('<p>One</p>');
    const first = ed.view.dom.firstElementChild!;
    stubChildRect(first, { top: 100, bottom: 130, left: 200, right: 600 });
    const out = clampToContent(ed.view, 999, 110, 5);
    expect(out?.x).toBe(595);
  });

  it('passes through coords already inside the rect', () => {
    const ed = makeEditor('<p>One</p>');
    const first = ed.view.dom.firstElementChild!;
    stubChildRect(first, { top: 100, bottom: 130, left: 200, right: 600 });
    const out = clampToContent(ed.view, 400, 110, 5);
    expect(out).toEqual({ x: 400, y: 110 });
  });
});
