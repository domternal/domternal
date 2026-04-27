import { describe, it, expect } from 'vitest';
import {
  normalizeEdgeDetection,
  isNearEdge,
  calculateEdgeDeduction,
} from './edgeDetection.js';

const RECT = {
  top: 100,
  left: 200,
  right: 600,
  bottom: 300,
} as DOMRect;

describe('normalizeEdgeDetection', () => {
  it('returns null for false / undefined / "none"', () => {
    expect(normalizeEdgeDetection(false)).toBeNull();
    expect(normalizeEdgeDetection(undefined)).toBeNull();
    expect(normalizeEdgeDetection('none')).toBeNull();
  });

  it('returns Tiptap defaults for true / "left"', () => {
    const a = normalizeEdgeDetection(true);
    const b = normalizeEdgeDetection('left');
    const expected = { edges: ['left', 'top'], threshold: 12, strength: 500 };
    expect(a).toEqual(expected);
    expect(b).toEqual(expected);
  });

  it('mirrors to right edge with "right" preset', () => {
    expect(normalizeEdgeDetection('right')).toEqual({
      edges: ['right', 'top'],
      threshold: 12,
      strength: 500,
    });
  });

  it('covers both horizontal edges with "both"', () => {
    expect(normalizeEdgeDetection('both')).toEqual({
      edges: ['left', 'right', 'top'],
      threshold: 12,
      strength: 500,
    });
  });

  it('merges partial config over defaults', () => {
    expect(normalizeEdgeDetection({ threshold: 24 })).toEqual({
      edges: ['left', 'top'],
      threshold: 24,
      strength: 500,
    });
    expect(normalizeEdgeDetection({ strength: 100, edges: ['bottom'] })).toEqual({
      edges: ['bottom'],
      threshold: 12,
      strength: 100,
    });
  });
});

describe('isNearEdge', () => {
  const cfg: { edges: ('left' | 'right' | 'top' | 'bottom')[]; threshold: number; strength: number } = { edges: ['left', 'top'], threshold: 12, strength: 500 };

  it('true within threshold of left edge', () => {
    expect(isNearEdge(205, 200, RECT, { ...cfg, edges: ['left'] })).toBe(true);
    expect(isNearEdge(212, 200, RECT, { ...cfg, edges: ['left'] })).toBe(true);
    expect(isNearEdge(213, 200, RECT, { ...cfg, edges: ['left'] })).toBe(false);
  });

  it('true within threshold of top edge', () => {
    expect(isNearEdge(400, 105, RECT, { ...cfg, edges: ['top'] })).toBe(true);
    expect(isNearEdge(400, 113, RECT, { ...cfg, edges: ['top'] })).toBe(false);
  });

  it('right and bottom edges work symmetrically', () => {
    expect(isNearEdge(595, 200, RECT, { ...cfg, edges: ['right'] })).toBe(true);
    expect(isNearEdge(587, 200, RECT, { ...cfg, edges: ['right'] })).toBe(false);
    expect(isNearEdge(400, 295, RECT, { ...cfg, edges: ['bottom'] })).toBe(true);
    expect(isNearEdge(400, 287, RECT, { ...cfg, edges: ['bottom'] })).toBe(false);
  });

  it('returns false when no configured edges', () => {
    expect(isNearEdge(200, 100, RECT, { ...cfg, edges: [] })).toBe(false);
  });
});

describe('calculateEdgeDeduction', () => {
  const cfg: { edges: ('left' | 'right' | 'top' | 'bottom')[]; threshold: number; strength: number } = { edges: ['left'], threshold: 12, strength: 500 };

  it('linear in depth: strength * depth when near edge', () => {
    expect(calculateEdgeDeduction(205, 200, RECT, 1, cfg)).toBe(500);
    expect(calculateEdgeDeduction(205, 200, RECT, 2, cfg)).toBe(1000);
    expect(calculateEdgeDeduction(205, 200, RECT, 3, cfg)).toBe(1500);
  });

  it('zero when not near any configured edge', () => {
    expect(calculateEdgeDeduction(400, 200, RECT, 5, cfg)).toBe(0);
  });
});
