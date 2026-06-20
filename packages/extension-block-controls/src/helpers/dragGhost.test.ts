import { describe, it, expect, afterEach } from 'vitest';
import { createDragGhost } from './dragGhost.js';

let createdWrappers: HTMLElement[] = [];

afterEach(() => {
  for (const w of createdWrappers) w.remove();
  createdWrappers = [];
});

function track(el: HTMLElement): HTMLElement {
  createdWrappers.push(el);
  return el;
}

function makeSource(): HTMLElement {
  const div = document.createElement('div');
  div.textContent = 'Drag me';
  div.style.color = 'rgb(10, 20, 30)';
  div.style.padding = '8px';
  document.body.appendChild(div);
  Object.defineProperty(div, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0, width: 200, height: 30, toJSON: () => ({}) }),
    configurable: true,
  });
  return div;
}

describe('createDragGhost', () => {
  it('appends the wrapper to document.body off-screen', () => {
    const source = makeSource();
    const { wrapper } = { wrapper: track(createDragGhost(source).wrapper) };

    expect(wrapper.parentElement).toBe(document.body);
    expect(wrapper.style.position).toBe('absolute');
    expect(wrapper.style.top).toBe('-10000px');
    expect(wrapper.style.left).toBe('-10000px');
    expect(wrapper.style.pointerEvents).toBe('none');

    source.remove();
  });

  it('marks the wrapper aria-hidden so AT skips it', () => {
    const source = makeSource();
    const { wrapper } = createDragGhost(source);
    track(wrapper);

    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    source.remove();
  });

  it('matches wrapper width to source bounding-rect width', () => {
    const source = makeSource();
    const { wrapper } = createDragGhost(source);
    track(wrapper);

    expect(wrapper.style.width).toBe('200px');
    source.remove();
  });

  it('contains a deep clone of the source as its only child', () => {
    const source = makeSource();
    source.appendChild(document.createElement('span')).textContent = 'inner';
    const { wrapper } = createDragGhost(source);
    track(wrapper);

    expect(wrapper.children.length).toBe(1);
    const clone = wrapper.firstElementChild as HTMLElement;
    expect(clone.tagName).toBe('DIV');
    expect(clone.textContent).toContain('Drag me');
    expect(clone.querySelector('span')?.textContent).toBe('inner');

    source.remove();
  });

  it('preserves descendant structure on the clone (deep clone)', () => {
    const source = makeSource();
    const inner = document.createElement('em');
    inner.textContent = 'i';
    source.appendChild(inner);
    const span = document.createElement('span');
    span.textContent = 'x';
    inner.appendChild(span);

    const { wrapper } = createDragGhost(source);
    track(wrapper);
    const clonedInner = wrapper.querySelector('em');
    const clonedSpan = wrapper.querySelector('span');

    expect(clonedInner).not.toBeNull();
    expect(clonedSpan).not.toBeNull();
    expect(clonedInner?.textContent).toBe('ix');
    expect(clonedSpan?.textContent).toBe('x');
    source.remove();
  });

  it('handles non-HTMLElement child nodes (text nodes) without throwing', () => {
    const source = makeSource();
    source.appendChild(document.createTextNode('plain text'));
    source.appendChild(document.createElement('span'));

    expect(() => track(createDragGhost(source).wrapper)).not.toThrow();
    source.remove();
  });

  it('does not mutate the source element', () => {
    const source = makeSource();
    const before = source.outerHTML;
    track(createDragGhost(source).wrapper);

    expect(source.outerHTML).toBe(before);
    source.remove();
  });
});
