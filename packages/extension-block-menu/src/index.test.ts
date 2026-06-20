import { describe, it, expect } from 'vitest';
import * as shim from './index.js';
import * as controls from '@domternal/extension-block-controls';

// The shim must forward the entire extension-block-controls surface unchanged,
// so existing `@domternal/extension-block-menu` imports keep resolving.
describe('extension-block-menu shim', () => {
  it('re-exports the full extension-block-controls surface', () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(controls).sort());
  });

  it('forwards the same binding for a representative export', () => {
    expect(shim.BlockHandle).toBe(controls.BlockHandle);
  });
});
