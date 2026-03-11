/**
 * Inline Styles Utility
 *
 * Applies inline CSS styles to serialized HTML so it renders correctly
 * when pasted outside the editor (email clients, CMS, Google Docs, etc.).
 *
 * Uses hardcoded light-theme defaults (same approach as Google Docs, Notion,
 * TinyMCE). Optionally accepts overrides for custom styling.
 *
 * Only structural styles are inlined (borders, padding, margins, fonts).
 * Colors are NOT inlined — explicit colors (TextColor, Highlight, cell bg)
 * are already inline from renderHTML, and default text color is browser default.
 */

// ---------------------------------------------------------------------------
// Override keys — users can override any of these
// ---------------------------------------------------------------------------

export interface InlineStyleOverrides {
  blockquoteBorder?: string;
  blockquoteColor?: string;
  tableBorder?: string;
  tableHeaderBg?: string;
  codeBg?: string;
  codeFont?: string;
  codeBorder?: string;
  codeBlockBg?: string;
  codeBlockFont?: string;
  hrBorder?: string;
  linkColor?: string;
  detailsBorder?: string;
  detailsBg?: string;
  /**
   * Optional callback to syntax-highlight code blocks.
   * Receives the raw text content and optional language, returns highlighted HTML
   * with `<span class="hljs-*">` markup (or any spans with inline styles).
   *
   * @example
   * ```ts
   * import { createLowlight, common } from 'lowlight';
   * import { toHtml } from 'hast-util-to-html';
   * const lowlight = createLowlight(common);
   *
   * inlineStyles(html, {
   *   codeHighlighter: (code, language) => {
   *     if (language && lowlight.registered(language)) {
   *       return toHtml(lowlight.highlight(language, code));
   *     }
   *     return null; // no highlighting
   *   },
   * });
   * ```
   */
  codeHighlighter?: (code: string, language: string | null) => string | null;
}

// ---------------------------------------------------------------------------
// Syntax highlighting colors (from packages/theme/src/_syntax.scss)
// GitHub-style light theme — hardcoded for consistent export.
// ---------------------------------------------------------------------------

const SYNTAX_COLORS: Record<string, string> = {
  // Keywords, types, doctags
  'hljs-doctag': '#d73a49',
  'hljs-keyword': '#d73a49',
  'hljs-template-tag': '#d73a49',
  'hljs-template-variable': '#d73a49',
  'hljs-type': '#d73a49',

  // Function & class names
  'hljs-title': '#6f42c1',

  // Constants, numbers, operators, attributes
  'hljs-attr': '#005cc5',
  'hljs-attribute': '#005cc5',
  'hljs-literal': '#005cc5',
  'hljs-meta': '#005cc5',
  'hljs-number': '#005cc5',
  'hljs-operator': '#005cc5',
  'hljs-variable': '#e36209',
  'hljs-selector-attr': '#005cc5',
  'hljs-selector-class': '#005cc5',
  'hljs-selector-id': '#005cc5',

  // Strings & regex
  'hljs-regexp': '#032f62',
  'hljs-string': '#032f62',

  // Built-ins & symbols
  'hljs-built_in': '#e36209',
  'hljs-symbol': '#e36209',

  // Comments
  'hljs-comment': '#6a737d',
  'hljs-code': '#6a737d',
  'hljs-formula': '#6a737d',

  // HTML/XML tag names, selectors
  'hljs-name': '#22863a',
  'hljs-quote': '#22863a',
  'hljs-selector-tag': '#22863a',
  'hljs-selector-pseudo': '#22863a',

  // Markup
  'hljs-section': '#005cc5',
  'hljs-bullet': '#22863a',

  // Diff
  'hljs-addition': '#22863a',
  'hljs-deletion': '#b31d28',
};

// ---------------------------------------------------------------------------
// Light-theme defaults (from packages/theme/src/_variables.scss)
// ---------------------------------------------------------------------------

type StyleDefaults = Required<Omit<InlineStyleOverrides, 'codeHighlighter'>>;

