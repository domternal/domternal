import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';
import pkg from '../package.json' with { type: 'json' };

describe('core', () => {
  it('exports a VERSION that matches the published package version', () => {
    // Compared against the manifest rather than a literal. The literal is how
    // this drifted twelve minor releases behind without anything noticing: the
    // test asserted the stale value, so it passed the whole way down.
    expect(VERSION).toBe(pkg.version);
  });
});
