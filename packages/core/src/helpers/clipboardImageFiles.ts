/**
 * When a paste's image files are the paste. Office applications put a picture of the copied
 * selection next to its HTML, so a paste whose content has text of its own keeps that
 * content and ignores the files, and so does a Word or Excel copy that places no image, such as a
 * selection of empty paragraphs or cells. A paste whose content has no text of its own, such as a
 * copied image (an `<img>` with its file) or a screenshot, inserts the files instead. One rule,
 * decided here, so the paste handlers of Image, PasteCleanup and Link cannot disagree.
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
  /**
   * Whether a handler removed text of the content's own that it does not paste, such as a Word document's hidden
   * text. The content then had text of its own, whatever the slice holds, so the clipboard's image files, which can
   * be the application's picture of a selection showing that text, are not the paste.
   */
  readonly removedText?: boolean;
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

/** An absolute file path: POSIX, home-relative, a Windows drive or a network share. */
const FILE_PATH = /^(?:\/|~\/|[a-z]:[\\/]|\\\\)/i;

/**
 * The file name a plain-text clipboard line stands for, as file managers write a copied file: the
 * name itself, an absolute path, or a `file:` URL, whose name is percent-decoded. Any other line,
 * such as a web address, stands for itself. Compared in Unicode NFC, since macOS writes accented
 * names decomposed in one flavor and composed in another.
 */
function lineFileName(line: string): string {
  const url = /^file:/i.test(line);
  if (!url && !FILE_PATH.test(line)) return line.normalize('NFC');
  let name = line.slice(Math.max(line.lastIndexOf('/'), line.lastIndexOf('\\')) + 1);
  if (url) {
    try { name = decodeURIComponent(name); } catch { return ''; }
  }
  return name.normalize('NFC');
}

// Word and Excel declare their namespaces on the root element and name themselves in a ProgId meta, at the
// start of the HTML they copy.
const OFFICE_HEAD = 8_192;
const OFFICE_NAMESPACE = /\bxmlns:[\w-]{1,32}[\t\n\f\r ]*=[\t\n\f\r ]*["']?urn:schemas-microsoft-com:office:(?:word|excel)\b/i;
const META = /<meta\b[^<>]{0,512}>/gi;
const PROG_ID = /\bname[\t\n\f\r ]*=[\t\n\f\r ]*["']?ProgId\b/i;
const OFFICE_PROG_ID = /\bcontent[\t\n\f\r ]*=[\t\n\f\r ]*["']?(?:Word\.Document|Excel\.Sheet)\b/i;
// An image the copied content places: an img element, the downlevel copy of a VML shape included, or a VML shape's image data.
const PLACED_IMAGE = /<(?:img|v:imagedata)\b/i;

/**
 * Whether the clipboard's HTML is a Word or Excel document that places no image. Its clipboard image
 * files are then the application's picture of the selection, as Chrome exposes Word's, not content.
 */
function officeSelectionPicture(data: DataTransfer | null | undefined): boolean {
  if (!data || !hasType(data, 'text/html')) return false;
  let html: string;
  try {
    html = data.getData('text/html');
  } catch {
    return false;
  }
  const head = html.slice(0, OFFICE_HEAD);
  const office = OFFICE_NAMESPACE.test(head) || Array.from(head.matchAll(META)).some(([tag]) => PROG_ID.test(tag) && OFFICE_PROG_ID.test(tag));
  return office && !PLACED_IMAGE.test(html);
}

/**
 * @experimental Whether a paste's content has text of its own, so the clipboard's image files are
 * ignored. Characters that show nothing (white space and Unicode format characters) do not count,
 * nor alt text a handler left in place of images it removed (`imageStandIns`), nor a plain-text
 * clipboard without HTML whose lines name its image files in order, as file managers copy files:
 * each line the file's name, its absolute path or its `file:` URL, in any Unicode normalization
 * form. A web address that ends in the name stays text. Content without text of its own still
 * counts as the paste when the HTML is a Word or Excel document that places no image, such as a
 * copy of empty paragraphs or cells: the image file next to it is the application's picture of
 * the selection, which Chrome exposes for Word. Text a handler removed (`removedText`), such as Word's hidden
 * text, counts as text of its own: a picture of the selection can show it.
 */
export function pasteHasOwnText(event: ClipboardEvent, slice: Slice, options: ClipboardPasteTextOptions = {}): boolean {
  if (options.removedText === true) return true;
  const own = visible(sliceText(slice));
  if (own === '') return officeSelectionPicture(event.clipboardData);
  const standIns = visible((options.imageStandIns ?? []).join(''));
  if (standIns !== '' && own === standIns) return false;
  const data = event.clipboardData;
  if (data && !hasType(data, 'text/html')) {
    const files = clipboardImageFiles(data);
    const lines = data.getData('text/plain').split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => line !== '');
    if (files.length > 0 && lines.length === files.length
      && lines.every((line, index) => lineFileName(line) === files[index]?.name.normalize('NFC'))) return false;
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
 * editor moves its own content and carries no files. A drop whose content held text a handler removed
 * (`removedText`), such as Word's hidden text, hands over no files: they can picture that text.
 */
export function dropClipboardImageFiles(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  options: ClipboardPasteTextOptions = {},
): boolean {
  if (options.removedText === true) return false;
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
