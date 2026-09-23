/**
 * Pasting blocks into a details summary.
 *
 * The summary holds text only, and ProseMirror's paste fitted blocks there by closing the
 * details and opening a new one: the summary's text after the caret and the original content
 * moved into a second details with an empty summary, collapsed and so hidden. A paste that
 * brings blocks goes where Enter in the summary puts the caret instead, a new block at the start
 * of the content, which opens. The paste then runs on from there through the other paste
 * handlers, so Markdown, image files, SmartPaste and ProseMirror's own paste place it as they
 * place a paste into an empty block. Inline content and a single textblock still join the
 * summary's text, as they did.
 */
import { Extension, defaultBlockAt } from '@domternal/core';
import { getClipboardImageDestination, pasteHasOwnText } from '@domternal/core/clipboard';
import { Plugin, PluginKey, Selection } from '@domternal/pm/state';
import type { Slice } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

export interface DetailsPasteOptions {
  /** The `persist` option of Details: whether the document keeps the open state. */
  persist: boolean;
  /** The `openClassName` option of Details. */
  openClassName: string;
}

/** Whether a paste brings blocks: more than one block, a block other than a textblock, or image files an image node places as blocks. */
function bringsBlocks(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  let blocks = 0;
  for (let index = 0; index < slice.content.childCount; index++) {
    const node = slice.content.child(index);
    if (node.isBlock && (!node.isTextblock || ++blocks > 1)) return true;
  }
  const data = event.clipboardData;
  const files = [...Array.from(data?.files ?? []), ...Array.from(data?.items ?? [], item => (item.kind === 'file' ? item.getAsFile() : null))];
  return getClipboardImageDestination(view)?.inline === false
    && files.some(file => file?.type.startsWith('image/') === true) && !pasteHasOwnText(event, slice);
}

/** Puts the caret in a new block at the start of the summary's content, opened, as Enter in the summary does. */
function enterContent(view: EditorView, options: DetailsPasteOptions): void {
  const { state } = view;
  const detailsPos = state.selection.$from.before(-1);
  const tr = state.tr;
  if (!tr.selection.empty) tr.deleteSelection();
  const contentPos = tr.selection.$head.after();
  const content = tr.doc.nodeAt(contentPos);
  const type = content ? defaultBlockAt(content.contentMatchAt(0)) : null;
  const block = type?.createAndFill();
  if (!content || !type || !block || !content.canReplaceWith(0, 0, type)) return;
  tr.insert(contentPos + 1, block);
  tr.setSelection(Selection.near(tr.doc.resolve(contentPos + 2)));
  const details = tr.doc.nodeAt(detailsPos);
  if (options.persist && details) {
    if (details.attrs['open'] !== true) tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true });
  } else {
    const dom = view.nodeDOM(detailsPos);
    if (dom instanceof HTMLElement && !dom.classList.contains(options.openClassName)) {
      dom.classList.add(options.openClassName);
      dom.querySelector(':scope > button')?.setAttribute('aria-expanded', 'true');
      dom.querySelector('[data-details-content]')?.dispatchEvent(new Event('toggleDetailsContent'));
    }
  }
  // The selection fix that keeps the caret out of collapsed content leaves this one alone.
  view.dispatch(tr.setMeta('detailsEnterOpen', true).scrollIntoView());
}

export const detailsPastePluginKey = new PluginKey('detailsPaste');

export const DetailsPaste = Extension.create<DetailsPasteOptions>({
  name: 'detailsPaste',
  // Ahead of Markdown's paste handler, at 110, and the image node's, so they paste into the content.
  priority: 111,

  addOptions() {
    return { persist: false, openClassName: 'is-open' };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: detailsPastePluginKey,
        props: {
          handlePaste: (view, event, slice) => {
            const { $from, $to } = view.state.selection;
            if ($from.parent.type.name === 'detailsSummary' && $from.sameParent($to) && bringsBlocks(view, event, slice)) {
              enterContent(view, options);
            }
            // The paste runs on at the selection, which is now in the content.
            return false;
          },
        },
      }),
    ];
  },
});
