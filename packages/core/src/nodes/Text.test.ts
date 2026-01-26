import { describe, it, expect } from 'vitest';
import { Text } from './Text.js';

describe('Text', () => {
  it('has correct name', () => {
    expect(Text.name).toBe('text');
  });

  it('is a node type', () => {
    expect(Text.type).toBe('node');
  });

  it('belongs to inline group', () => {
    expect(Text.config.group).toBe('inline');
  });

  it('creates correct NodeSpec', () => {
    const spec = Text.createNodeSpec();

    expect(spec.group).toBe('inline');
  });
});
