import { describe, it, expect } from 'vitest';
import { TrailingNode } from './TrailingNode.js';

describe('TrailingNode', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TrailingNode.name).toBe('trailingNode');
    });

    it('is an extension type', () => {
      expect(TrailingNode.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = TrailingNode.config.addOptions?.call(TrailingNode);
      expect(opts).toEqual({ node: 'paragraph', notAfter: ['paragraph'] });
    });

    it('can configure node type', () => {
      const custom = TrailingNode.configure({ node: 'heading' });
      expect(custom.options.node).toBe('heading');
    });

    it('can configure notAfter', () => {
      const custom = TrailingNode.configure({
        notAfter: ['paragraph', 'heading'],
      });
      expect(custom.options.notAfter).toEqual(['paragraph', 'heading']);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns trailing node plugin', () => {
      const plugins = TrailingNode.config.addProseMirrorPlugins?.call(
        TrailingNode
      );
      expect(plugins).toHaveLength(1);
    });
  });
});
