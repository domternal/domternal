import type { AnyExtension, JSONContent, GenerateHTMLOptions } from '@domternal/core';
import { generateHTML } from '@domternal/core';
import type { Lowlight } from './lowlightPlugin.js';
import { toHtml } from 'hast-util-to-html';

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

  return html.replace(
    /<pre([^>]*)><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, preAttrs: string, language: string | undefined, code: string) => {
      // Unescape HTML entities in code content
      const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const lang = language ?? options.defaultLanguage ?? null;
      let highlighted: string;

      if (lang && lowlight.registered(lang)) {
        const result = lowlight.highlight(lang, decoded);
        highlighted = toHtml(result);
      } else if (options.autoDetect && decoded.length > 0) {
        const result = lowlight.highlightAuto(decoded);
        highlighted = toHtml(result);
      } else {
        const codeClass = language ? ` class="language-${language}"` : '';
        return `<pre${preAttrs}><code${codeClass}>${code}</code></pre>`;
      }

      const codeClass = language ? ` class="language-${language}"` : '';
      return `<pre${preAttrs}><code${codeClass}>${highlighted}</code></pre>`;
    },
  );
}
