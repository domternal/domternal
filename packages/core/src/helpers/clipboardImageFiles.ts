/**
 * When a paste's image files are the paste. Office applications and Google Docs put a picture of
 * the copied selection next to its HTML, so a paste whose content has text of its own keeps that
 * content and ignores the files. A paste whose content has no text of its own, such as a copied
 * image (an `<img>` with its file) or a screenshot, inserts the files instead. One rule, decided
 * here, so the paste handlers of Image, PasteCleanup and Link cannot disagree.
 */
import type { Slice } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import { getClipboardPasteBehavior } from './clipboardPasteBehavior.js';
import { clipboardImageFileDestination } from './clipboardImageDestination.js';

/** @experimental Image files a paste hands to the view's image destination. */
export interface ClipboardImageFileInsertion {
  /** The clipboard's image files, in clipboard order. */
  readonly files: readonly File[];
  /** The alt text of the one image the pasted content held, when there is one image and one file. */
  readonly alt?: string;
  /** Where a drop puts the files; without it, a paste replaces the selection. */
  readonly position?: number;
}

/** @experimental Options of the paste file rule. */
export interface ClipboardPasteTextOptions {
  /**
   * The alt texts of images a paste handler removed and left as text in the slice, in document
   * order. They stand in for images, so they are not text of the content's own.
   */
  readonly imageStandIns?: readonly string[];
}

// White space (NBSP, BOM and the ideographic space included) and Unicode format characters
// (zero-width spaces and joiners, the word joiner, the soft hyphen, direction marks and bidi
// controls) show nothing a reader would miss.
const INVISIBLE = /[\s\p{Cf}]/gu;

const visible = (text: string): string => text.replace(INVISIBLE, '');

/** The text of the slice's text nodes in document order. Alt attributes are not text. */
function sliceText(slice: Slice): string {
  let text = '';
  slice.content.descendants(node => {
    if (node.isText) text += node.text ?? '';
  });
  return text;
}

function hasType(data: DataTransfer, type: string): boolean {
  try {
    return Array.from(data.types).includes(type);
  } catch {
    return false;
  }
}

/**
 * The image files of a clipboard in clipboard order: file items whose file or item
 * type is an image type, each file once. `items` is read when the clipboard has it, `files` otherwise.
 */
function clipboardImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files: File[] = [];
  const add = (file: File | null | undefined, itemType = ''): void => {
    if (!file || files.includes(file)) return;
    if (file.type.startsWith('image/') || (file.type === '' && itemType.startsWith('image/'))) files.push(file);
  };
  try {
    // A clipboard without items, such as an older or synthetic DataTransfer, lists its files only.
    const items = data.items as DataTransferItemList | null | undefined;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file') add(item.getAsFile(), item.type);
      }
      return files;
    }
    for (const file of Array.from(data.files)) add(file);
  } catch {
    return [];
  }
  return files;
}

/**
 * @experimental Whether a paste's content has text of its own, so the clipboard's image files are
 * ignored. Characters that show nothing (white space and Unicode format characters) do not count,
 * nor alt text a handler left in place of images it removed (`imageStandIns`), nor a plain-text
 * clipboard without HTML whose lines are exactly the names of its image files, as file managers
 * copy files.
 */
export function pasteHasOwnText(event: ClipboardEvent, slice: Slice, options: ClipboardPasteTextOptions = {}): boolean {
  const own = visible(sliceText(slice));
  if (own === '') return false;
  const standIns = visible((options.imageStandIns ?? []).join(''));
  if (standIns !== '' && own === standIns) return false;
  const data = event.clipboardData;
  if (data && !hasType(data, 'text/html')) {
    const files = clipboardImageFiles(data);
    const lines = data.getData('text/plain').split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => line !== '');
    if (files.length > 0 && lines.length === files.length && lines.every((line, index) => line === files[index]?.name)) return false;
  }
  return true;
}

/** The alt text of the one image the pasted content held, for one file. */
function singleAlt(slice: Slice, nodeTypeName: string, standIns: readonly string[]): string | undefined {
  const alts: unknown[] = [];
  slice.content.descendants(node => {
    if (node.type.name === nodeTypeName) alts.push(node.attrs['alt']);
  });
  if (alts.length === 1) return typeof alts[0] === 'string' && alts[0] !== '' ? alts[0] : undefined;
  if (alts.length === 0 && standIns.length === 1 && standIns[0] !== '') return standIns[0];
  return undefined;
}

/**
 * @experimental Hands the clipboard's image files to the view's image destination when they are
 * the paste: the event carries image files, no handler has taken its assets, and the content has
 * no text of its own. With one file and one image in the content, the file keeps that image's alt
 * text. Returns whether the destination took the files; a paste handler then returns true, so
 * the files replace the content. Returns false without a destination that inserts files.
 */
export function pasteClipboardImageFiles(
  view: EditorView,
  event: ClipboardEvent,
  slice: Slice,
  options: ClipboardPasteTextOptions = {},
): boolean {
  if (getClipboardPasteBehavior(view, event)?.assetsAlreadyHandled === true) return false;
  const files = clipboardImageFiles(event.clipboardData);
  if (files.length === 0 || pasteHasOwnText(event, slice, options)) return false;
  const destination = clipboardImageFileDestination(view);
  if (destination === undefined) return false;
  const alt = files.length === 1 ? singleAlt(slice, destination.nodeTypeName, options.imageStandIns ?? []) : undefined;
  try {
    return destination.insertFiles(Object.freeze({ files: Object.freeze(files), ...(alt === undefined ? {} : { alt }) }));
  } catch {
    return false;
  }
}

/**
 * @experimental Hands the image files of a drop to the view's image destination at the drop
 * position. A drop's files win over the HTML or text it carries, since an operating system's file
 * drag carries only a name as text; with one file and one image in the dropped content, the file
 * keeps that image's alt text. Returns whether the destination took the files. A drag inside the
 * editor moves its own content and carries no files.
 */
export function dropClipboardImageFiles(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  options: ClipboardPasteTextOptions = {},
): boolean {
  const files = clipboardImageFiles(event.dataTransfer);
  if (files.length === 0) return false;
  const destination = clipboardImageFileDestination(view);
  if (destination === undefined) return false;
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!at) return false;
  const alt = files.length === 1 ? singleAlt(slice, destination.nodeTypeName, options.imageStandIns ?? []) : undefined;
  try {
    return destination.insertFiles(Object.freeze({ files: Object.freeze(files), position: at.pos, ...(alt === undefined ? {} : { alt }) }));
  } catch {
    return false;
  }
}
