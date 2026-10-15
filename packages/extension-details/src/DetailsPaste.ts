/**
 * Pasting blocks into a details summary.
 *
 * The summary holds text only, and ProseMirror's paste fitted blocks there by closing the
 * details and opening a new one: the summary's text after the caret and the original content
 * moved into a second details with an empty summary, collapsed and so hidden. A paste that
 * brings blocks goes where Enter in the summary puts the caret instead, a new block at the start
 * of the content, which opens. The block and the paste are one transaction, so a paste that a
 * transaction filter refuses, or that Paste Cleanup checks against the document it captured,
 * finds the document as it was, and undo takes both back in one step. The paste handlers that
 * build their own transaction, Markdown's, SmartPaste and the image node's, start it from the
 * placement registered here; this extension's handler places a paste none of them took, as
 * ProseMirror's own paste would. Inline content, a single paragraph or heading, text copied from
 * inside a code block, and text copied from inside a list item, quote, table cell or another
 * summary still join the summary's text.
 */
import { Extension, defaultBlockAt } from '@domternal/core';
import { registerClipboardPastePlacement } from '@domternal/core/clipboard';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { Slice } from '@domternal/pm/model';
import type { Fragment, Node as PMNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

export interface DetailsPasteOptions {
  /** The `persist` option of Details: whether the document keeps the open state. */
  persist: boolean;
  /** The `openClassName` option of Details. */
  openClassName: string;
}

/** A request to open the details at `pos` once the transaction that carries it applies. */
interface OpenRequest {
  readonly id: number;
  readonly pos: number;
}

export const detailsPastePluginKey = new PluginKey<OpenRequest | null>('detailsPaste');

let openRequests = 0;

/** A textblock whose text joins a summary's text: one that is not code, whose lines a summary cannot hold. */
const isLine = (node: PMNode | null): boolean => node?.isTextblock === true && node.type.spec.code !== true;

/** Whether whole nodes pasted into a summary bring blocks: a block other than such a textblock, or more than one block. */
function bringsBlocks(content: Fragment): boolean {
  let blocks = 0;
  for (let index = 0; index < content.childCount; index++) {
    const node = content.child(index);
    if (node.isBlock && (!isLine(node) || ++blocks > 1)) return true;
  }
  return false;
}

/**
 * The slice without the nodes around inline content that a copy from inside a list item, quote,
 * table cell or another summary rebuilds: one node open on both sides, level by level, down to a
 * textblock.
 */
function innerSlice(slice: Slice): Slice {
  let { content, openStart, openEnd } = slice;
  for (let node = content.firstChild; content.childCount === 1 && node !== null && openStart > 0 && openEnd > 0
    && !node.isTextblock && !node.isLeaf; node = content.firstChild) {
    content = node.content;
    openStart--;
    openEnd--;
  }
  return new Slice(content, openStart, openEnd);
}

const isEmptyTextblock = (node: PMNode): boolean => node.isTextblock && node.content.size === 0;

/**
 * The one textblock a paste holds between empty ones, such as a line copied with its line break,
 * which ProseMirror parses as the line and an empty paragraph after it; undefined when it holds
 * anything else.
 */
function soleTextblock(content: Fragment): PMNode | undefined {
  let first = 0;
  let last = content.childCount - 1;
  while (first < last && isEmptyTextblock(content.child(first))) first++;
  while (last > first && isEmptyTextblock(content.child(last))) last--;
  const node = content.maybeChild(first);
  return first === last && node !== null && isLine(node) ? node : undefined;
}

/** Whether a fragment holds inline content only. */
function isInline(content: Fragment): boolean {
  for (let index = 0; index < content.childCount; index++) if (!content.child(index).isInline) return false;
  return true;
}

/** A selection confined to one summary, or ending in that same disclosure's content. */
function summaryRange(selection: Selection): 'summary' | 'content' | undefined {
  const { $from, $to } = selection;
  if ($from.parent.type.name !== 'detailsSummary' || $from.depth < 2) return undefined;
  if ($from.sameParent($to)) return 'summary';
  return $to.depth >= $from.depth && $to.node($from.depth).type.name === 'detailsContent'
    && $to.before($from.depth) === $from.after() ? 'content' : undefined;
}

/**
 * Put a summary paste in a new body block, or replace a selection crossing into that body
 * without splitting the disclosure. Keep the existing body tail for ordinary slice fitting.
 * Return undefined for another selection or a body that cannot hold the required block.
 */
function enterContent(state: EditorState, persist: boolean, tr = state.tr): Transaction | undefined {
  const range = summaryRange(tr.selection);
  if (range === undefined) return undefined;
  const { $from, $to } = tr.selection;
  const detailsPos = $from.before(-1);
  let contentPos: number;
  if (range === 'content') {
    const before = $from.after();
    const step = tr.steps.length;
    // Delete the two selected text ranges without joining the isolating summary and content.
    // The remaining body tail then uses the ordinary paste fitting at its own start.
    const body = tr.doc.nodeAt(before);
    if (body?.type.name !== 'detailsContent') return undefined;
    if (body.firstChild?.isTextblock !== true) {
      const type = defaultBlockAt(body.contentMatchAt(0));
      const block = type?.createAndFill();
      if (!type || !block || !body.canReplaceWith(0, 0, type)) return undefined;
      tr.insert(before + 1, block);
    }
    const end = tr.mapping.slice(step).map($to.pos);
    // Start inside the first block so deleting its last character does not also remove the
    // unselected boundary before the following block.
    tr.delete(before + 2, end);
    tr.delete($from.pos, $from.end());
    contentPos = tr.mapping.slice(step).map(before);
  } else {
    if (!tr.selection.empty) tr.deleteSelection();
    contentPos = tr.selection.$head.after();
  }
  const content = tr.doc.nodeAt(contentPos);
  if (content?.type.name !== 'detailsContent') return undefined;
  if (range !== 'content' || content.firstChild?.isTextblock !== true) {
    const type = defaultBlockAt(content.contentMatchAt(0));
    const block = type?.createAndFill();
    if (!type || !block || !content.canReplaceWith(0, 0, type)) return undefined;
    tr.insert(contentPos + 1, block);
  }
  tr.setSelection(Selection.near(tr.doc.resolve(contentPos + 2)));
  const details = tr.doc.nodeAt(detailsPos);
  if (persist && details && details.attrs['open'] !== true) tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true });
  // Open only after the transaction applies, so a refused paste leaves the disclosure closed.
  return tr.setMeta('detailsEnterOpen', true).setMeta(detailsPastePluginKey, { pos: detailsPos, step: tr.steps.length });
}

