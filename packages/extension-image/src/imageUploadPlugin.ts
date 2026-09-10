/**
 * Image file insertion
 *
 * Inserts pasted, dropped and chosen image files. Each accepted file gets a
 * placeholder, a widget decoration that shows a loading indicator, so the
 * document never holds temporary data. The file is stored through the
 * `uploadHandler`, or read as a data URL when `allowBase64` allows it, and
 * the images replace their placeholders in the order the files came, however
 * the stores finish. A failed store removes its placeholder and calls
 * `onUploadError`; an image whose placeholder was deleted is dropped.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import type { EditorView } from '@domternal/pm/view';
import type { NodeType, Slice } from '@domternal/pm/model';

export const imageUploadPluginKey = new PluginKey<DecorationSet>('imageUpload');

/** How the images of a batch are placed: over the selection, or at a drop position. */
export type ImageFilePlacement = { readonly at: 'selection' } | { readonly at: 'position'; readonly pos: number };

export interface ImageFileInsertionOptions {
  /** The image node type from the schema. */
  nodeType: NodeType;
  /** Stores a file and returns its source; null when files cannot be stored. Read for each insertion. */
  store: () => ((file: File) => Promise<string>) | null;
  /** Whether a file is one the configuration accepts: its type and size. */
  accepts: (file: File) => boolean;
  /** Whether a stored source may be inserted, as setImage decides. */
  allowsSource: (src: string) => boolean;
  /** Called when a store through the uploadHandler starts. */
  onUploadStart: () => ((file: File) => void) | null;
  /** Called when a store fails or returns a refused source. */
  onUploadError: () => ((error: Error, file: File) => void) | null;
}

interface Entry {
  readonly id: string;
  readonly file: File;
  readonly alt: string | undefined;
  status: 'pending' | 'stored' | 'failed';
  src?: string;
}

interface Batch {
  readonly entries: Entry[];
  /** The index of the first entry not placed yet. */
  next: number;
}

type Action =
  | { type: 'add'; placeholders: readonly { id: string; pos: number }[] }
  | { type: 'settle'; remove: readonly string[]; place: readonly { id: string; pos: number }[] };

let placeholderCounter = 0;
function createPlaceholderId(): string {
  return `image-upload-${String(++placeholderCounter)}`;
}

/** Reset placeholder counter (for testing) */
export function _resetPlaceholderCounter(): void {
  placeholderCounter = 0;
}

function createPlaceholderElement(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'domternal-image-uploading';
  return div;
}

function placeholder(pos: number, id: string): Decoration {
  return Decoration.widget(pos, createPlaceholderElement, { id, side: -1 });
}

const byId = (id: string) => (spec: { id?: string }): boolean => spec.id === id;

/** The position of a placeholder, or undefined once it is gone. */
function placeholderPos(state: EditorState, id: string): number | undefined {
  return imageUploadPluginKey.getState(state)?.find(undefined, undefined, byId(id))[0]?.from;
}

/** Rich clipboard text belongs to the parsed slice, not a separate image insertion. */
export function hasPastedText(slice: Slice | undefined): boolean {
  let found = false;
  slice?.content.descendants(node => {
    if (found) return false;
    // Image alt text is not a text node and must not disable screenshot paste.
    if (node.isText && (node.text ?? '').trim() !== '') found = true;
    return !found;
  });
  return found;
}

/**
 * The alt text of the one image a pasted or dropped slice held, for one file:
 * the file stands for that image.
 */
export function singleImageAlt(slice: Slice | undefined, nodeType: NodeType): string | undefined {
  if (slice === undefined) return undefined;
  const alts: unknown[] = [];
  slice.content.descendants(node => {
    if (node.type === nodeType) alts.push(node.attrs['alt']);
  });
  return alts.length === 1 && typeof alts[0] === 'string' && alts[0] !== '' ? alts[0] : undefined;
}

export interface ImageFileInsertion {
  plugin: Plugin<DecorationSet>;
  /** Whether files can be stored at all, so a paste or drop of files is taken. */
  canStore: () => boolean;
  /**
   * Inserts the accepted files in order, with `alt` on the image when there is
   * one file. Returns false when files cannot be stored or none is accepted.
   */
  insert: (view: EditorView, files: readonly File[], placement: ImageFilePlacement, alt?: string) => boolean;
}

