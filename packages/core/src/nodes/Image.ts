/**
 * Image Node
 *
 * Block-level image element.
 * Supports src, alt, title, width, height attributes.
 * Includes XSS protection for URL validation.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';

export interface ImageOptions {
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
}

export const Image = Node.create<ImageOptions>({
  name: 'image',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return {
      allowBase64: false,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('src'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['src']) return {};
          return { src: attributes['src'] as string };
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['alt']) return {};
          return { alt: attributes['alt'] as string };
        },
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['title']) return {};
          return { title: attributes['title'] as string };
        },
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('width'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['width']) return {};
          return { width: attributes['width'] as string };
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('height'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['height']) return {};
          return { height: attributes['height'] as string };
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
        (attributes?: Record<string, unknown>) =>
        ({ commands }) => {
          const cmds = commands as Record<
            string,
            (content: { type: string; attrs?: Record<string, unknown> }) => boolean
          >;
          const content = attributes
            ? { type: self.name, attrs: attributes }
            : { type: self.name };
          return cmds['insertContent']?.(content) ?? false;
        },
    };
  },
});
