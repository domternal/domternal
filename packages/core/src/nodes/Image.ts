/**
 * Image Node
 *
 * Block or inline image element.
 * Supports src, alt, title, width, height attributes.
 * Includes XSS protection for URL validation.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';

export interface ImageOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
}

export const Image = Node.create<ImageOptions>({
  name: 'image',
  draggable: true,
  atom: true,

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
    };
  },

  inline() {
    const self = this as unknown as NodeClass<ImageOptions>;
    return self.options.inline;
  },

  group() {
    const self = this as unknown as NodeClass<ImageOptions>;
    return self.options.inline ? 'inline' : 'block';
  },

  addAttributes() {
    const self = this as unknown as NodeClass<ImageOptions>;
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('src'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['src']) return {};
          return { src: attributes['src'] };
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['alt']) return {};
          return { alt: attributes['alt'] };
        },
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['title']) return {};
          return { title: attributes['title'] };
        },
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('width'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['width']) return {};
          return { width: attributes['width'] };
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('height'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['height']) return {};
          return { height: attributes['height'] };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const self = this as unknown as NodeClass<ImageOptions>;
    const src = node.attrs['src'] as string | null;

    // XSS protection: validate URL format
    if (src) {
      const isValidUrl = self.options.allowBase64
        ? /^(https?:\/\/|data:image\/)/.test(src)
        : /^https?:\/\//.test(src);

      if (!isValidUrl) {
        // Return empty image if URL is invalid
        return ['img', { ...self.options.HTMLAttributes, ...HTMLAttributes, src: '' }];
      }
    }

    return ['img', { ...self.options.HTMLAttributes, ...HTMLAttributes }];
  },

  addCommands() {
    const self = this as unknown as NodeClass<ImageOptions>;
    return {
      setImage:
        (attributes?: { src?: string; alt?: string; title?: string; width?: string; height?: string }) =>
        ({ commands }) => {
          const cmds = commands as Record<
            string,
            (content: { type: string; attrs?: Record<string, unknown> }) => boolean
          >;
          return cmds['insertContent']?.({ type: self.name, attrs: attributes }) ?? false;
        },
    };
  },
});
