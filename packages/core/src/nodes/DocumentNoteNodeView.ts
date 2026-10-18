import type { Node as PMNode } from '@domternal/pm/model';
import { Selection } from '@domternal/pm/state';
import type { EditorView, NodeView, ViewMutationRecord } from '@domternal/pm/view';
import type { I18nService } from '../i18n/index.js';
import { documentNoteMessages } from '../messages/documentNotes.js';
import { localizeMessage } from '../utils/localizeMessage.js';
import { getDocumentNotes } from '../utils/documentNotes.js';

export class DocumentNoteNodeView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM?: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly unsubscribe: (() => void) | undefined;
  private target: number | undefined;
  constructor(private node: PMNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly i18n: I18nService | undefined, private readonly reference: boolean) {
    const document = view.dom.ownerDocument;
    this.dom = document.createElement(reference ? 'sup' : 'aside');
    this.dom.setAttribute(reference ? 'data-domternal-note-reference' : 'data-domternal-note', '');
    if (reference) { this.heading = this.dom; this.dom.contentEditable = 'false'; }
    else {
      this.dom.style.cssText = 'border-inline-start:2px solid currentColor;padding-inline-start:1em;margin-block:1em';
      this.heading = document.createElement('strong'); this.heading.setAttribute('data-note-heading', ''); this.heading.contentEditable = 'false';
      this.contentDOM = document.createElement('div'); this.contentDOM.setAttribute('data-note-content', ''); this.dom.append(this.heading, this.contentDOM);
    }
    this.heading.addEventListener('click', this.navigate);
    this.heading.addEventListener('keydown', this.keydown);
    this.refresh(); this.unsubscribe = i18n?.subscribe(() => { this.refresh(); });
  }
  private refresh(): void {
    const snapshot = getDocumentNotes(this.view.state.doc); const pos = this.getPos();
    const ref = this.reference ? snapshot?.references.find(item => item.pos === pos) : undefined;
    const body = this.reference ? ref?.body : snapshot?.bodies.find(item => item.pos === pos);
    const label = this.reference ? ref?.displayLabel ?? '?' : body?.displayLabel ?? '?';
    const title = this.node.attrs['kind'] === 'endnote' ? localizeMessage(this.i18n, documentNoteMessages.noteEndnote, { label }) : localizeMessage(this.i18n, documentNoteMessages.noteFootnote, { label });
    const status = snapshot?.exceeded ? localizeMessage(this.i18n, documentNoteMessages.noteLimit).text
      : this.reference && !body ? localizeMessage(this.i18n, documentNoteMessages.noteMissing).text
      : body?.duplicate ? localizeMessage(this.i18n, documentNoteMessages.noteDuplicate).text
      : body && !body.referenced ? localizeMessage(this.i18n, documentNoteMessages.noteUnreferenced).text : undefined;
    this.heading.textContent = this.reference ? label : `${title.text}${status ? `: ${status}` : ''}`;
    this.heading.setAttribute('aria-label', `${title.text}${status ? `: ${status}` : ''}`); this.heading.lang = title.language;
    this.dom.setAttribute('data-note-id', String(this.node.attrs['noteId'] ?? ''));
    this.dom.setAttribute('data-note-kind', this.node.attrs['kind'] === 'endnote' ? 'endnote' : 'footnote');
    if (typeof this.node.attrs['label'] === 'string') this.dom.setAttribute('data-note-label', this.node.attrs['label']); else this.dom.removeAttribute('data-note-label');
    const origin = body ? snapshot?.references.find(item => item.body === body) : undefined;
    this.target = snapshot?.exceeded ? undefined : this.reference ? body ? body.pos + 1 : undefined : origin?.pos;
    if (this.target !== undefined) { this.heading.tabIndex = 0; this.heading.setAttribute('role', 'link'); this.heading.style.cursor = 'pointer'; }
    else { this.heading.removeAttribute('tabindex'); this.heading.removeAttribute('role'); this.heading.style.removeProperty('cursor'); }
  }
  private navigate = (event: Event): void => {
    if (this.target === undefined) return;
    event.preventDefault(); const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(this.target))).scrollIntoView()); this.view.focus();
  };
  private keydown = (event: KeyboardEvent): void => { if (event.key === 'Enter' || event.key === ' ') this.navigate(event); };
  update(node: PMNode): boolean { if (node.type !== this.node.type) return false; this.node = node; this.refresh(); return true; }
  stopEvent(event: Event): boolean { const target = event.target as globalThis.Node | null; return target !== null && this.heading.contains(target); }
  ignoreMutation(mutation: ViewMutationRecord): boolean { return mutation.type !== 'selection' && (this.heading.contains(mutation.target) || mutation.type === 'attributes' && mutation.target === this.dom); }
  destroy(): void { this.unsubscribe?.(); this.heading.removeEventListener('click', this.navigate); this.heading.removeEventListener('keydown', this.keydown); }
}
