import { describe, it, expect } from 'vitest';
import {
  resolveGutterBias,
  isInGutter,
  gutterBiasWeight,
} from './gutterBias.js';
import type { GutterBiasConfig, GutterEdge } from './gutterBias.js';

const RECT = {
  top: 100,
  left: 200,
  right: 600,
  bottom: 300,
} as DOMRect;

describe('resolveGutterBias', () => {
  it('returns null for false / undefined / "none"', () => {
    expect(resolveGutterBias(false)).toBeNull();
    expect(resolveGutterBias(undefined)).toBeNull();
    expect(resolveGutterBias('none')).toBeNull();
  });

  it('returns default config for true / "left"', () => {
    const expected = { edges: ['left', 'top'], threshold: 12, strength: 500 };
    expect(resolveGutterBias(true)).toEqual(expected);
    expect(resolveGutterBias('left')).toEqual(expected);
  });

  it('mirrors to right edge with "right" preset', () => {
    expect(resolveGutterBias('right')).toEqual({
      edges: ['right', 'top'],
      threshold: 12,
      strength: 500,
    });
  });

  it('covers both horizontal edges with "both"', () => {
    expect(resolveGutterBias('both')).toEqual({
      edges: ['left', 'right', 'top'],
      threshold: 12,
      strength: 500,
    });
  });

  it('merges partial config over defaults', () => {
    expect(resolveGutterBias({ threshold: 24 })).toEqual({
      edges: ['left', 'top'],
      threshold: 24,
      strength: 500,
    });
    expect(resolveGutterBias({ strength: 100, edges: ['bottom'] })).toEqual({
      edges: ['bottom'],
      threshold: 12,
      strength: 100,
    });
  });
});

describe('isInGutter', () => {
  const base: GutterBiasConfig = { edges: ['left', 'top'], threshold: 12, strength: 500 };
  const withEdges = (edges: GutterEdge[]): GutterBiasConfig => ({ ...base, edges });

  it('true within threshold of left edge', () => {
    expect(isInGutter(205, 200, RECT, withEdges(['left']))).toBe(true);
    expect(isInGutter(212, 200, RECT, withEdges(['left']))).toBe(true);
    expect(isInGutter(213, 200, RECT, withEdges(['left']))).toBe(false);
  });

  it('true within threshold of top edge', () => {
    expect(isInGutter(400, 105, RECT, withEdges(['top']))).toBe(true);
    expect(isInGutter(400, 113, RECT, withEdges(['top']))).toBe(false);
  });

  it('right and bottom edges work symmetrically', () => {
    expect(isInGutter(595, 200, RECT, withEdges(['right']))).toBe(true);
    expect(isInGutter(587, 200, RECT, withEdges(['right']))).toBe(false);
    expect(isInGutter(400, 295, RECT, withEdges(['bottom']))).toBe(true);
    expect(isInGutter(400, 287, RECT, withEdges(['bottom']))).toBe(false);
  });

  it('returns false when no configured edges', () => {
    expect(isInGutter(200, 100, RECT, withEdges([]))).toBe(false);
  });
});

describe('gutterBiasWeight', () => {
  const cfg: GutterBiasConfig = { edges: ['left'], threshold: 12, strength: 500 };

  it('linear in depth: strength * depth when in gutter', () => {
    expect(gutterBiasWeight(205, 200, RECT, 1, cfg)).toBe(500);
    expect(gutterBiasWeight(205, 200, RECT, 2, cfg)).toBe(1000);
    expect(gutterBiasWeight(205, 200, RECT, 3, cfg)).toBe(1500);
  });

  it('zero when not in gutter', () => {
    expect(gutterBiasWeight(400, 200, RECT, 5, cfg)).toBe(0);
  });
});
