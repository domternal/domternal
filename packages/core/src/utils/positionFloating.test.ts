import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { positionFloating, positionFloatingOnce } from './positionFloating.js';

describe('positionFloating', () => {
  let reference: HTMLElement;
  let floating: HTMLElement;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    reference = document.createElement('div');
    reference.getBoundingClientRect = () => new DOMRect(100, 100, 50, 30);
    document.body.appendChild(reference);

    floating = document.createElement('div');
    floating.style.position = 'fixed';
    document.body.appendChild(floating);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    reference.remove();
    floating.remove();
  });

  it('returns a cleanup function', () => {
    cleanup = positionFloating(reference, floating);
    expect(typeof cleanup).toBe('function');
  });

  it('applies default placement (bottom)', () => {
    cleanup = positionFloating(reference, floating);
    expect(cleanup).toBeDefined();
  });

  it('accepts custom placement', () => {
    cleanup = positionFloating(reference, floating, { placement: 'top' });
    expect(cleanup).toBeDefined();
  });

  it('accepts custom offset', () => {
    cleanup = positionFloating(reference, floating, { offsetValue: 10 });
    expect(cleanup).toBeDefined();
  });

  it('accepts custom padding', () => {
    cleanup = positionFloating(reference, floating, { padding: 20 });
    expect(cleanup).toBeDefined();
  });

  it('accepts trackScroll=false', () => {
    cleanup = positionFloating(reference, floating, { trackScroll: false });
    expect(cleanup).toBeDefined();
  });

  it('accepts virtual reference object', () => {
    const virtualRef = {
      getBoundingClientRect: () => new DOMRect(200, 200, 0, 20),
    };
    cleanup = positionFloating(virtualRef, floating);
    expect(cleanup).toBeDefined();
  });

  it('cleanup function can be called without errors', () => {
    cleanup = positionFloating(reference, floating);
    expect(() => { cleanup!(); }).not.toThrow();
    cleanup = null;
  });
});

describe('positionFloatingOnce', () => {
  let reference: HTMLElement;
  let floating: HTMLElement;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    reference = document.createElement('div');
    reference.getBoundingClientRect = () => new DOMRect(100, 100, 50, 30);
    document.body.appendChild(reference);

    floating = document.createElement('div');
    floating.style.position = 'absolute';
    document.body.appendChild(floating);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    reference.remove();
    floating.remove();
  });

  it('returns a cleanup function', () => {
    cleanup = positionFloatingOnce(reference, floating);
    expect(typeof cleanup).toBe('function');
  });

  it('accepts all options', () => {
    cleanup = positionFloatingOnce(reference, floating, {
      placement: 'top-start',
      offsetValue: 8,
      padding: 16,
      trackScroll: true,
    });
    expect(cleanup).toBeDefined();
  });

  it('accepts trackScroll=false', () => {
    cleanup = positionFloatingOnce(reference, floating, { trackScroll: false });
    expect(cleanup).toBeDefined();
  });

  it('cleanup function can be called', () => {
    cleanup = positionFloatingOnce(reference, floating);
    expect(() => { cleanup!(); }).not.toThrow();
    cleanup = null;
  });

  it('handles virtual reference', () => {
    const virtualRef = {
      getBoundingClientRect: () => new DOMRect(50, 50, 0, 20),
    };
    cleanup = positionFloatingOnce(virtualRef, floating);
    expect(cleanup).toBeDefined();
  });
});

describe('constrainHeight', () => {
  let reference: HTMLElement;
  let floating: HTMLElement;
  let cleanup: (() => void) | null = null;

  // computePosition resolves through microtasks; one macrotask settles it.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

  beforeEach(() => {
    reference = document.createElement('div');
    reference.getBoundingClientRect = () => new DOMRect(100, 100, 50, 30);
    document.body.appendChild(reference);

    floating = document.createElement('div');
    floating.style.position = 'absolute';
    document.body.appendChild(floating);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    reference.remove();
    floating.remove();
  });

  it('leaves --dm-available-height unset without the option', async () => {
    cleanup = positionFloatingOnce(reference, floating);
    await settle();
    expect(floating.style.getPropertyValue('--dm-available-height')).toBe('');
  });

  it('writes --dm-available-height honoring the minHeight floor', async () => {
    cleanup = positionFloatingOnce(reference, floating, {
      placement: 'bottom-start',
      constrainHeight: { minHeight: 160 },
    });
    await settle();
    const value = floating.style.getPropertyValue('--dm-available-height');
    expect(value).toMatch(/^\d+px$/);
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(160);
  });

  it('supports placements without an alignment', async () => {
    cleanup = positionFloatingOnce(reference, floating, {
      placement: 'bottom',
      constrainHeight: { minHeight: 120 },
    });
    await settle();
    const value = floating.style.getPropertyValue('--dm-available-height');
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(120);
  });

  it('supports top placements', async () => {
    cleanup = positionFloatingOnce(reference, floating, {
      placement: 'top-start',
      constrainHeight: { minHeight: 100 },
    });
    await settle();
    const value = floating.style.getPropertyValue('--dm-available-height');
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(100);
  });

  it('works with the fixed-strategy positionFloating as well', async () => {
    floating.style.position = 'fixed';
    cleanup = positionFloating(reference, floating, {
      constrainHeight: { minHeight: 160 },
    });
    await settle();
    const value = floating.style.getPropertyValue('--dm-available-height');
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(160);
  });

  it('respects a custom boundary element', async () => {
    const boundary = document.createElement('div');
    document.body.appendChild(boundary);
    cleanup = positionFloatingOnce(reference, floating, {
      boundary,
      constrainHeight: { minHeight: 140 },
    });
    await settle();
    const value = floating.style.getPropertyValue('--dm-available-height');
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(140);
    boundary.remove();
  });
});
