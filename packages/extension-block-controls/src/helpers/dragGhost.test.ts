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

  /**
   * The reason this helper exists, and the case the rest of the suite missed:
   * every assertion above passes on a clone that carries no styles at all. The
   * original implementation assigned `getComputedStyle(src).cssText`, which is
   * specified to be the empty string on a computed declaration, so the preview
   * inherited <body> and lost the editor's own colour and type.
   */
  it('freezes resolved paint properties onto the clone', () => {
    const source = makeSource();
    const { wrapper } = createDragGhost(source);
    track(wrapper);
    const clone = wrapper.firstElementChild as HTMLElement;

    expect(clone.style.color).toBe('rgb(10, 20, 30)');
    expect(clone.style.paddingTop).toBe('8px');
    source.remove();
  });

  it('freezes descendants too, so nested marks keep their own styling', () => {
    const source = makeSource();
    const em = document.createElement('em');
    em.textContent = 'emphasis';
    em.style.color = 'rgb(200, 0, 0)';
    em.style.fontWeight = '700';
    source.appendChild(em);

    const { wrapper } = createDragGhost(source);
    track(wrapper);
    const clonedEm = wrapper.querySelector('em');

    expect(clonedEm?.style.color).toBe('rgb(200, 0, 0)');
    expect(clonedEm?.style.fontWeight).toBe('700');
    source.remove();
  });

  it('leaves the root clone without margins, and keeps them on descendants', () => {
    const source = makeSource();
    source.style.marginTop = '24px';
    const inner = document.createElement('p');
    inner.textContent = 'inner';
    inner.style.marginTop = '12px';
    source.appendChild(inner);

    const { wrapper } = createDragGhost(source);
    track(wrapper);
    const clone = wrapper.firstElementChild as HTMLElement;

    // A margin on the root would offset the preview from the cursor inside the
    // wrapper the browser snapshots, and cloneNode carries the source's own
    // inline style over, so it has to be zeroed rather than just not copied.
    expect(clone.style.marginTop).toBe('0px');
    expect(wrapper.querySelector('p')?.style.marginTop).toBe('12px');
    source.remove();
  });
});
