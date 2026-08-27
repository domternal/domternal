import type { Element, Root, RootContent, Properties } from 'hast';
import { sanitize } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { parseBoundedHTML, StructureLimitError } from './parse.js';
import { readSafeStyles, serializeStyles } from './styles.js';
import { safeImage, safeLink } from './urls.js';
import { cleanMetadata, cleanSliceContext } from './metadata.js';
import { assertTableBounds, TableLimitError } from './tables.js';
import { assertTagWork, TagWorkLimitError } from './tagWork.js';
import type {
  NormalizePasteHTMLOptions, NormalizePasteHTMLResult, PasteDiagnostic,
  PasteDiagnosticCode, PasteHTMLLimits, PasteSource,
} from './types.js';

export const DEFAULT_PASTE_HTML_LIMITS: Readonly<PasteHTMLLimits> = Object.freeze({
  maxInputLength: 2_000_000, maxNodes: 30_000, maxDepth: 128, maxDiagnostics: 100,
  maxTableCells: 20_000, maxImages: 200, maxImagePixels: 50_000_000,
});

const tags = [
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'mark', 'a',
  'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption', 'img', 'details', 'summary',
];
const discard = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea', 'select', 'button']);
const schema: Schema = {
  tagNames: tags,
  strip: [...discard],
  // Properties are rebuilt below. No raw attribute reaches this allowlist.
  attributes: {
    '*': ['style', 'dir', 'lang', 'title', 'id', 'data*'],
    a: ['href'], img: ['src', 'alt', 'width', 'height'],
    ol: ['start', 'type'], li: ['value'],
    td: ['colSpan', 'rowSpan'], th: ['colSpan', 'rowSpan', 'scope'],
    col: ['span', 'width'], code: [['className', /^language-[\w+-]+$/]],
    details: ['open'], div: ['open'],
  },
  protocols: { href: ['https', 'http', 'mailto', 'tel'], src: ['data', 'https', 'http'] },
  clobber: [],
};

