import type { AnyExtension, JSONContent, GenerateHTMLOptions } from '@domternal/core';
import { generateHTML } from '@domternal/core';
import type { Lowlight } from './lowlightPlugin.js';
import { toHtml } from 'hast-util-to-html';
import { decodeText, highlightCodeBlocks } from './highlightCodeBlocks.js';

export interface GenerateHighlightedHTMLOptions {
  /** Default language for code blocks without a language. */
  defaultLanguage?: string;
  /** Auto-detect language when none specified. @default false */
  autoDetect?: boolean;
  /** Custom document implementation for generateHTML. */
  document?: Document;
}

/**
 * Generate HTML with syntax-highlighted code blocks.
 *
 * Unlike generateHTML(), this applies lowlight highlighting to code blocks,
 * producing `<span class="hljs-keyword">` etc. inside `<code>` elements.
 * Only real code blocks are highlighted: the HTML is read as markup, so text
 * inside an attribute, such as an image title, is never rewritten.
 *
 * @example
 * ```ts
 * import { generateHighlightedHTML } from '@domternal/extension-code-block-lowlight';
 * import { createLowlight, common } from 'lowlight';
 *
 * const lowlight = createLowlight(common);
 * const html = generateHighlightedHTML(json, extensions, lowlight);
 * ```
 */
export function generateHighlightedHTML(
  content: JSONContent,
  extensions: AnyExtension[],
  lowlight: Lowlight,
  options: GenerateHighlightedHTMLOptions = {},
): string {
  const htmlOptions: GenerateHTMLOptions = {};
  if (options.document !== undefined) {
    htmlOptions.document = options.document;
  }

  const html = generateHTML(content, extensions, htmlOptions);

  /** The highlighted content of one code block, or null to keep it as serialized. */
  const highlight = (code: string, language: string | undefined): string | null => {
    const decoded = decodeText(code);
    const lang = language ?? options.defaultLanguage ?? null;
    if (lang && lowlight.registered(lang)) return toHtml(lowlight.highlight(lang, decoded));
    if (options.autoDetect && decoded.length > 0) return toHtml(lowlight.highlightAuto(decoded));
    return null;
  };

  return highlightCodeBlocks(html, highlight);
}
