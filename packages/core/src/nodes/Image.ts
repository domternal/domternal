/**
 * Image Node
 *
 * Block-level image element.
 * Supports src, alt, title, width, height attributes.
 *
 * XSS Protection:
 * - Schema-level validation rejects javascript:, data: (unless allowBase64), and other dangerous URLs
 * - Only allows http://, https://, and optionally data:image/ URLs
 * - Double-checked in renderHTML as defense in depth
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';

/**
 * Validates image src URL for XSS protection.
 * Allows: http://, https://, and optionally data:image/
 * Blocks: javascript:, data: (non-image), vbscript:, file://, etc.
 */
function isValidImageSrc(value: unknown, allowBase64: boolean): boolean {
  if (value === null || value === undefined) return true; // null is valid (no src)
  if (typeof value !== 'string') return false;
  if (value === '') return true; // empty string is valid

  // Check for valid URL patterns
  if (/^https?:\/\//i.test(value)) return true;
  if (allowBase64 && /^data:image\//i.test(value)) return true;

  return false;
}

export interface ImageOptions {
  /**
   * Allow base64 data:image/ URLs (default: false)
   * When false, only http:// and https:// URLs are allowed
   */
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
    const self = this as unknown as NodeClass<ImageOptions>;
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute('src');
          // Validate on parse - reject invalid URLs
          if (src && !isValidImageSrc(src, self.options.allowBase64)) {
            return null;
          }
          return src;
        },
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

    // XSS protection: defense in depth - validate again on render
    if (src && !isValidImageSrc(src, self.options.allowBase64)) {
      // Return image with empty src if URL is invalid (should not happen due to parse validation)
      return ['img', { ...self.options.HTMLAttributes, ...HTMLAttributes, src: '' }];
    }

    return ['img', { ...self.options.HTMLAttributes, ...HTMLAttributes }];
  },

  addCommands() {
    const self = this as unknown as NodeClass<ImageOptions>;
    return {
      setImage:
        (attributes?: Record<string, unknown>) =>
        ({ commands }) => {
          // XSS protection: validate src URL before inserting
          if (attributes?.['src'] && !isValidImageSrc(attributes['src'], self.options.allowBase64)) {
            return false;
          }

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
