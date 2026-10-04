import type { Element, Root, RootContent, Properties } from 'hast';
import { sanitize } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { parseBoundedHTML, StructureLimitError } from './parse.js';
import { adaptedTypography, readSafeStyles, serializeStyles, styleToRead } from './styles.js';
import { listStyleFromType } from './listStyles.js';
import { safeImage, safeLink } from './urls.js';
import { cleanMetadata, cleanSliceContext } from './metadata.js';
import { confirmSliceAnchor, readSliceOrigin, sliceAnchorContext } from './sliceOrigin.js';
import { assertTableBounds, readTableSpan, TableLimitError } from './tables.js';
import { assertTagWork, TagWorkLimitError } from './tagWork.js';
import { assertOutputTreeBounds } from './treeBounds.js';
import { collectDestinationDemand } from './destinationDemand.js';
import type { PasteDestinationFeature } from './destinationDemand.js';
import { adaptHeadingLevels, HEADING_LEVEL_FEATURES, HEADING_TEXT_FEATURES, recordHeadingOutline } from './headingLevels.js';
import type { HeadingPlacement } from './headingLevels.js';
import { recordImageStandIns } from './imageStandIns.js';
import { LINK_FEATURES, unwrapLinks } from './links.js';
import { reconstructOfficeLists } from './officeLists.js';
import type { OfficeListReconstructionOptions } from './officeLists.js';
import { hoistListItemMarkers } from './listItemMarkers.js';
import { nestLeadingLists } from './leadingLists.js';
import { labelListItems } from './listItemLabels.js';
import { quietImageBoxes } from './imageBoxes.js';
import { resolveInlineInheritance, InheritanceLimitError } from './inheritance.js';
import { emptyParagraphMarks, envelopeTags, transparentOfficeWrapper } from './envelope.js';
import { wrapLooseInlineRuns } from './looseInline.js';
import { startsWithTablePart, wrapTableContent } from './bareTableParts.js';
import { restoreBareSpaces, restoreConvertedSpaces } from './convertedSpaces.js';
import { routineLineHeights } from './wordSpacing.js';
import { googleDocsEmptyParagraphs, googleDocsImageParagraphs, googleDocsLineHeights, googleDocsListLevels } from './googleDocs.js';
import { wordHiddenText } from './hiddenText.js';
import { recordRemovedText } from './removedText.js';
import type {
  NormalizePasteHTMLOptions, NormalizePasteHTMLResult, PasteDiagnostic,
  PasteDiagnosticCode, PasteHTMLLimits, PasteSource,
} from './types.js';

/** The classes Word writes for its Title style: one paragraph, or the first, middle and last of several. */
const WORD_TITLE = /^MsoTitle(?:CxSp(?:First|Middle|Last))?$/;

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
// Elements a browser lays out as blocks that the allowlist lacks. Unwrapped, their text ran into their
// neighbors' ("termdefinition"); as plain divisions each stays a block, as without cleanup.
const blockBoxes = new Set(['address', 'article', 'aside', 'center', 'dd', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'header', 'hgroup', 'legend', 'main', 'nav', 'search', 'section']);
// Active or interactive content whose removal can hide what the source showed. Envelope elements are separate.
const discard = new Set(['script', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'button']);
const schema: Schema = {
  tagNames: tags,
  strip: [...discard, ...envelopeTags],
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

const severityRank: Readonly<Record<PasteDiagnostic['severity'], number>> = { info: 0, warning: 1, error: 2 };

const holdsText = (node: Element): boolean =>
  node.children.some(child => (child.type === 'text' ? /[^\t\n\f\r ]/.test(child.value) : child.type === 'element' && holdsText(child)));

/** The checkbox a Domternal or Tiptap task item draws before its content, whose state the item's data-checked holds. */
function taskCheckbox(parent: Root | Element, child: Element): boolean {
  return parent.type === 'element' && parent.tagName === 'li' && parent.properties.dataType === 'taskItem'
    && (child.tagName === 'input' || (child.tagName === 'label' && !holdsText(child)));
}

/**
 * Append within a fixed allowance and report whether anything was omitted. When the allowance is full,
 * a new finding replaces the least severe retained finding that is less severe than itself, choosing
 * the newest of equally least severe ones; otherwise the new finding is dropped. An error therefore
 * displaces infos before warnings and a warning displaces an info, so the allowance keeps the most
 * severe findings and intentional adaptation never hides a loss or the refusal reason. Retained order
 * stays emission order.
 */
export function retainDiagnostic(diagnostics: PasteDiagnostic[], diagnostic: PasteDiagnostic, maxDiagnostics: number): boolean {
  if (diagnostics.length < maxDiagnostics) { diagnostics.push(diagnostic); return false; }
  let lowest = severityRank[diagnostic.severity];
  let replaced: number | undefined;
  for (let index = diagnostics.length - 1; index >= 0; index--) {
    const retained = diagnostics[index];
    if (retained === undefined || severityRank[retained.severity] >= lowest) continue;
    lowest = severityRank[retained.severity];
    replaced = index;
  }
  if (replaced !== undefined) {
    diagnostics.splice(replaced, 1);
    diagnostics.push(diagnostic);
  }
  return true;
}

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
  return normalizeClipboardHTML(html, options).result;
}