function detectSource(html: string): PasteSource {
  if (/\b(?:mso-|MsoNormal|urn:schemas-microsoft-com:office)/i.test(html)) return 'word';
  if (/\bid=["']?docs-internal-guid-/i.test(html)) return 'google-docs';
  if (/(?:LibreOffice|OpenOffice)/i.test(html)) return 'libreoffice';
  return 'html';
}

function resolveLimits(input: Partial<PasteHTMLLimits> = {}): PasteHTMLLimits {
  const limits = { ...DEFAULT_PASTE_HTML_LIMITS, ...input };
  for (const key of Object.keys(DEFAULT_PASTE_HTML_LIMITS) as (keyof PasteHTMLLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_PASTE_HTML_LIMITS[key]) {
      throw new RangeError(`Invalid paste HTML limit: ${key}`);
    }
  }
  return limits;
}

/**
 * Normalize untrusted clipboard HTML without DOM access, resource requests, or editor mutation.
 * Rejected input returns an empty result. It must never fall back to the original HTML.
 */
export function normalizePasteHTML(html: string, options: NormalizePasteHTMLOptions = {}): NormalizePasteHTMLResult {
  const limits = resolveLimits(options.limits);
  const result: NormalizePasteHTMLResult = {
    status: 'cleaned', html: '', source: 'html', diagnostics: [], diagnosticsTruncated: false,
  };
  const report = (code: PasteDiagnosticCode, node?: Element, severity: PasteDiagnostic['severity'] = 'warning'): void => {
    if (result.diagnostics.length >= limits.maxDiagnostics) { result.diagnosticsTruncated = true; return; }
    const offset = node?.position?.start.offset;
    result.diagnostics.push({ code, severity, ...(offset === undefined ? {} : { offset }) });
  };
  if (html.length > limits.maxInputLength) {
    result.status = 'rejected'; report('input-limit', undefined, 'error'); return result;
  }
  result.source = detectSource(html);
  try {
    assertTagWork(html);
    const tree = parseBoundedHTML(html, limits);
    assertTableBounds(tree, limits.maxTableCells);
    let images = 0;
    let pixels = 0;
    const consumePixels = (count: number): boolean => {
      if (pixels + count > limits.maxImagePixels) return false;
      pixels += count;
      return true;
    };
    const pending = [...tree.children];
    let internal = false;
    while (pending.length > 0) {
      const node = pending.pop();
      if (node?.type !== 'element') continue;
      if (cleanSliceContext(node.properties['dataPmSlice']) !== undefined) internal = true;
      pending.push(...node.children);
    }
    const normalizeChildren = (parent: Root | Element): void => {
      const children: RootContent[] = [];
      for (const child of parent.children) {
        if (child.type === 'text') { children.push(child); continue; }
        if (child.type !== 'element') continue;
        if (discard.has(child.tagName)) { report('unsafe-content-removed', child); continue; }
        const original = child.properties;
        const clean: Properties = cleanMetadata(original);
        const { styles, removed } = readSafeStyles(original.style, child.tagName === 'img');
        if (removed) report('unsupported-formatting', child);
        if (child.tagName === 'b' && ['normal', '400'].includes(styles.get('font-weight') ?? '')) child.tagName = 'span';
        if (child.tagName === 'i' && styles.get('font-style') === 'normal') child.tagName = 'span';
        normalizeChildren(child);
        const semantic: string[] = [];
        if (/^(?:bold|[6-9]00)$/.test(styles.get('font-weight') ?? '')) semantic.push('strong');
        if (/^(?:italic|oblique)$/.test(styles.get('font-style') ?? '')) semantic.push('em');
        const decoration = styles.get('text-decoration-line') ?? styles.get('text-decoration') ?? '';
        if (decoration.includes('underline')) semantic.push('u');
        if (decoration.includes('line-through')) semantic.push('s');
        if (styles.get('vertical-align') === 'sub') semantic.push('sub');
        if (styles.get('vertical-align') === 'super') semantic.push('sup');
        if (['span', 'b', 'i', 'u', 's', 'em', 'strong', 'font'].includes(child.tagName)) {
          for (const tagName of semantic.reverse()) child.children = [{ type: 'element', tagName, properties: {}, children: child.children }];
          for (const key of ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line']) styles.delete(key);
          if (semantic.includes('sub') || semantic.includes('sup')) styles.delete('vertical-align');
        }
        if (options.formatting === 'adapt' && !internal) {
          if (options.preserveTextAlignment !== true) {
            if (styles.delete('text-align')) report('formatting-adapted', child, 'info');
            if (clean['dataTextAlign'] !== undefined) {
              delete clean['dataTextAlign'];
              report('formatting-adapted', child, 'info');
            }
          }
          for (const key of ['font-family', 'font-size', 'color', 'background-color', 'line-height']) {
            if (styles.delete(key)) report('formatting-adapted', child, 'info');
          }
          for (const key of ['dataTextColor', 'dataBgColor', 'dataBackground']) {
            if (clean[key] !== undefined) report('formatting-adapted', child, 'info');
          }
          delete clean['dataTextColor'];
          delete clean['dataBgColor'];
          delete clean['dataBackground'];
        }
        if ((child.tagName === 'details' || clean.dataType === 'details') && original.open === true) clean.open = true;
        if (child.tagName === 'img' && clean['dataAlign'] === 'center'
          && styles.get('margin-left') === 'auto' && styles.get('margin-right') === 'auto') {
          // Center alignment renders auto margins; they must not also infer float placement.
          styles.delete('margin-left');
          styles.delete('margin-right');
        }
        if (child.tagName === 'td' || child.tagName === 'th') {
          const textAlign = styles.get('text-align');
          const verticalAlign = styles.get('vertical-align');
          const background = styles.get('background-color');
          if (clean['dataTextAlign'] === undefined && textAlign !== undefined && ['left', 'right', 'center', 'justify'].includes(textAlign)) clean['dataTextAlign'] = textAlign;
          if (clean['dataVerticalAlign'] === undefined && verticalAlign !== undefined && ['top', 'middle', 'bottom'].includes(verticalAlign)) clean['dataVerticalAlign'] = verticalAlign;
          if (clean['dataBackground'] === undefined && background !== undefined) clean['dataBackground'] = background;
        }
        if (styles.size > 0) clean.style = serializeStyles(styles);
        for (const key of ['title', 'lang']) {
          const value = original[key];
          if (typeof value === 'string' && value.length <= 512) clean[key] = value;
        }
        if (['ltr', 'rtl', 'auto'].includes(String(original.dir))) clean.dir = original.dir;
        if (Object.keys(original).some(key => /^on/i.test(key) || ['srcDoc', 'srcSet', 'formAction', 'xLinkHref'].includes(key))) report('unsafe-content-removed', child);
        if (child.tagName === 'a' && original.href !== undefined) {
          const href = safeLink(original.href, options.sourceURL);
          if (href === undefined) report('link-removed', child); else clean.href = href;
        }
        if (child.tagName === 'img') {
          const src = ++images > limits.maxImages ? undefined : safeImage(original.src, options.allowRemoteImages === true, options.allowDataImages !== false, consumePixels);
          if (src === undefined) {
            report('image-removed', child);
            if (typeof original.alt === 'string') children.push({ type: 'text', value: original.alt });
            continue;
          }
          clean.src = src;
          if (typeof original.alt === 'string') clean.alt = original.alt;
        }
        for (const key of ['colSpan', 'rowSpan', 'span', 'start', 'value', 'width', 'height']) {
          const value = Number(original[key]);
          if (Number.isSafeInteger(value) && value > 0 && value <= 10_000) clean[key] = value;
        }
        if (child.tagName === 'ol' && ['1', 'a', 'A', 'i', 'I'].includes(String(original.type))) clean.type = original.type;
        if (child.tagName === 'code' && Array.isArray(original.className)) clean.className = original.className;
        child.properties = clean;
        if (!tags.includes(child.tagName)) { report('unsupported-formatting', child); children.push(...child.children); }
        else children.push(child);
      }
      parent.children = children;
    };
    normalizeChildren(tree);
    result.html = toHtml(sanitize(tree, schema));
  } catch (error: unknown) {
    result.status = 'rejected'; result.html = '';
    report(error instanceof StructureLimitError || error instanceof TableLimitError || error instanceof TagWorkLimitError ? 'structure-limit' : 'parse-failed', undefined, 'error');
  }
  return result;
}
