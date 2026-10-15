import type { Element, Root, RootContent } from 'hast';

/** Only explicit paragraph properties retained by external Preserve cleanup may replace an empty target's defaults. */
export interface FirstParagraphFormat {
  readonly textAlign: string | undefined;
  readonly lineHeight: string | undefined;
  readonly bgColor?: string;
  readonly text: string;
}

const formats = new WeakMap<object, Readonly<FirstParagraphFormat>>();

export function firstParagraphFormat(result: object | undefined): Readonly<FirstParagraphFormat> | undefined {
  return result === undefined ? undefined : formats.get(result);
}

/** Prepared images keep the paragraph intent of their already sanitized source. */
export function copyFirstParagraphFormat(from: object, to: object): void {
  const format = formats.get(from);
  if (format !== undefined) formats.set(to, format);
}

function firstParagraph(tree: Root): Element | undefined {
  let children: readonly RootContent[] = tree.children;
  for (;;) {
    const first = children.find(node => node.type !== 'comment' && (node.type !== 'text' || /[^ \t\r\n\f]/u.test(node.value)));
    if (first?.type !== 'element') return undefined;
    if (first.tagName === 'p') return first;
    // Word commonly wraps its paragraphs in a neutral division. Semantic containers keep their normal slice behavior.
    if (first.tagName !== 'div' || first.properties.dataType !== undefined) return undefined;
    children = first.children;
  }
}

/** Read the bounded, sanitized tree, never source markup or a browser HTML sink. */
export function recordFirstParagraphFormat(result: object, tree: Root): void {
  const paragraph = firstParagraph(tree);
  const style = paragraph?.properties.style;
  if (typeof style !== 'string') return;
  const properties = new Map(style.split(';').map(declaration => {
    const colon = declaration.indexOf(':');
    return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
  }));
  const textAlign = properties.get('text-align');
  const lineHeight = properties.get('line-height');
  const bgColor = properties.get('background-color');
  if (textAlign === undefined && lineHeight === undefined && bgColor === undefined || paragraph === undefined) return;
  const text: string[] = [];
  const stack: RootContent[] = [...paragraph.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.type === 'text') text.push(node.value);
    else if (node?.type === 'element') {
      if (node.tagName === 'br') text.push(' ');
      else for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child !== undefined) stack.push(child);
      }
    }
  }
  formats.set(result, Object.freeze({ textAlign, lineHeight, ...(bgColor === undefined ? {} : { bgColor }), text: paragraphTextIdentity(text.join('')) }));
}

/** HTML and ProseMirror collapse ordinary inline whitespace while retaining nonbreaking spaces. */
export function paragraphTextIdentity(text: string): string {
  return text.replace(/[ \t\r\n\f]+/gu, ' ').replace(/^ | $/gu, '');
}