/** Private preparation sink. Its tree must never reach a live DOM before slot resolution. */
export interface ClipboardImagePreparationSink {
  reserveImage(node: Element, original: Properties): string | undefined;
  /** Independent of the diagnostic allowance, so a full allowance cannot hide a removed image. */
  removedImage?(): void;
  retainTree(tree: Root, existingImagePixels: number): void;
}

/** Private editor adapter. The standalone HTML entry never supplies a schema. */
export type ClipboardDestinationCheck = (features: readonly PasteDestinationFeature[]) => readonly PasteDestinationFeature[];

/**
 * Private editor verifier for a Domternal copy nonce issued in this page. The standalone HTML
 * entry never supplies it, so it treats every fragment as external.
 */
export type ClipboardOwnCopyCheck = (nonce: string) => boolean;

/** Internal destination constraints and paste intent do not become public result metadata. */
export function normalizeClipboardHTML(
  html: string,
  options: NormalizePasteHTMLOptions = {},
  capabilities?: () => Pick<OfficeListReconstructionOptions, 'orderedLists' | 'bulletLists' | 'nestedLists' | 'markers'>,
  preparation?: ClipboardImagePreparationSink,
  destination?: ClipboardDestinationCheck,
  ownCopy?: ClipboardOwnCopyCheck,
): { result: NormalizePasteHTMLResult; preserveOrderedListStart: boolean; destinationRejected?: true } {
  const limits = resolveLimits(options.limits);
  let preserveOrderedListStart = false;
  const result: NormalizePasteHTMLResult = {
    status: 'cleaned', html: '', source: 'html', diagnostics: [], diagnosticsTruncated: false,
  };
  const report = (code: PasteDiagnosticCode, node?: Element, severity: PasteDiagnostic['severity'] = 'warning'): void => {
    const offset = node?.position?.start.offset;
    const diagnostic: PasteDiagnostic = { code, severity, ...(offset === undefined ? {} : { offset }) };
    if (retainDiagnostic(result.diagnostics, diagnostic, limits.maxDiagnostics)) result.diagnosticsTruncated = true;
  };
  if (html.length > limits.maxInputLength) {
    result.status = 'rejected'; report('input-limit', undefined, 'error'); return { result, preserveOrderedListStart };
  }
  result.source = detectSource(html);
  try {
    assertTagWork(html);
    let tree = parseBoundedHTML(html, limits);
    // Before the table bounds, so the cells of bare rows count as the cells of a table. A
    // destination without tables keeps their texts, as its paste without cleanup does.
    if (startsWithTablePart(tree) && destination?.(['table']).includes('table') !== true) {
      tree = wrapTableContent(parseBoundedHTML(html, limits, 'table'));
    }
    assertTableBounds(tree, limits.maxTableCells);
    restoreConvertedSpaces(tree);
    emptyParagraphMarks(tree);
    let images = 0;
    let pixels = 0;
    // The alt text left in place of each removed image, so the editor can tell it from pasted text.
    const standIns: string[] = [];
    const consumePixels = (count: number): boolean => {
      if (pixels + count > limits.maxImagePixels) return false;
      pixels += count;
      return true;
    };
    // A slice marker alone is structural context. Only a verified own copy keeps editor formatting as is.
    const { anchor, own } = readSliceOrigin(tree, ownCopy);
    if (!own) {
      const hidden = result.source === 'word' ? wordHiddenText(tree) : undefined;
      if (/\bmso-list\s*:/i.test(html)) {
        // A list item Word hides is not pasted, so an item cleanup cannot rebuild is no finding when it is hidden.
        const lists = reconstructOfficeLists(tree, { ...limits, ...capabilities?.() }, (code, node) => {
          if (hidden?.conceals(node) !== true) report(code, node);
        });
        preserveOrderedListStart = lists.reconstructedLists > 0;
      }
      // Word's hidden text is not pasted. After the lists, so a hidden item leaves one list numbered as if it were not
      // there; before the styles and images are read, so the hidden ones are neither reported nor prepared.
      if (hidden?.remove(node => { report('hidden-text-removed', node); }) === true) recordRemovedText(result);
      // A Google Docs selection that starts below a list's first level writes the levels above as aria-level and indent.
      if (result.source === 'google-docs') googleDocsListLevels(tree);
      hoistListItemMarkers(tree);
      // After the markers moved, so the added item does not stop a list's items from agreeing on one.
      nestLeadingLists(tree);
      labelListItems(tree, anchor);
      quietImageBoxes(tree);
      if (result.source === 'google-docs') {
        // Google Docs writes each empty paragraph as a break between blocks, an image in a paragraph of its own, and
        // each block's spacing as 1.2 times the spacing Docs shows, its defaults included.
        googleDocsEmptyParagraphs(tree);
        googleDocsImageParagraphs(tree);
        googleDocsLineHeights(tree);
      }
      const routine = routineLineHeights(tree, result.source === 'word');
      resolveInlineInheritance(tree, {
        maxNodes: limits.maxNodes, maxDepth: limits.maxDepth, maxInputLength: limits.maxInputLength,
        formatting: options.formatting ?? 'preserve', ...(routine === undefined ? {} : { routineLineHeights: routine }),
        wordSource: result.source === 'word',
        // Google Docs writes its default text color, black, on every run, where its export names none.
        ...(result.source === 'google-docs' ? { defaultTextColor: '#000000' } : {}),
      }, node => { report('unsupported-formatting', node); }, node => { report('formatting-adapted', node, 'info'); });
      if (anchor !== undefined) confirmSliceAnchor(tree, anchor);
    }
    const adapt = options.formatting === 'adapt' && !own;
    // Adapted external context keeps its structure but not the formatting the element policy removes.
    const droppedContext = adapt ? new Set(options.preserveTextAlignment === true ? ['background'] : ['textAlign', 'background']) : undefined;
    const normalizeChildren = (parent: Root | Element): void => {
      const children: RootContent[] = [];
      for (const child of parent.children) {
        if (child.type === 'text') { children.push(child); continue; }
        if (child.type !== 'element' || envelopeTags.has(child.tagName) || taskCheckbox(parent, child)) continue;
        if (discard.has(child.tagName)) { report('unsafe-content-removed', child); continue; }
        const original = child.properties;
        // Word writes its Title style as a paragraph, and a Title of several paragraphs with its contextual spacing
        // classes. Each is a first level heading, as Pro's DOCX import reads every Title paragraph.
        if (!own && result.source === 'word' && child.tagName === 'p' && Array.isArray(original.className)
          && original.className.some(name => typeof name === 'string' && WORD_TITLE.test(name))) child.tagName = 'h1';
        const clean: Properties = cleanMetadata(original);
        const anchorContext = sliceAnchorContext(child);
        if (anchorContext !== undefined) {
          const context = cleanSliceContext(anchorContext, droppedContext);
          if (context !== undefined) clean['dataPmSlice'] = context;
          if (context !== anchorContext) report('formatting-adapted', child, 'info');
        }
        const { styles, removedNames } = readSafeStyles(styleToRead(child), child.tagName === 'img', child.tagName, own);
        // Typography that adapt removes anyway is its adaptation there, as in the inheritance pass.
        if (removedNames.some(name => !adapt || !adaptedTypography(name))) report('unsupported-formatting', child);
        else if (removedNames.length > 0) report('formatting-adapted', child, 'info');
        if (child.tagName === 'ul' && !styles.has('list-style-type') && clean.dataType !== 'taskList') {
          const marker = listStyleFromType('ul', original.type);
          if (marker !== undefined) styles.set('list-style-type', marker);
        }
        if (clean.dataType === 'taskList' && styles.delete('list-style-type')) report('unsupported-formatting', child);
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
        if (adapt) {
          if (child.tagName === 'mark') {
            child.tagName = 'span';
            report('formatting-adapted', child, 'info');
          }
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
          // A link or image title is content the editor keeps; one too long to keep is reported.
          else if (key === 'title' && typeof value === 'string' && (child.tagName === 'a' || child.tagName === 'img')) {
            report('unsupported-formatting', child);
          }
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
            const slot = images <= limits.maxImages ? preparation?.reserveImage(child, original) : undefined;
            if (slot === undefined) {
              preparation?.removedImage?.();
              report('image-removed', child);
              if (typeof original.alt === 'string') children.push({ type: 'text', value: original.alt });
              standIns.push(typeof original.alt === 'string' ? original.alt : '');
              continue;
            }
            // HAST data comes from this trusted sink, never from pasted HTML attributes.
            child.data ??= { position: {} };
            Reflect.set(child.data, 'domternalClipboardImageSlot', slot);
          } else clean.src = src;
          if (typeof original.alt === 'string') clean.alt = original.alt;
        }
        for (const key of ['colSpan', 'rowSpan', 'span', 'start', 'value', 'width', 'height']) {
          // A cell span keeps the value a browser and the Table extension read, which the table bounds counted.
          const value = key === 'colSpan' || key === 'rowSpan' ? readTableSpan(original[key]) : Number(original[key]);
          if (value === 1 && Number(original[key]) !== 1) continue;
          if (Number.isSafeInteger(value) && value > 0 && value <= 10_000) clean[key] = value;
        }
        if (child.tagName === 'ol' && ['1', 'a', 'A', 'i', 'I'].includes(String(original.type))) clean.type = original.type;
        if (child.tagName === 'code' && Array.isArray(original.className)) clean.className = original.className;
        child.properties = clean;
        if (!tags.includes(child.tagName)) {
          if (!transparentOfficeWrapper(child.tagName)) report('unsupported-formatting', child);
          // Without its attributes, so the division takes no meaning the element did not have.
          if (blockBoxes.has(child.tagName)) children.push({ type: 'element', tagName: 'div', properties: {}, children: child.children });
          else children.push(...child.children);
        }
        else children.push(child);
      }
      parent.children = children;
    };
    normalizeChildren(tree);
    recordImageStandIns(result, standIns);
    assertOutputTreeBounds(tree, limits.maxNodes, limits.maxDepth);
    const sanitized = sanitize(tree, schema);
    if (sanitized.type !== 'root') throw new Error('Expected a sanitized fragment');
    // A verified own copy holds only blocks at its top, as the editor serialized them. A wrapper
    // added here is generated output too, so the tree must still fit the same bounds with it.
    if (!own && wrapLooseInlineRuns(sanitized)) assertOutputTreeBounds(sanitized, limits.maxNodes, limits.maxDepth);
    if (!own) restoreBareSpaces(sanitized);
    if (destination !== undefined) {
      const requested = collectDestinationDemand(sanitized, limits);
      const unconfirmed = requested.length > 0 ? destination(requested) : [];
      if (unconfirmed.some(feature => feature === 'table' || feature === 'table-header')) {
        result.status = 'rejected';
        report('destination-table-unsupported', undefined, 'error');
        return { result, preserveOrderedListStart: false, destinationRejected: true };
      }
      // A link whose scheme the destination lacks keeps its text, one report each.
      const refusedLinks = unconfirmed.filter(feature => LINK_FEATURES.includes(feature));
      if (refusedLinks.length > 0) unwrapLinks(sanitized, refusedLinks, node => { report('link-removed', node); });
      let remaining = unconfirmed.filter(feature => !LINK_FEATURES.includes(feature));
      if (remaining.some(feature => HEADING_LEVEL_FEATURES.includes(feature))) {
        // A heading keeps its meaning at the nearest level the destination supports. Only a level
        // that every answer confirmed counts, and without one the destination makes paragraphs.
        const missing = destination(HEADING_LEVEL_FEATURES);
        const supported = HEADING_LEVEL_FEATURES.flatMap((feature, index) =>
          missing.includes(feature) || unconfirmed.includes(feature) ? [] : [index + 1]);
        if (supported.length > 0) {
          // Where the destination parses a heading as the block's text, it is left alone.
          const placement = (): HeadingPlacement => {
            const keeps = destination(HEADING_TEXT_FEATURES);
            return {
              listItemStart: keeps.includes('heading-text-at-list-item-start'),
              summary: keeps.includes('heading-text-in-summary'),
              preformatted: keeps.includes('heading-text-in-preformatted'),
            };
          };
          // The outline lets the editor report only the renamed headings that land as headings.
          recordHeadingOutline(result, adaptHeadingLevels(sanitized, supported, node => { report('destination-heading-level-adapted', node); }, placement));
          remaining = remaining.filter(feature => !HEADING_LEVEL_FEATURES.includes(feature));
        }
      }
      if (remaining.length > 0) report('destination-formatting-unconfirmed');
    }
    if (preparation === undefined) result.html = toHtml(sanitized);
    else preparation.retainTree(sanitized, pixels);
  } catch (error: unknown) {
    result.status = 'rejected'; result.html = '';
    preserveOrderedListStart = false;
    report(error instanceof StructureLimitError || error instanceof TableLimitError || error instanceof TagWorkLimitError || error instanceof InheritanceLimitError ? 'structure-limit' : 'parse-failed', undefined, 'error');
  }
  return { result, preserveOrderedListStart };
}
