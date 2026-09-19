/**
 * Clipboard data as a paste hands it to an editor's paste handlers, for tests.
 *
 * A slice built with `DOMParser.parse(...).slice(...)` is closed. A paste's slice often is not:
 * ProseMirror's clipboard parse leaves it open where the copied HTML starts or ends inside a
 * node, rebuilds the context a `data-pm-slice` marker records around it, and runs every
 * `transformPastedHTML`, `transformPastedText` and `transformPasted` prop first. A test that
 * hands a handler a slice built by hand never sees those slices, so tests of paste handlers take
 * their slices, and their clipboard events, from here.
 */
import type { Slice } from '@domternal/pm/model';
import type { DirectEditorProps, EditorView } from '@domternal/pm/view';

/** What a clipboard holds: its HTML and plain text flavors and its files, each optional. */
export interface ClipboardContent {
  readonly html?: string;
  readonly text?: string;
  readonly files?: readonly File[];
}

/** The HTML and plain text an editor's copy writes. */
export interface CopiedClipboard {
  readonly html: string;
  readonly text: string;
}

/**
 * A paste, copy or cut event whose `clipboardData` holds `content`, as a browser's keyboard
 * paste carries it. jsdom has no DataTransfer, so a minimal one stands in: the text flavors
 * through `getData`, `setData` and `clearData`, the files through `files` and `items`.
 */
export function clipboardEvent(content: ClipboardContent = {}, type: 'paste' | 'copy' | 'cut' = 'paste'): ClipboardEvent {
  const flavors = new Map<string, string>();
  if (content.html !== undefined) flavors.set('text/html', content.html);
  if (content.text !== undefined) flavors.set('text/plain', content.text);
  const files = [...(content.files ?? [])];
  const clipboardData = {
    get types(): string[] {
      return [...flavors.keys(), ...(files.length > 0 ? ['Files'] : [])];
    },
    get items(): { kind: string; type: string; getAsFile: () => File | null; getAsString: (callback: (value: string) => void) => void }[] {
      return [
        ...[...flavors].map(([format, value]) => ({
          kind: 'string', type: format, getAsFile: () => null, getAsString: (callback: (text: string) => void) => { callback(value); },
        })),
        ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file, getAsString: () => undefined })),
      ];
    },
    files,
    getData: (format: string): string => flavors.get(format) ?? '',
    setData: (format: string, value: string): void => { flavors.set(format, value); },
    clearData: (): void => { flavors.clear(); },
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  return event as ClipboardEvent;
}

/**
 * Pastes `content` as a keyboard paste does: a paste event on the editor's DOM, through the DOM
 * paste handlers, every clipboard transform, the clipboard parse and every paste handler.
 * Returns the event, whose `defaultPrevented` says whether the editor took the paste.
 */
export function pasteClipboard(view: EditorView, content: ClipboardContent): ClipboardEvent {
  const event = clipboardEvent(content);
  view.dom.dispatchEvent(event);
  return event;
}

/**
 * The slice the editor's paste handlers receive for `content` at the current selection, after
 * everything a keyboard paste runs before them. Nothing is inserted: a direct `handlePaste`
 * prop, which runs before every plugin's, takes the paste.
 */
export function pastedSlice(view: EditorView, content: ClipboardContent): Slice {
  let captured: Slice | undefined;
  const restore = { handlePaste: view.props.handlePaste } as unknown as Partial<DirectEditorProps>;
  view.setProps({ handlePaste: (_view, _event, slice) => { captured = slice; return true; } });
  try {
    pasteClipboard(view, content);
  } finally {
    view.setProps(restore);
  }
  if (captured === undefined) throw new Error('The paste reached no paste handler');
  return captured;
}

/**
 * What the editor's copy writes for the current selection, through its copy handler: the HTML
 * with its slice marker and any copy annotation, and the plain text.
 */
export function copySelection(view: EditorView): CopiedClipboard {
  const event = clipboardEvent({}, 'copy');
  view.dom.dispatchEvent(event);
  const data = event.clipboardData;
  if (data === null || !event.defaultPrevented) throw new Error('The editor copied nothing: is the selection empty?');
  return { html: data.getData('text/html'), text: data.getData('text/plain') };
}

/** A slice as `openStart openEnd content`, for assertions. */
export function describeSlice(slice: Slice): string {
  return `${String(slice.openStart)} ${String(slice.openEnd)} ${slice.content.toString()}`;
}