export function imageFileInsertion(options: ImageFileInsertionOptions): ImageFileInsertion {
  const { nodeType } = options;

  /** Places the settled images at the front of the batch, in order, in one transaction. */
  function flush(view: EditorView, batch: Batch): void {
    if (view.isDestroyed) return;
    const { state } = view;
    const tr = state.tr;
    // The remaining placeholders of the batch, in the coordinates of tr.doc.
    const positions = new Map<string, number>();
    for (const entry of batch.entries.slice(batch.next)) {
      const pos = placeholderPos(state, entry.id);
      if (pos !== undefined) positions.set(entry.id, pos);
    }
    const removed: string[] = [];
    let inserted = false;
    while (batch.next < batch.entries.length) {
      const entry = batch.entries[batch.next];
      if (entry === undefined || entry.status === 'pending') break;
      batch.next++;
      removed.push(entry.id);
      const pos = positions.get(entry.id);
      positions.delete(entry.id);
      if (pos === undefined || entry.status === 'failed' || entry.src === undefined) continue;
      const node = nodeType.create({ src: entry.src, ...(entry.alt === undefined ? {} : { alt: entry.alt }) });
      const before = tr.steps.length;
      // A block image moves out of a textblock's start or end instead of splitting it.
      if (nodeType.isInline) tr.insert(pos, node);
      else tr.replaceRangeWith(pos, pos, node);
      if (tr.steps.length === before) continue;
      inserted = true;
      let end = pos;
      tr.mapping.maps[tr.mapping.maps.length - 1]?.forEach((_oldStart, _oldEnd, _newStart, newEnd) => { end = newEnd; });
      const steps = tr.mapping.slice(before);
      // A placeholder at the insertion point follows the image, so the next one lands after it.
      for (const [id, at] of positions) positions.set(id, at === pos ? end : steps.map(at));
    }
    if (removed.length === 0) return;
    const place = [...positions].map(([id, pos]) => ({ id, pos }));
    tr.setMeta(imageUploadPluginKey, { type: 'settle', remove: removed, place } satisfies Action);
    if (!inserted) tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  }

  function settle(view: EditorView, batch: Batch, entry: Entry, result: { src: string } | { error: Error }): void {
    if ('src' in result) {
      entry.status = 'stored';
      entry.src = result.src;
    } else {
      entry.status = 'failed';
      options.onUploadError()?.(result.error, entry.file);
    }
    flush(view, batch);
  }

  const plugin = new Plugin<DecorationSet>({
    key: imageUploadPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, decorations: DecorationSet) {
        let next = decorations.map(tr.mapping, tr.doc);
        const action = tr.getMeta(imageUploadPluginKey) as Action | undefined;
        if (action?.type === 'add') {
          next = next.add(tr.doc, action.placeholders.map(({ id, pos }) => placeholder(pos, id)));
        } else if (action?.type === 'settle') {
          const gone = new Set([...action.remove, ...action.place.map(({ id }) => id)]);
          next = next.remove(next.find(undefined, undefined, (spec: { id?: string }) => spec.id !== undefined && gone.has(spec.id)));
          next = next.add(tr.doc, action.place.map(({ id, pos }) => placeholder(pos, id)));
        }
        return next;
      },
    },
    props: {
      decorations: state => imageUploadPluginKey.getState(state),
    },
  });

  const canStore = (): boolean => options.store() !== null;

  function insert(view: EditorView, files: readonly File[], placement: ImageFilePlacement, alt?: string): boolean {
    const store = options.store();
    const accepted = files.filter(file => options.accepts(file));
    if (store === null || accepted.length === 0 || view.isDestroyed) return false;
    const tr = view.state.tr;
    let pos: number;
    if (placement.at === 'selection') {
      if (!tr.selection.empty) tr.deleteSelection();
      pos = tr.selection.from;
    } else {
      pos = placement.pos;
    }
    const entries: Entry[] = accepted.map(file => ({
      id: createPlaceholderId(), file, status: 'pending',
      alt: accepted.length === 1 ? alt : undefined,
    }));
    tr.setMeta(imageUploadPluginKey, { type: 'add', placeholders: entries.map(({ id }) => ({ id, pos })) } satisfies Action);
    // Placeholders alone are not an edit to undo; a replaced selection is.
    if (!tr.docChanged) tr.setMeta('addToHistory', false);
    view.dispatch(tr);
    const batch: Batch = { entries, next: 0 };
    const start = options.onUploadStart();
    for (const entry of entries) {
      start?.(entry.file);
      let stored: Promise<string>;
      try {
        stored = store(entry.file);
      } catch (error) {
        stored = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      stored.then(
        src => {
          if (typeof src === 'string' && options.allowsSource(src)) settle(view, batch, entry, { src });
          else settle(view, batch, entry, { error: new RangeError('The stored image source is not allowed') });
        },
        (error: unknown) => { settle(view, batch, entry, { error: error instanceof Error ? error : new Error(String(error)) }); },
      );
    }
    return true;
  }

  return { plugin, canStore, insert };
}