/**
 * ProseMirror may drag a node without making it the current selection. Its optional private
 * node field is only a candidate: require the current document and the exact public dragged
 * slice before deleting anything. Unknown or stale drag state stays with the native handler.
 */
function draggedSelection(view: EditorView): Selection | undefined {
  const dragging = view.dragging;
  if (dragging === null) return undefined;
  const node: unknown = Object.getOwnPropertyDescriptor(dragging, 'node')?.value;
  const selection = node === undefined ? view.state.selection : node instanceof NodeSelection ? node : undefined;
  if (selection?.$from.doc !== view.state.doc || selection.empty
    || selection.from < 0 || selection.to > view.state.doc.content.size) return undefined;
  return selection.content().eq(dragging.slice) ? selection : undefined;
}

/** Opens the details whose node view is at `pos`, as its toggle button does. */
function openDetails(view: EditorView, pos: number, openClassName: string): void {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement) || dom.classList.contains(openClassName)) return;
  dom.classList.add(openClassName);
  dom.querySelector(':scope > button')?.setAttribute('aria-expanded', 'true');
  dom.querySelector('[data-details-content]')?.dispatchEvent(new Event('toggleDetailsContent'));
}

export const DetailsPaste = Extension.create<DetailsPasteOptions>({
  name: 'detailsPaste',
  // After Markdown's paste handler, at 110, and SmartPaste's and the image node's, at 100: they
  // place what they insert through the placement below, and this handler places what none of
  // them took.
  priority: 90,

  addOptions() {
    return { persist: false, openClassName: 'is-open' };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<OpenRequest | null>({
        key: detailsPastePluginKey,
        state: {
          init: () => null,
          apply(tr, request) {
            const meta = tr.getMeta(detailsPastePluginKey) as { pos: number; step: number } | undefined;
            if (meta !== undefined) return { id: ++openRequests, pos: tr.mapping.slice(meta.step).map(meta.pos) };
            return request !== null && tr.docChanged ? { id: request.id, pos: tr.mapping.map(request.pos) } : request;
          },
        },
        view: editorView => {
          const unregister = registerClipboardPastePlacement(editorView, (view, content) =>
            summaryRange(view.state.selection) === 'content' || bringsBlocks(content) ? enterContent(view.state, options.persist) : undefined);
          return {
            update(view, previous) {
              const request = detailsPastePluginKey.getState(view.state);
              if (options.persist || !request || request.id === detailsPastePluginKey.getState(previous)?.id) return;
              openDetails(view, request.pos, options.openClassName);
            },
            destroy: unregister,
          };
        },
        props: {
          handleDrop: (view, event, slice, moved) => {
            if (!view.editable || slice.size === 0) return false;
            const wholeBlock = slice.openStart === 0 && slice.openEnd === 0 && slice.content.firstChild?.isBlock === true;
            if (!wholeBlock && !bringsBlocks(innerSlice(slice).content)) return false;
            const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (target === null || target.pos < 0 || target.pos > view.state.doc.content.size) return false;
            const $target = view.state.doc.resolve(target.pos);
            if ($target.parent.type.name !== 'detailsSummary') return false;
            const tr = view.state.tr;
            if (moved) {
              const selection = draggedSelection(view);
              if (selection === undefined || (target.pos >= selection.from && target.pos <= selection.to)) return false;
              selection.replace(tr);
            }
            const at = tr.mapping.map(target.pos);
            const $at = tr.doc.resolve(at);
            if ($at.parent.type.name !== 'detailsSummary') return false;
            tr.setSelection(TextSelection.create(tr.doc, at));
            const placed = enterContent(view.state, options.persist, tr);
            if (placed === undefined) return false;
            placed.replaceSelection(slice);
            view.dispatch(placed.scrollIntoView().setMeta('uiEvent', 'drop'));
            view.focus();
            return true;
          },
          handlePaste: (view, _event, slice) => {
            const range = summaryRange(view.state.selection);
            if (range === undefined) return false;
            const inner = innerSlice(slice);
            const { content } = inner;
            const only = content.childCount === 1 ? content.firstChild : null;
            // Inline content, and one textblock, join the summary's text through ProseMirror's paste:
            // a code block only as text copied from inside it, since a summary holds no lines.
            if (range === 'summary' && (isInline(content) || (only?.isTextblock === true && (isLine(only) || (inner.openStart > 0 && inner.openEnd > 0))))) return false;
            const line = range === 'summary' ? soleTextblock(content) : undefined;
            const tr = line === undefined ? enterContent(view.state, options.persist) : view.state.tr;
            if (tr === undefined) return false;
            // A line between empty blocks joins the summary's text too; anything else goes into the content.
            tr.replaceSelection(line === undefined ? slice : new Slice(line.content, 0, 0));
            view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
            return true;
          },
        },
      }),
    ];
  },
});
