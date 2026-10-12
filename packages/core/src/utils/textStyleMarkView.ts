import { DOMSerializer } from '@domternal/pm/model';
import type { DOMOutputSpec, Mark } from '@domternal/pm/model';
import type { EditorView, MarkView } from '@domternal/pm/view';
import { surfaceToneAttributes } from '../helpers/surfaceTone.js';
import { textColorReadabilityKey } from './textColorReadabilityKey.js';

export interface ReadableTextMark {
  readonly color: string;
  /** Only mutations that exactly match the plugin's last write are ignored by ProseMirror. */
  writtenStyle: string | null;
  writtenState: string | null;
}
export const readableTextMarks = new WeakMap<HTMLElement, ReadableTextMark>();

/** Shared by Highlight and opt-in TextColor, so extension ordering never loses a background's surface tone. */
export function textStyleMarkView(mark: Mark, view: EditorView, inline: boolean): MarkView {
  const toDOM = mark.type.spec.toDOM;
  const render = DOMSerializer.renderSpec.bind(DOMSerializer) as (
    doc: Document, structure: DOMOutputSpec, xmlNS: string | null, blockArraysIn: Record<string, unknown>,
  ) => { dom: Node; contentDOM?: HTMLElement };
  const rendered = render(view.dom.ownerDocument, toDOM ? toDOM(mark, inline) : ['span', 0], null, mark.attrs);
  const dom = rendered.dom as HTMLElement;
  const tone = mark.attrs['backgroundColorToken'] ? null : surfaceToneAttributes(mark.attrs['backgroundColor']);
  if (tone && dom.nodeType === 1) {
    dom.setAttribute('data-dm-tone', tone['data-dm-tone']);
    const style = dom.getAttribute('style')?.replace(/[\s;]+$/, '');
    if (tone.style) dom.setAttribute('style', style ? `${style}; ${tone.style}` : tone.style);
  }
  const automatic = textColorReadabilityKey.getState(view.state) === true;
  const ownColor = automatic && dom.nodeType === 1 && typeof mark.attrs['color'] === 'string' && !mark.attrs['colorToken'] && dom.style.color;
  const record: ReadableTextMark | null = automatic && ownColor
    ? { color: dom.style.color, writtenStyle: null, writtenState: null } : null;
  if (record) {
    readableTextMarks.set(dom, record);
    dom.setAttribute('data-dm-text-contrast', 'auto');
  }
  return {
    dom, ...(rendered.contentDOM ? { contentDOM: rendered.contentDOM } : {}),
    ...(record ? {
      ignoreMutation: (mutation: Parameters<NonNullable<MarkView['ignoreMutation']>>[0]): boolean => mutation.type === 'attributes'
        && mutation.target === dom && (mutation.attributeName === 'style' && dom.getAttribute('style') === record.writtenStyle
          || mutation.attributeName === 'data-dm-text-contrast' && dom.getAttribute('data-dm-text-contrast') === record.writtenState),
      destroy: (): void => { readableTextMarks.delete(dom); },
    } : {}),
  };
}