const DEFAULTS: StyleDefaults = {
  blockquoteBorder: '3px solid #6a6a6a',
  blockquoteColor: '#6a6a6a',
  tableBorder: '1px solid #e5e7eb',
  tableHeaderBg: '#f8f9fa',
  codeBg: '#f0f0f0',
  codeFont: '"SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace',
  codeBorder: '1px solid #e5e7eb',
  codeBlockBg: '#f0f0f0',
  codeBlockFont: '"SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace',
  hrBorder: '2px solid #e5e7eb',
  linkColor: '#2563eb',
  detailsBorder: '1px solid #e5e7eb',
  detailsBg: '#f8f9fa',
};

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

function resolveOverrides(overrides?: InlineStyleOverrides): StyleDefaults {
  if (!overrides) return DEFAULTS;
  return { ...DEFAULTS, ...overrides };
}

/**
 * Applies inline styles to all elements in a container.
 * Exported for use in clipboardSerializer (operates on DOM directly).
 */
export function applyInlineStyles(container: HTMLElement, overrides?: InlineStyleOverrides): void {
  const v = resolveOverrides(overrides);

  // Syntax-highlight code blocks if a highlighter is provided
  if (overrides?.codeHighlighter) {
    const codeBlocks = container.querySelectorAll('pre > code');
    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i] as HTMLElement;
      const raw = code.textContent || '';
      const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
      const language = langClass ? langClass.slice('language-'.length) : null;
      const highlighted = overrides.codeHighlighter(raw, language);
      if (highlighted !== null) {
        code.innerHTML = highlighted;
      }
    }
  }

  const elements = container.querySelectorAll('*');

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement;
    const tag = el.tagName;
    const existing = el.getAttribute('style') || '';
    let styles = '';

    switch (tag) {
      case 'BLOCKQUOTE':
        styles = `border-left: ${v.blockquoteBorder}; color: ${v.blockquoteColor}; margin: 0.75em 0; padding: 0.25em 0 0.25em 1em;`;
        break;

      case 'TABLE':
        styles = `border-collapse: collapse; width: 100%; margin: 0.75em 0;`;
        break;

      case 'TD':
        styles = `border: ${v.tableBorder}; padding: 0.5em 0.75em; min-width: 100px;`;
        break;

      case 'TH':
        styles = `border: ${v.tableBorder}; padding: 0.5em 0.75em; min-width: 100px; font-weight: 600; background: ${v.tableHeaderBg}; text-align: left;`;
        break;

      case 'PRE':
        styles = `background: ${v.codeBlockBg}; font-family: ${v.codeBlockFont}; font-size: 0.875em; padding: 1em; border-radius: 0.375rem; overflow-x: auto; margin: 0.75em 0;`;
        break;

      case 'CODE': {
        const parent = el.parentElement;
        if (parent && parent.tagName === 'PRE') {
          // Code inside pre — reset inline code styles
          styles = 'background: none; padding: 0; border: none; border-radius: 0; font-size: inherit;';
        } else {
          // Inline code
          styles = `background: ${v.codeBg}; font-family: ${v.codeFont}; font-size: 0.875em; padding: 0.15em 0.35em; border: ${v.codeBorder}; border-radius: 0.25rem;`;
        }
        break;
      }

      case 'HR':
        styles = `border: none; border-top: ${v.hrBorder}; margin: 1.5em 0;`;
        break;

      case 'A':
        styles = `color: ${v.linkColor}; text-decoration: underline;`;
        break;

      case 'IMG':
        styles = 'max-width: 100%; height: auto; display: block; margin: 0.75em 0;';
        break;

      case 'H1':
        styles = 'font-size: 2em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;
      case 'H2':
        styles = 'font-size: 1.5em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;
      case 'H3':
        styles = 'font-size: 1.25em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;
      case 'H4':
        styles = 'font-size: 1.1em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;
      case 'H5':
        styles = 'font-size: 1em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;
      case 'H6':
        styles = 'font-size: 0.9em; font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em;';
        break;

      case 'UL':
        if (el.getAttribute('data-type') === 'taskList') {
          styles = 'list-style: none; padding-left: 0; margin: 0.75em 0;';
        } else {
          styles = 'margin: 0.75em 0; padding-left: 1.5em;';
        }
        break;

      case 'OL':
        styles = 'margin: 0.75em 0; padding-left: 1.5em;';
        break;

      case 'LI':
        if (el.getAttribute('data-type') === 'taskItem') {
          styles = 'display: flex; align-items: flex-start; gap: 0.5em; margin: 0.25em 0;';
          // Checked task item — style the content div
          if (el.getAttribute('data-checked') === 'true') {
            const contentDiv = el.querySelector(':scope > div') as HTMLElement | null;
            if (contentDiv) {
              const contentExisting = contentDiv.getAttribute('style') || '';
              contentDiv.setAttribute(
                'style',
                'text-decoration: line-through; opacity: 0.6;' + contentExisting,
              );
            }
          }
        } else {
          styles = 'margin: 0.25em 0;';
        }
        break;

      case 'DETAILS':
        styles = `border: ${v.detailsBorder}; border-radius: 0.375rem; margin: 0.75em 0;`;
        break;

      case 'SUMMARY':
        styles = `font-weight: 600; padding: 0.5em 0.75em; background: ${v.detailsBg}; border-radius: 0.375rem 0.375rem 0 0; cursor: pointer; list-style: none;`;
        break;

      case 'SPAN': {
        // Syntax highlighting — apply inline color for hljs-* classes
        const classList = el.className.split(' ');
        for (const cls of classList) {
          const color = SYNTAX_COLORS[cls];
          if (color) {
            styles = `color: ${color};`;
            break;
          }
        }
        // hljs-section is bold, hljs-emphasis italic, hljs-strong bold
        if (el.classList.contains('hljs-section') || el.classList.contains('hljs-strong')) {
          styles += ' font-weight: bold;';
        }
        if (el.classList.contains('hljs-emphasis')) {
          styles += ' font-style: italic;';
        }
        // Diff backgrounds
        if (el.classList.contains('hljs-addition')) {
          styles += ' background-color: #f0fff4;';
        }
        if (el.classList.contains('hljs-deletion')) {
          styles += ' background-color: #ffeef0;';
        }
        break;
      }
    }

    // DIV with data-details-content
    if (tag === 'DIV' && el.hasAttribute('data-details-content')) {
      styles = `padding: 0.5em 0.75em; border-top: ${v.detailsBorder};`;
    }

    // Table cell data-attributes → inline styles
    if (tag === 'TD' || tag === 'TH') {
      const textAlign = el.getAttribute('data-text-align');
      if (textAlign) {
        styles += ` text-align: ${textAlign};`;
      }
      const verticalAlign = el.getAttribute('data-vertical-align');
      if (verticalAlign) {
        styles += ` vertical-align: ${verticalAlign};`;
      }
    }

    // Merge: theme defaults first, then existing inline styles (user-set wins)
    if (styles) {
      el.setAttribute('style', styles + ' ' + existing);
    }
  }
}

/**
 * Takes an HTML string and returns it with inline CSS styles applied
 * to all elements, so it renders correctly outside the editor.
 *
 * @param html - Serialized HTML string from editor.getHTML()
 * @param overrides - Optional style overrides for custom theming
 *
 * @example
 * ```ts
 * // Default light-theme styles
 * const styled = inlineStyles(editor.getHTML());
 *
 * // With custom overrides
 * const styled = inlineStyles(editor.getHTML(), {
 *   blockquoteBorder: '5px solid red',
 *   linkColor: '#ff6600',
 * });
 * ```
 */
export function inlineStyles(html: string, overrides?: InlineStyleOverrides): string {
  if (!html) return html;

  const div = document.createElement('div');
  div.innerHTML = html;
  applyInlineStyles(div, overrides);
  return div.innerHTML;
}
