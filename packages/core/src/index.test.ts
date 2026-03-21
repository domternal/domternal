import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';

describe('core', () => {
  it('should export VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
