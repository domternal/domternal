import { describe, it, expect } from 'vitest';
import { buildProseMirrorAttrs, buildHTMLAttributes } from './specBuilder.js';

describe('buildProseMirrorAttrs', () => {
  it('converts attribute specs to ProseMirror attrs with defaults', () => {
    const result = buildProseMirrorAttrs({
      level: { default: 1 },
      id: { default: null },
    });
    expect(result).toEqual({
      level: { default: 1 },
      id: { default: null },
    });
  });

  it('includes validate property when defined', () => {
    const validate = 'string';
    const result = buildProseMirrorAttrs({
      href: { default: null, validate },
    });
    expect(result['href']).toEqual({ default: null, validate: 'string' });
  });

  it('returns empty object for empty specs', () => {
    const result = buildProseMirrorAttrs({});
    expect(result).toEqual({});
  });

  it('preserves undefined default', () => {
    const result = buildProseMirrorAttrs({
      value: { default: undefined },
    });
    expect(result['value']).toEqual({ default: undefined });
  });
});

describe('buildHTMLAttributes', () => {
  it('builds HTML attributes from node attrs using renderHTML', () => {
    const attrs = { level: 2, class: 'heading' };
    const specs = {
      level: {
        default: 1,
        renderHTML: (a: Record<string, unknown>) => ({ 'data-level': a['level'] }),
      },
      class: {
        default: null,
      },
    };
    const result = buildHTMLAttributes(attrs, specs);
    expect(result['data-level']).toBe(2);
    expect(result['class']).toBe('heading');
  });

  it('skips attributes with rendered: false', () => {
    const attrs = { hidden: true, visible: 'yes' };
    const specs = {
      hidden: { default: false, rendered: false as const },
      visible: { default: null },
    };
    const result = buildHTMLAttributes(attrs, specs);
    expect(result['hidden']).toBeUndefined();
    expect(result['visible']).toBe('yes');
  });

  it('skips null and undefined values without renderHTML', () => {
    const attrs = { name: null, value: undefined, active: true };
    const specs = {
      name: { default: null },
      value: { default: undefined },
      active: { default: false },
    };
    const result = buildHTMLAttributes(attrs, specs);
    expect(result['name']).toBeUndefined();
    expect(result['value']).toBeUndefined();
    expect(result['active']).toBe(true);
  });

  it('returns empty object when no attributes match', () => {
    const result = buildHTMLAttributes({}, {});
    expect(result).toEqual({});
  });

  it('handles renderHTML returning null', () => {
    const attrs = { color: 'red' };
    const specs = {
      color: {
        default: null,
        renderHTML: () => null,
      },
    };
    const result = buildHTMLAttributes(attrs, specs);
    expect(result).toEqual({});
  });
});
