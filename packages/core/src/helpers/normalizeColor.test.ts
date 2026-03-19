import { describe, it, expect } from 'vitest';
import { normalizeColor } from './normalizeColor.js';

describe('normalizeColor', () => {
  it('converts rgb(0, 0, 0) to #000000', () => {
    expect(normalizeColor('rgb(0, 0, 0)')).toBe('#000000');
  });

  it('converts rgb(255, 255, 255) to #ffffff', () => {
    expect(normalizeColor('rgb(255, 255, 255)')).toBe('#ffffff');
  });

  it('converts rgb(37, 99, 235) to #2563eb', () => {
    expect(normalizeColor('rgb(37, 99, 235)')).toBe('#2563eb');
  });

  it('converts rgba with alpha to hex (ignores alpha)', () => {
    expect(normalizeColor('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
  });

  it('handles rgb without spaces', () => {
    expect(normalizeColor('rgb(10,20,30)')).toBe('#0a141e');
  });

  it('handles rgb with extra spaces', () => {
    expect(normalizeColor('rgb(  10 ,  20 ,  30 )')).toBe('#0a141e');
  });

  it('returns hex strings unchanged', () => {
    expect(normalizeColor('#ff6600')).toBe('#ff6600');
  });

  it('returns named colors unchanged', () => {
    expect(normalizeColor('red')).toBe('red');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeColor('')).toBe('');
  });

  it('pads single-digit hex values', () => {
    expect(normalizeColor('rgb(1, 2, 3)')).toBe('#010203');
  });
});
