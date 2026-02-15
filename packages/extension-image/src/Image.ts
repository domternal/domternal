/**
 * Image Node
 *
 * Block-level (default) or inline image element.
 * Supports src, alt, title, width, height, loading, crossorigin attributes.
 *
 * Options:
 * - inline: false (default) — block-level image | true — inline image within paragraphs
 * - allowBase64: false (default) — only http/https URLs | true — also allow data:image/ URLs
 *
 * XSS Protection (blocklist approach):
 * - Blocks javascript:, vbscript:, file: protocols
 * - Blocks data: URLs unless allowBase64 AND specifically data:image/
 * - Allows http(s), relative paths, protocol-relative URLs
 * - Defense in depth: validated in parseHTML, renderHTML, setImage command, and input rule
 */

import { Node } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { InputRule } from 'prosemirror-inputrules';
import { imageUploadPlugin } from './imageUploadPlugin.js';

/**
 * Typed options for the setImage command.
 * src is required — it makes no sense to insert an image without a source URL.
 */
export interface SetImageOptions {
  src: string;
  alt?: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  loading?: 'lazy' | 'eager';
  crossorigin?: 'anonymous' | 'use-credentials';
}

declare module '@domternal/core' {
  interface RawCommands {
    setImage: CommandSpec<[attributes: SetImageOptions]>;
  }
}

/**
 * Validates image src URL for XSS protection.
 * Blocks: javascript:, vbscript:, file:, and data: (unless allowBase64 AND data:image/).
 * Allows everything else: http(s), relative paths, protocol-relative URLs, etc.
 */
function isValidImageSrc(value: unknown, allowBase64: boolean): boolean {
  if (value === null || value === undefined) return true; // null is valid (no src)
  if (typeof value !== 'string') return false;
  if (value === '') return true; // empty string is valid

  // Block dangerous protocols
  if (/^(javascript|vbscript|file):/i.test(value)) return false;

  // Block data: URLs unless allowBase64 AND specifically data:image/
  if (/^data:/i.test(value)) {
    return allowBase64 && /^data:image\//i.test(value);
  }

  // Allow everything else: http(s), relative paths, protocol-relative, etc.
  return true;
}

export interface ImageOptions {
  /**
   * Whether images are inline (within paragraphs) or block-level (default: false)
   * When true, images can appear alongside text within a paragraph.
   */
  inline: boolean;
  /**
   * Allow base64 data:image/ URLs (default: false)
   * When false, only http:// and https:// URLs are allowed
   */
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
  /**
   * Async function that uploads a file and returns the URL.
   * When provided, enables paste/drop image upload.
   * When null (default), paste/drop is not handled.
   */
  uploadHandler: ((file: File) => Promise<string>) | null;
  /**
   * Allowed MIME types for upload.
   * @default ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']
   */
  allowedMimeTypes: string[];
  /**
   * Maximum file size in bytes. 0 = unlimited.
   * @default 0
   */
  maxFileSize: number;
  /**
   * Called when upload fails. Receives the error and the file.
   */
  onUploadError: ((error: Error, file: File) => void) | null;
}

export const Image = Node.create<ImageOptions>({
  name: 'image',
  group() {
    return this.options.inline ? 'inline' : 'block';
  },
  inline() {
    return this.options.inline;
  },
  draggable: true,
  atom: true,

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
      uploadHandler: null,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/avif',
      ],
      maxFileSize: 0,
      onUploadError: null,
    };
  },

  addAttributes() {
    const { options } = this;
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute('src');
          // Validate on parse - reject invalid URLs
          if (src && !isValidImageSrc(src, options.allowBase64)) {
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
      loading: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('loading'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['loading']) return {};
          return { loading: attributes['loading'] as string };
        },
      },
      crossorigin: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('crossorigin'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['crossorigin']) return {};
          return { crossorigin: attributes['crossorigin'] as string };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = node.attrs['src'] as string | null;

    // XSS protection: defense in depth - validate again on render
    if (src && !isValidImageSrc(src, this.options.allowBase64)) {
      // Return image with empty src if URL is invalid (should not happen due to parse validation)
      return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src: '' }];
    }

    return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes }];
  },

  leafText(node) {
    return (node.attrs['alt'] as string | null) ?? '';
  },

  addInputRules() {
    const { nodeType, options } = this;
    if (!nodeType) return [];

    return [
      new InputRule(
        /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["']([^"']+)["'])?\))$/,
        (state, match, start, end) => {
          const [fullMatch, wrapper, alt, src, title] = match;
          if (!src || !wrapper) return null;

          // XSS validation: reject dangerous URLs in markdown syntax too
          if (!isValidImageSrc(src, options.allowBase64)) return null;

          const { tr } = state;
          const attrs: Record<string, unknown> = {
            src,
            alt: alt ?? null,
            title: title ?? null,
          };

          // Adjust start for leading whitespace before ![
          const offset = fullMatch.length - wrapper.length;
          const from = start + offset;

          tr.replaceWith(from, end, nodeType.create(attrs));
          return tr;
        }
      ),
    ];
  },

  addCommands() {
    return {
      setImage:
        (attributes: SetImageOptions) =>
        ({ tr, dispatch }) => {
          // XSS protection: validate src URL before inserting
          if (!isValidImageSrc(attributes.src, this.options.allowBase64)) {
            return false;
          }

          if (!this.nodeType) return false;

          if (dispatch) {
            const node = this.nodeType.create(attributes);
            tr.replaceSelectionWith(node);
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.uploadHandler || !this.nodeType) return [];

    return [
      imageUploadPlugin({
        nodeType: this.nodeType,
        uploadHandler: this.options.uploadHandler,
        allowedMimeTypes: this.options.allowedMimeTypes,
        maxFileSize: this.options.maxFileSize,
        onUploadError: this.options.onUploadError,
      }),
    ];
  },
});
