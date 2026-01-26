import { describe, it, expect } from 'vitest';
import { Document } from './Document.js';

describe('Document', () => {
  it('has correct name', () => {
    expect(Document.name).toBe('doc');
  });

  it('is a node type', () => {
    expect(Document.type).toBe('node');
  });

  it('is a topNode', () => {
    expect(Document.config.topNode).toBe(true);
  });

  it('requires block+ content', () => {
    expect(Document.config.content).toBe('block+');
  });

  it('creates correct NodeSpec', () => {
    const spec = Document.createNodeSpec();

    expect(spec.content).toBe('block+');
  });
});
