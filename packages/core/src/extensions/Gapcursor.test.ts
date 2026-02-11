import { describe, it, expect } from 'vitest';
import { Gapcursor } from './Gapcursor.js';

describe('Gapcursor', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Gapcursor.name).toBe('gapcursor');
    });

    it('is an extension type', () => {
      expect(Gapcursor.type).toBe('extension');
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns gapcursor plugin', () => {
      const plugins = Gapcursor.config.addProseMirrorPlugins?.call(Gapcursor);
      expect(plugins).toHaveLength(1);
    });
  });
});
