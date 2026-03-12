import type { Lowlight } from './lowlightPlugin.js';
import { toHtml } from 'hast-util-to-html';

export interface CreateCodeHighlighterOptions {
  /** Default language when none specified on the code block. */
  defaultLanguage?: string;
  /** Auto-detect language when none specified. @default false */
  autoDetect?: boolean;
}

/**
 * Creates a `codeHighlighter` callback for use with `inlineStyles()`.
 *
 * @example
 * ```ts
 * import { createLowlight, common } from 'lowlight';
 * import { createCodeHighlighter } from '@domternal/extension-code-block-lowlight';
 * import { inlineStyles } from '@domternal/core';
 *
 * const lowlight = createLowlight(common);
 * const styled = inlineStyles(html, {
 *   codeHighlighter: createCodeHighlighter(lowlight),
 * });
 * ```
 */
export function createCodeHighlighter(
  lowlight: Lowlight,
  options: CreateCodeHighlighterOptions = {},
): (code: string, language: string | null) => string | null {
  return (code: string, language: string | null): string | null => {
    const lang = language ?? options.defaultLanguage ?? null;

    if (lang && lowlight.registered(lang)) {
      return toHtml(lowlight.highlight(lang, code));
    }

    if (options.autoDetect && code.length > 0) {
      return toHtml(lowlight.highlightAuto(code));
    }

    return null;
  };
}
