import type { PasteSource } from './types.js';

/**
 * What the HTML parser hands over of a copy's markup while it builds the tree: each element with its attributes as the
 * parser read them, the html start tag's included, which a fragment does not keep, each comment, and the text of each
 * `style` element. Text never reaches it.
 */
export interface MarkupObserver {
  element(tagName: string, attributes: readonly { name: string; value: string }[]): void;
  comment(data: string): void;
  /** Text the parser puts in a style element, in pieces; `element` is that element. */
  style(element: object, text: string): void;
}

/**
 * What the markup of clipboard HTML says about the application that wrote it. Only markup counts: elements with their
 * attributes, the rules of `style` elements, and Office's conditional comments, whose content is markup Office writes
 * for itself. Text never does, so a page whose text, title, alt text, link or free comment names an Office class,
 * property or namespace, or Google Docs' copy wrapper, is no copy of that application:
 *
 * - Word (and the other Office applications): an `xmlns:*` declaration of an Office namespace
 *   (`urn:schemas-microsoft-com:office:*`), a class starting `MsoNormal`, an `mso-*` declaration in a style
 *   attribute, a stylesheet whose rules declare an `mso-*` property, style a `MsoNormal` class or name the Office
 *   namespace, or any of them in a conditional comment (`<!--[if gte mso 10]>...<![endif]-->`).
 * - Google Docs: an element whose id starts `docs-internal-guid-`, the wrapper Docs puts around its copy.
 * - LibreOffice: a `meta` named `generator` whose content names LibreOffice or OpenOffice.
 *
 * Word comes first, then Google Docs, then LibreOffice. `officeLists` says whether the markup declares an Office list
 * (`mso-list:`) in a style attribute, a stylesheet rule or a conditional comment, which Office list reconstruction
 * reads; text that names the property does not.
 */
export interface ClipboardMarkup {
  readonly source: PasteSource;
  readonly officeLists: boolean;
}

// A conditional comment's content is read only when it holds a word of these, which its markup needs.
const CANDIDATE = /mso-|msonormal|urn:schemas-microsoft-com:office|docs-internal-guid-|libreoffice|openoffice/i;
const LIST_CANDIDATE = /mso-list[\t\n\f\r ]*:/i;
const CONDITIONAL = /^\[if[\t\n\f\r ]/i;
const XMLNS = /^xmlns(?::|$)/;
const OFFICE_NAMESPACE = /urn:schemas-microsoft-com:office/i;
// A class token as Word writes its Normal style's paragraphs and tables: MsoNormal, MsoNormalTable.
const WORD_CLASS = /(?:^|[\t\n\f\r ])msonormal/i;
// A declaration of one of Office's own properties, as Word writes them in style attributes and stylesheet rules.
const OFFICE_DECLARATION = /(?:^|[\t\n\f\r ;{])mso-[\w-]*[\t\n\f\r ]*:/i;
const LIST_DECLARATION = /(?:^|[\t\n\f\r ;{])mso-list[\t\n\f\r ]*:/i;
const WORD_RULES = /\.msonormal|urn:schemas-microsoft-com:office/i;
const DOCS_ID = /^docs-internal-guid-/i;
const GENERATOR = /^generator$/i;
const LIBRE_GENERATOR = /libreoffice|openoffice/i;

/**
 * Collects what the parser hands over (`observer`), then settles the answer: `settle` reads each conditional comment
 * that can still change it as markup, through `parse`, which hands that markup to the observer in turn, one level deep.
 * The first comment `parse` refuses ends the reading.
 */
export function clipboardMarkup(): { observer: MarkupObserver; settle(parse: (html: string) => void): ClipboardMarkup } {
  const found = { word: false, docs: false, libre: false, lists: false };
  const styles = new Map<object, string>();
  // Each once, though the parse of bare table parts as a table's content hands them over again.
  const conditional = new Set<string>();
  let nested = false;
  const settleStyles = (): void => {
    for (const css of styles.values()) {
      // A stylesheet's comments declare nothing; an unclosed one runs to the end.
      const rules = css.replace(/\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$)/g, ' ');
      found.word ||= OFFICE_DECLARATION.test(rules) || WORD_RULES.test(rules);
      found.lists ||= LIST_DECLARATION.test(rules);
    }
    styles.clear();
  };
  return {
    observer: {
      element(tagName, attributes) {
        let name = '';
        let content = '';
        for (const attribute of attributes) {
          const { value } = attribute;
          if (attribute.name === 'class') found.word ||= WORD_CLASS.test(value);
          else if (attribute.name === 'style') {
            found.word ||= OFFICE_DECLARATION.test(value);
            found.lists ||= LIST_DECLARATION.test(value);
          } else if (attribute.name === 'id') found.docs ||= DOCS_ID.test(value);
          else if (attribute.name === 'name') name = value;
          else if (attribute.name === 'content') content = value;
          else if (XMLNS.test(attribute.name)) found.word ||= OFFICE_NAMESPACE.test(value);
        }
        if (tagName === 'meta') found.libre ||= GENERATOR.test(name) && LIBRE_GENERATOR.test(content);
      },
      comment(data) {
        if (!nested && CONDITIONAL.test(data) && CANDIDATE.test(data)) conditional.add(data);
      },
      style(element, text) {
        styles.set(element, (styles.get(element) ?? '') + text);
      },
    },
    settle(parse) {
      nested = true;
      try {
        for (const data of conditional) {
          settleStyles();
          if (!found.word || (!found.lists && LIST_CANDIDATE.test(data))) parse(data);
        }
      } catch {
        // Markup the limits refuse names nothing, nor do the comments after it, which share its allowance.
      }
      settleStyles();
      return { source: found.word ? 'word' : found.docs ? 'google-docs' : found.libre ? 'libreoffice' : 'html', officeLists: found.lists };
    },
  };
}
