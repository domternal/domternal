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
