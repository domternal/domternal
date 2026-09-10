/**
 * Block (default) or inline image element.
 *
 * Sources go through the core URL policy, which reads an address the way
 * browsers do: javascript:, vbscript:, file:, credentials in a web address
 * and hidden characters are refused, and data: URLs need `allowBase64` and an image
 * media type. Checked in parseHTML, renderHTML, the node view, the
 * `setImage` command and the input rule (defense in depth).
 */

import { Node, PluginKey, checkUrl, positionFloating, defaultIcons, splitListForInsert, copyThemeClass, localizedLabel, localizeMessage, coreMessages } from '@domternal/core';
import { dropClipboardImageFiles, getClipboardPasteBehavior, pasteClipboardImageFiles, registerClipboardImageDestination } from '@domternal/core/clipboard';
import type { Editor, CommandSpec, ToolbarItem, FloatingMenuItem, I18nService } from '@domternal/core';
import { Plugin, NodeSelection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { InputRule } from '@domternal/pm/inputrules';
import type { Node as PmNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import { imageMessages } from './messages.js';
import { imageFileInsertion } from './imageUploadPlugin.js';

/** Float values for image text wrapping. */
export type ImageFloat = 'none' | 'left' | 'right' | 'center';

/**
 * Where a picture sits in the measure, WITHOUT text beside it: the Notion
 * behaviour, and the one that survives a page format unchanged, since
 * alignment is a paragraph property in both Word and the PDF while wrapping
 * is a layout the two formats support to different depths.
 */
export type ImageAlign = 'none' | 'left' | 'center' | 'right';

/**
 * Which placement control the image bubble menu offers.
 *
 * The two are mutually exclusive on a node, and deliberately separate
 * attributes rather than one attribute rendered differently per preset: the
 * document has to record which of the two the author actually saw, or an
 * export (which reads attributes, not presets) cannot tell a wrapped picture
 * from an aligned one.
 */
export type ImagePlacement = 'float' | 'align';

/**
 * Typed options for the setImage command.
 * src is required - it makes no sense to insert an image without a source URL.
 */
export interface SetImageOptions {
  src: string;
  alt?: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  loading?: 'lazy' | 'eager';
  crossorigin?: 'anonymous' | 'use-credentials';
  float?: ImageFloat;
  align?: ImageAlign;
}

declare module '@domternal/core' {
  interface RawCommands {
    setImage: CommandSpec<[attributes: SetImageOptions]>;
    setImageFloat: CommandSpec<[float: ImageFloat]>;
    setImageAlign: CommandSpec<[align: ImageAlign]>;
    deleteImage: CommandSpec;
  }
}

/**
 * The spelling of an image source to store, render and load, as the core URL
 * policy's image profile reads it: any scheme except the script schemes and
 * `file:`, relative and network-path sources, and `data:image/...` only with
 * `allowBase64`. `null` means no source, which `null` and `''` stand for, and
 * `undefined` a refused source.
 */
function imageSource(value: unknown, allowBase64: boolean): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const check = checkUrl(value, { protocols: 'any', allowRelative: true, allowNetworkPath: true, allowDataImages: allowBase64 });
  return check.status === 'allowed' ? check.url : undefined;
}

/**
 * Sources already judged, by the attributes object of the node that holds
 * them and by `allowBase64`. An unchanged node keeps its attributes object,
 * so rendering a document again, as getHTML does on every change, does not
 * judge a long data image again, and the cache lets go of a source when its
 * node goes.
 */
const judgedWithData = new WeakMap<object, string | null | undefined>();
const judgedWithoutData = new WeakMap<object, string | null | undefined>();

/** The source of an image node's attributes, as {@link imageSource} judges it. */
function nodeSource(attrs: Record<string, unknown>, allowBase64: boolean): string | null | undefined {
  const judged = allowBase64 ? judgedWithData : judgedWithoutData;
  if (judged.has(attrs)) return judged.get(attrs);
  const src = imageSource(attrs['src'], allowBase64);
  judged.set(attrs, src);
  return src;
}

/** Whether a source may be stored: no source, or one the URL policy allows. */
function isValidImageSrc(value: unknown, allowBase64: boolean): boolean {
  return imageSource(value, allowBase64) !== undefined;
}

/** Loads the source into the node view's image only when the policy allows it. */
function applySource(img: HTMLImageElement, attrs: Record<string, unknown>, allowBase64: boolean): void {
  const src = nodeSource(attrs, allowBase64);
  if (typeof src === 'string') {
    if (img.getAttribute('src') !== src) img.src = src;
  } else {
    img.removeAttribute('src');
  }
}

/**
 * Writes the stored width onto the element, accepting every spelling the
 * `width` attribute legally carries: a number from a fresh resize, a numeric
 * string after a getHTML/setContent round trip, and a px-suffixed string
 * from `setImage({ width: '300px' })` or pasted markup (the option type is
 * `string | number`).
 *
 * Interpolating the raw value produced "300pxpx" for that last spelling,
 * which CSSOM rejects outright, so the picture silently fell back to its
 * intrinsic size on screen while both export backends sized it at 300. Same
 * document, half the width on paper.
 */
function applyWidth(img: HTMLImageElement, value: unknown): void {
  const px =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(/^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value)?.[1] ?? '')
        : Number.NaN;
  img.style.width = Number.isFinite(px) && px > 0 ? `${String(px)}px` : '';
}

/** The image files of a clipboard or drop in their order: file items whose type is an image type. */
function clipboardImageFiles(data: DataTransfer | null): File[] {
  const found: File[] = [];
  if (!data) return found;
  const add = (file: File | null): void => {
    if (file?.type.startsWith('image/') === true && !found.includes(file)) found.push(file);
  };
  // A synthetic or older transfer may list its files only.
  const items = data.items as DataTransferItemList | null | undefined;
  if (items) {
    for (const item of Array.from(items)) if (item.kind === 'file') add(item.getAsFile());
  } else {
    for (const file of Array.from(data.files)) add(file);
  }
  return found;
}

/** Whether a clipboard or drop carries files and no text of either kind. */
function holdsOnlyFiles(data: DataTransfer | null): boolean {
  return data !== null && data.getData('text/html') === '' && data.getData('text/plain') === '';
}

/**
 * Places an image node at the selection of `tr`, as setImage does: not inside a code block, and a
 * block image in the label of a list or task item at the top level after the item, with an empty
 * paragraph after it, splitting the list around the item. Returns false when it places nothing,
 * 'list' when it placed the image after a list item, and true otherwise.
 */
function placeImage(state: EditorState, tr: Transaction, node: PmNode, inline: boolean): boolean | 'list' {
  if (tr.selection.$from.parent.type.spec.code) return false;
  // Block-level images belong at the top level, not nested inside the list item. The util splits
  // the parent list around the current item (an empty label is consumed). Inline images keep the
  // insert-at-cursor behavior.
  if (!inline) {
    const paragraphType = state.schema.nodes['paragraph'];
    const trailingParagraph = paragraphType?.create();
    const nodes = trailingParagraph ? [node, trailingParagraph] : [node];
    const listRange = splitListForInsert(state, tr);
    if (listRange) {
      tr.replaceWith(listRange.from, listRange.to, nodes);
      return 'list';
    }
  }
  tr.replaceSelectionWith(node);
  return true;
}

/** Reads a File as a base64 data URL. */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result as string); };
    reader.onerror = () => { reject(reader.error ?? new Error('FileReader error')); };
    reader.readAsDataURL(file);
  });
}

export interface ImageOptions {
  /**
   * Whether images are inline (within paragraphs) or block-level (default: false)
   * When true, images can appear alongside text within a paragraph.
   */
  inline: boolean;
  /**
   * Allow base64 data:image/ URLs (default: true)
   * When false, only http:// and https:// URLs are allowed
   */
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
  /**
   * Async function that uploads a file and returns the URL. Pasted, dropped
   * and chosen image files are stored through it. When null (default), they
   * are read as data URLs if `allowBase64` allows it, and not stored at all
   * otherwise. A handler that returns the URL itself, not a promise, is read
   * as `await` reads it.
   */
  uploadHandler: ((file: File) => Promise<string>) | null;
  /**
   * Allowed MIME types for upload.
   * @default ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']
   */
  allowedMimeTypes: string[];
  /**
   * Maximum file size in bytes. 0 = unlimited.
   * @default 0
   */
  maxFileSize: number;
  /**
   * The most image files one paste, drop or file choice inserts: the first
   * ones of an accepted type and size, in the order they came; the others are
   * left out. Every file is read or uploaded at once, and without an
   * `uploadHandler` each is stored in the document as a data URL, so dropping a
   * folder of photos would otherwise add them all. 0 inserts every file.
   * @default 10
   */
  maxFiles: number;
  /**
   * Called when upload starts for a file. An error it throws is reported
   * through the editor's `error` event (context `Image.onUploadStart`) and
   * does not stop the upload.
   */
  onUploadStart: ((file: File) => void) | null;
  /**
   * Called when storing a file fails: an upload that rejects or throws, a file
   * that cannot be read, or a source setImage would refuse. Receives the error
   * and the file. It runs after the other images of the paste or drop are
   * placed; an error it throws is reported through the editor's `error` event
   * (context `Image.onUploadError`).
   */
  onUploadError: ((error: Error, file: File) => void) | null;
  /**
   * Which placement control the image bubble menu offers: `float`, where text
   * wraps around the picture, or `align`, where the picture only moves within
   * the measure and the text stays below it (the Notion behaviour).
   *
   * `null` (the default) follows the editor: the Notion preset offers align,
   * everything else offers float. Set explicitly to pin one regardless of
   * preset. Both attributes exist on the node either way, so a document
   * written under one setting keeps its layout when opened under the other.
   *
   * @default null
   */
  placement: ImagePlacement | null;
}

/** Bubble-menu placement controls; exactly one set is offered, see `placement`. */
const imageFloatItems = (i18n?: I18nService): ToolbarItem[] => {
  const group = localizeMessage(i18n, imageMessages.floatGroup);
  return [
  { type: 'button', name: 'imageFloatNone', command: 'setImageFloat', commandArgs: ['none'], icon: 'textIndent', ...localizedLabel(i18n, imageMessages.floatNone), group: 'image-float', groupLabel: group.text, groupLabelLanguage: group.language, priority: 100, isActive: { name: 'image', attributes: { float: 'none' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatLeft', command: 'setImageFloat', commandArgs: ['left'], icon: 'textAlignLeft', ...localizedLabel(i18n, imageMessages.floatLeft), group: 'image-float', groupLabel: group.text, groupLabelLanguage: group.language, priority: 90, isActive: { name: 'image', attributes: { float: 'left' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatCenter', command: 'setImageFloat', commandArgs: ['center'], icon: 'textAlignCenter', ...localizedLabel(i18n, imageMessages.floatCenter), group: 'image-float', groupLabel: group.text, groupLabelLanguage: group.language, priority: 80, isActive: { name: 'image', attributes: { float: 'center' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatRight', command: 'setImageFloat', commandArgs: ['right'], icon: 'textAlignRight', ...localizedLabel(i18n, imageMessages.floatRight), group: 'image-float', groupLabel: group.text, groupLabelLanguage: group.language, priority: 70, isActive: { name: 'image', attributes: { float: 'right' } }, toolbar: false, bubbleMenu: 'image' },
  ];
};

const imageAlignItems = (i18n?: I18nService): ToolbarItem[] => {
  const group = localizeMessage(i18n, imageMessages.alignGroup);
  return [
  { type: 'button', name: 'imageAlignLeft', command: 'setImageAlign', commandArgs: ['left'], icon: 'textAlignLeft', ...localizedLabel(i18n, imageMessages.alignLeft), group: 'image-align', groupLabel: group.text, groupLabelLanguage: group.language, priority: 90, isActive: { name: 'image', attributes: { align: 'left' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageAlignCenter', command: 'setImageAlign', commandArgs: ['center'], icon: 'textAlignCenter', ...localizedLabel(i18n, imageMessages.alignCenter), group: 'image-align', groupLabel: group.text, groupLabelLanguage: group.language, priority: 80, isActive: { name: 'image', attributes: { align: 'center' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageAlignRight', command: 'setImageAlign', commandArgs: ['right'], icon: 'textAlignRight', ...localizedLabel(i18n, imageMessages.alignRight), group: 'image-align', groupLabel: group.text, groupLabelLanguage: group.language, priority: 70, isActive: { name: 'image', attributes: { align: 'right' } }, toolbar: false, bubbleMenu: 'image' },
  ];
};

export const Image = Node.create<ImageOptions>({
  name: 'image',
  group() {
    return this.options.inline ? 'inline' : 'block';
  },
  inline() {
    return this.options.inline;
  },
  draggable: true,
  atom: true,

  addOptions() {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
      uploadHandler: null,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/avif',
      ],
      maxFileSize: 0,
      maxFiles: 10,
      onUploadStart: null,
      onUploadError: null,
      placement: null,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          // A refused source is not stored; an allowed one in its cleaned spelling.
          return imageSource(element.getAttribute('src'), this.options.allowBase64) ?? null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['src']) return {};
          return { src: attributes['src'] as string };
        },
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('alt'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['alt']) return {};
          return { alt: attributes['alt'] as string };
        },
      },
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('title'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['title']) return {};
          return { title: attributes['title'] as string };
        },
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('width'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['width']) return {};
          return { width: attributes['width'] as string };
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('height'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['height']) return {};
          return { height: attributes['height'] as string };
        },
      },
      loading: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('loading'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['loading']) return {};
          return { loading: attributes['loading'] as string };
        },
      },
      crossorigin: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('crossorigin'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['crossorigin']) return {};
          return { crossorigin: attributes['crossorigin'] as string };
        },
      },
      float: {
        default: 'none',
        parseHTML: (element: HTMLElement) => {
          const style = element.style;
          if (style.float === 'left') return 'left';
          if (style.float === 'right') return 'right';
          if (style.marginLeft === 'auto' && style.marginRight === 'auto') return 'center';
          const align = element.getAttribute('align');
          if (align === 'left') return 'left';
          if (align === 'right') return 'right';
          if (align === 'center' || align === 'middle') return 'center';
          return 'none';
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const float = attributes['float'] as string;
          if (!float || float === 'none') return {};
          if (float === 'left') return { style: 'float: left; margin: 0 1em 1em 0;' };
          if (float === 'right') return { style: 'float: right; margin: 0 0 1em 1em;' };
          if (float === 'center') return { style: 'display: block; margin-left: auto; margin-right: auto;' };
          return {};
        },
      },
      align: {
        default: 'none',
        // Read from the data attribute alone, never from the style: the
        // centered form of the two is written with the same auto margins, and
        // a document that already carries `float: center` must keep meaning
        // that rather than acquire an alignment as well.
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-align');
          return value === 'left' || value === 'center' || value === 'right' ? value : 'none';
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const align = attributes['align'] as string;
          if (!align || align === 'none') return {};
          // The attribute is what parses back; the style is what makes the
          // same HTML land in the right place in a plain browser, with no
          // theme loaded. Never `float`, so no text comes up beside it.
          const margins =
            align === 'left'
              ? 'margin-right: auto;'
              : align === 'right'
                ? 'margin-left: auto;'
                : 'margin-left: auto; margin-right: auto;';
          return { 'data-align': align, style: `display: block; width: fit-content; ${margins}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = nodeSource(node.attrs, this.options.allowBase64);

    // Checked again on render, for a source stored by JSON or a collaborator:
    // a refused one renders an empty src, so an HTML round trip keeps the node.
    if (src === undefined) {
      return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src: '' }];
    }
    if (src === null) {
      return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes }];
    }
    return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src }];
  },

  leafText(node) {
    return (node.attrs['alt'] as string | null) ?? '';
  },

  addInputRules() {
    const { nodeType, options } = this;
    if (!nodeType) return [];

    return [
      new InputRule(
        /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'\u201C\u201D\u2018\u2019]([^"'\u201C\u201D\u2018\u2019]+)["'\u201C\u201D\u2018\u2019])?\))$/,
        (state, match, start, end) => {
          const [fullMatch, wrapper, alt, src, title] = match;
          if (!src || !wrapper) return null;

          // The same check as every other entry, in markdown syntax too.
          const allowed = imageSource(src, options.allowBase64);
          if (typeof allowed !== 'string') return null;

          const { tr } = state;
          const attrs: Record<string, unknown> = {
            src: allowed,
            alt: alt ?? null,
            title: title ?? null,
          };

          // Adjust start for leading whitespace before ![
          const offset = fullMatch.length - wrapper.length;
          const from = start + offset;

          tr.replaceWith(from, end, nodeType.create(attrs));
          return tr;
        }
      ),
    ];
  },

  addToolbarItems(): ToolbarItem[] {
    const i18n = this.editor?.i18n;
    const group = localizeMessage(i18n, coreMessages.groupInsert);
    const actionsGroup = localizeMessage(i18n, imageMessages.actionsGroup);
    return [
      // Main toolbar insert button
      {
        type: 'button',
        name: 'image',
        command: 'setImage',
        commandArgs: [{ src: '' }],
        icon: 'image',
        ...localizedLabel(i18n, imageMessages.insertToolbar),
        group: 'insert',
        groupLabel: group.text, groupLabelLanguage: group.language,
        priority: 150,
        emitEvent: 'insertImage',
      },
      // Bubble menu only: ONE placement control. The explicit `placement`
      // option wins; otherwise the editor preset decides (Notion places a
      // picture, classic wraps text around it). Offering both would ask the
      // author to choose between two things that look the same until the
      // text beside the picture is long enough to tell them apart.
      ...((this.options.placement ?? (this.editor?.preset === 'notion' ? 'align' : 'float')) === 'align'
        ? imageAlignItems(i18n)
        : imageFloatItems(i18n)),
      // Bubble menu only: edit alt text. Highlights as active when the selected
      // image already has a non-empty alt (resolveActive passes the real editor).
      {
        type: 'button', name: 'editImage', command: 'setImage', commandArgs: [{ src: '' }],
        icon: 'textAa', ...localizedLabel(i18n, imageMessages.editAlt), group: 'image-actions', groupLabel: actionsGroup.text, groupLabelLanguage: actionsGroup.language, priority: 60,
        toolbar: false, bubbleMenu: 'image', emitEvent: 'editImage',
        isActiveFn: (editor) => {
          // A selected image is a NodeSelection, so read its node directly. The
          // editor here is the real instance; getAttributes walks $from's
          // ancestors and would miss the selected atom.
          const sel = (editor as unknown as {
            state: { selection: { node?: { type: { name: string }; attrs: Record<string, unknown> } } };
          }).state.selection;
          return Boolean(sel.node?.type.name === 'image' && sel.node.attrs['alt']);
        },
      },
      // Bubble menu only: delete
      { type: 'button', name: 'deleteImage', command: 'deleteImage', icon: 'trash', ...localizedLabel(i18n, imageMessages.delete), group: 'image-actions', groupLabel: actionsGroup.text, groupLabelLanguage: actionsGroup.language, priority: 50, toolbar: false, bubbleMenu: 'image' },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    const i18n = this.editor?.i18n;
    const description = localizeMessage(i18n, imageMessages.description);
    const group = localizeMessage(i18n, coreMessages.groupMedia);
    return [
      {
        name: 'image',
        ...localizedLabel(i18n, imageMessages.insert),
        description: description.text, descriptionLanguage: description.language,
        icon: 'image',
        group: 'Media',
        groupLabel: group.text, groupLabelLanguage: group.language,
        priority: 200,
        keywords: [...(i18n?.getSearchAliases(imageMessages.insert) ?? ['image', 'picture', 'photo', 'img'])],
        // Open the image URL popover. Matches the toolbar's `emitEvent` flow:
        // subscribers listen for `insertImage` to mount the popover UI.
        command: (editor) => {
          (editor as unknown as { emit: (event: string, payload: unknown) => void }).emit(
            'insertImage',
            {},
          );
        },
      },
    ];
  },

  addNodeView() {
    // Read live, as parsing does, so a changed option applies to the next update.
    const allowBase64 = (): boolean => this.options.allowBase64;
    return (node: PmNode, view: EditorView, getPos: () => number | undefined) => {
      const dom = document.createElement('div');
      dom.className = 'dm-image-resizable';
      dom.draggable = true;

      const applyPlacement = (float: unknown, align: unknown): void => {
        if (typeof float === 'string' && float !== '' && float !== 'none') {
          dom.setAttribute('data-float', float);
        } else {
          dom.removeAttribute('data-float');
        }
        if (typeof align === 'string' && align !== '' && align !== 'none') {
          dom.setAttribute('data-align', align);
        } else {
          dom.removeAttribute('data-align');
        }
      };
      applyPlacement(node.attrs['float'], node.attrs['align']);

      const img = document.createElement('img');
      applySource(img, node.attrs, allowBase64());
      if (node.attrs['alt']) img.alt = node.attrs['alt'] as string;
      if (node.attrs['title']) img.title = node.attrs['title'] as string;
      applyWidth(img, node.attrs['width']);
      dom.appendChild(img);

      // Click-to-select: floated images confuse ProseMirror's posAtCoords,
      // so we explicitly create a NodeSelection on mousedown.
      dom.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).closest('.dm-image-handle')) return;
        const pos = getPos();
        if (pos === undefined) return;
        const { selection } = view.state;
        // Already selected → let default (drag) proceed
        if (selection instanceof NodeSelection && selection.from === pos) return;
        e.preventDefault();
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      });

      // Resize handles (4 corners)
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = `dm-image-handle dm-image-handle-${corner}`;
        handle.addEventListener('mousedown', (e) => {
          // Read-only allows no resize (the drag dispatches a setNodeMarkup).
          if (!view.editable) return;
          e.preventDefault();
          e.stopPropagation();

          const startX = e.clientX;
          const startWidth = img.offsetWidth;
          const isLeft = corner.includes('w');

          const onMouseMove = (ev: MouseEvent): void => {
            const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
            const newWidth = Math.max(50, startWidth + dx);
            img.style.width = `${String(newWidth)}px`;
          };

          const onMouseUp = (): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            const pos = getPos();
            if (pos === undefined) return;
            const currentNode = view.state.doc.nodeAt(pos);
            if (!currentNode) return;
            const tr = view.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              width: img.offsetWidth,
            });
            view.dispatch(tr);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          document.body.style.cursor = isLeft ? 'nw-resize' : 'ne-resize';
          document.body.style.userSelect = 'none';
        });
        dom.appendChild(handle);
      }

      return {
        dom,
        update(updatedNode: PmNode) {
          if (updatedNode.type.name !== 'image') return false;
          applySource(img, updatedNode.attrs, allowBase64());
          // A null alt/title would be written as the literal string "null".
          img.alt = (updatedNode.attrs['alt'] as string | null) ?? '';
          img.title = (updatedNode.attrs['title'] as string | null) ?? '';
          applyWidth(img, updatedNode.attrs['width']);
          applyPlacement(updatedNode.attrs['float'], updatedNode.attrs['align']);
          node = updatedNode;
          return true;
        },
        selectNode() {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode() {
          dom.classList.remove('ProseMirror-selectednode');
        },
      };
    };
  },

  addCommands() {
    return {
      setImage:
        (attributes: SetImageOptions) =>
        ({ state, tr, dispatch }) => {
          // The same check as every other entry; an allowed source is stored cleaned.
          const src = imageSource(attributes.src, this.options.allowBase64);
          if (src === undefined) {
            return false;
          }

          if (!this.nodeType) return false;

          // Refuse insertion inside code blocks
          if (tr.selection.$from.parent.type.spec.code) return false;

          const node = this.nodeType.create({ ...attributes, src: src ?? attributes.src });
          if (!dispatch) return true;
          // A chosen file's image goes through the same placement, see placeImage.
          if (placeImage(state, tr, node, this.options.inline) === 'list') tr.scrollIntoView();
          dispatch(tr);
          return true;
        },

      deleteImage:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.deleteSelection();
            dispatch(tr);
          }
          return true;
        },

      setImageFloat:
        (float: ImageFloat) =>
        ({ tr, state, dispatch }) => {
          if (!['none', 'left', 'right', 'center'].includes(float)) return false;

          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);
          if (node?.type.name !== 'image') return false;

          if (dispatch) {
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              float,
              // The two placements are one choice, so the other is cleared
              // here rather than left behind: a node carrying both would look
              // like whichever the stylesheet happens to apply last, and
              // would export as whichever the serializer reads first.
              align: 'none',
            });
            dispatch(tr);
          }
          return true;
        },

      setImageAlign:
        (align: ImageAlign) =>
        ({ tr, state, dispatch }) => {
          if (!['none', 'left', 'center', 'right'].includes(align)) return false;

          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);
          if (node?.type.name !== 'image') return false;

          if (dispatch) {
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              align,
              float: 'none',
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const plugins: Plugin[] = [];
    const editor = this.editor as unknown as Editor;
    const nodeType = this.nodeType;
    const options = this.options;
    const storage = this.storage as Record<string, unknown>;
    const live = (): ImageOptions => this.options;
    // One path for pasted, dropped and chosen files: an uploadHandler stores them, otherwise
    // they are read as data URLs when allowBase64 allows it, and without either nothing is stored.
    const files = nodeType ? imageFileInsertion({
      nodeType,
      store: () => {
        const { uploadHandler, allowBase64 } = live();
        return uploadHandler ?? (allowBase64 ? readFileAsDataURL : null);
      },
      accepts: file => {
        const { allowedMimeTypes, maxFileSize } = live();
        return allowedMimeTypes.includes(file.type) && (maxFileSize <= 0 || file.size <= maxFileSize);
      },
      maxFiles: () => live().maxFiles,
      allowsSource: src => isValidImageSrc(src, live().allowBase64),
      onUploadStart: () => (live().uploadHandler ? live().onUploadStart : null),
      onUploadError: () => live().onUploadError,
      // An application callback that throws is reported like an extension hook, through the editor's error event.
      reportError: (error, context) => { editor.emit('error', { editor, error, context }); },
      // A chosen file's image goes where setImage places the image of an address.
      placeAsCommand: (state, tr, node) => placeImage(state, tr, node, live().inline) !== false,
    }) : undefined;

    // Image popover + drag overlay + paste/drop plugin
    if (nodeType && files) {
      plugins.push(new Plugin({
        key: new PluginKey('imageClipboardDestination'),
        view: view => ({
          destroy: registerClipboardImageDestination(view, () => {
            const liveOptions = this.options;
            return {
              nodeTypeName: nodeType.name,
              sourceAttribute: 'src',
              inline: nodeType.isInline,
              allowEmbedded: liveOptions.allowBase64,
              allowedMimeTypes: liveOptions.allowedMimeTypes,
              maxFileBytes: liveOptions.maxFileSize === 0 ? Number.MAX_SAFE_INTEGER : liveOptions.maxFileSize,
              policyVersion: 'builtin:1',
            };
          // Core hands over a paste's image files when they are the paste, for PasteCleanup and Link too.
          }, insertion => files.insert(view, insertion.files,
            insertion.position === undefined ? { at: 'selection' } : { at: 'position', pos: insertion.position }, insertion.alt)),
        }),
      }));

      // --- Build popover DOM ---
      const el = document.createElement('div');
      el.className = 'dm-image-popover';
      el.setAttribute('data-dm-editor-ui', '');

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.className = 'dm-image-popover-input';

      const altInput = document.createElement('input');
      altInput.type = 'text';
      // Own class (shares styling with the URL input via the theme) so selectors
      // targeting `.dm-image-popover-input` stay unambiguous to the URL field.
      altInput.className = 'dm-image-popover-alt-input';
      // Shown only in the edit menu (clicking an existing image), not on insert.
      altInput.hidden = true;

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'dm-image-popover-btn dm-image-popover-apply';
      applyBtn.innerHTML = defaultIcons['check'] ?? '';

      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'dm-image-popover-btn dm-image-popover-browse';
      browseBtn.innerHTML = defaultIcons['image'] ?? '';

      const fields = document.createElement('div');
      fields.className = 'dm-image-popover-fields';
      fields.appendChild(urlInput);
      fields.appendChild(altInput);
      el.appendChild(fields);
      el.appendChild(applyBtn);
      el.appendChild(browseBtn);

      let isOpen = false;
      let cleanupFloating: (() => void) | null = null;
      let toggleAnchor: HTMLElement | null = null;
      // When set, the popover edits the image at this position in place
      // (e.g. its alt text) instead of inserting a new image.
      let editingPos: number | null = null;

      let refreshingLabels = false;
      const refreshLabels = (): void => {
        if (refreshingLabels) return;
        refreshingLabels = true;
        try {
          let revision: number;
          do {
            revision = editor.i18n.getSnapshot().revision;
            const url = editor.i18n.resolve(imageMessages.urlLabel);
            const alt = editor.i18n.resolve(imageMessages.altLabel);
            const apply = editingPos !== null
              ? editor.i18n.resolve(imageMessages.applyAlt)
              : editor.i18n.resolve(imageMessages.applyInsert);
            const browse = editor.i18n.resolve(imageMessages.browse);
            urlInput.placeholder = editor.i18n.t(imageMessages.urlPlaceholder);
            urlInput.setAttribute('aria-label', url.text);
            urlInput.lang = url.language;
            altInput.placeholder = editor.i18n.t(imageMessages.altPlaceholder);
            altInput.setAttribute('aria-label', alt.text);
            altInput.lang = alt.language;
            applyBtn.title = apply.text;
            applyBtn.setAttribute('aria-label', apply.text);
            applyBtn.lang = apply.language;
            browseBtn.title = browse.text;
            browseBtn.setAttribute('aria-label', browse.text);
            browseBtn.lang = browse.language;
          } while (revision !== editor.i18n.getSnapshot().revision);
        } finally {
          refreshingLabels = false;
        }
      };

      const showPopover = (anchorElement?: HTMLElement, prefill?: { alt: string }): void => {
        toggleAnchor = anchorElement ?? null;
        const editing = prefill !== undefined;
        // Insert mode shows only the URL field (+ browse); the edit menu shows
        // only the alt field.
        urlInput.value = '';
        altInput.value = prefill?.alt ?? '';
        urlInput.hidden = editing;
        // Without an uploadHandler or allowBase64 a chosen file could not be stored.
        browseBtn.hidden = editing || !files.canStore();
        altInput.hidden = !editing;
        refreshLabels();
        el.setAttribute('data-show', '');
        isOpen = true;
        storage['isOpen'] = true;
        // The popover is appended to document.body. Refresh the theme
        // cascade on every show so runtime toggles propagate.
        copyThemeClass(editor.view, el);
        // Dispatch to trigger toolbar expanded state refresh
        editor.view.dispatch(editor.view.state.tr);

        const reference: Element | { getBoundingClientRect: () => DOMRect } = anchorElement ?? {
          getBoundingClientRect: () => {
            const coords = editor.view.coordsAtPos(editor.view.state.selection.from);
            return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
          },
        };

        cleanupFloating?.();
        cleanupFloating = positionFloating(reference, el, {
          placement: 'bottom',
          offsetValue: 4,
        });

        // In edit mode the alt field is the point, so focus it directly.
        (prefill ? altInput : urlInput).focus();
      };

      const hidePopover = (): void => {
        if (!isOpen) return;
        toggleAnchor = null;
        cleanupFloating?.();
        cleanupFloating = null;
        el.removeAttribute('data-show');
        isOpen = false;
        editingPos = null;
        storage['isOpen'] = false;
        // Dispatch to trigger toolbar expanded state refresh
        editor.view.dispatch(editor.view.state.tr);
      };

      const closePopover = (): void => {
        hidePopover();
        editor.view.focus();
      };

      // A chosen file goes where the URL field's setImage puts an image, and not into a code block.
      const canInsertAtSelection = (): boolean => editor.view.state.selection.$from.parent.type.spec.code !== true;
      const insertFromFile = (file: File): void => {
        if (canInsertAtSelection()) files.insert(editor.view, [file], { at: 'command' });
      };

      const applyUrl = (): void => {
        if (editingPos !== null) {
          // Edit menu: only the alt text changes; the existing src is kept.
          const alt = altInput.value.trim() || null;
          const { state } = editor.view;
          const node = state.doc.nodeAt(editingPos);
          if (node?.type === nodeType) {
            const tr = state.tr.setNodeMarkup(editingPos, undefined, { ...node.attrs, alt });
            editor.view.dispatch(tr);
          }
        } else {
          const src = urlInput.value.trim();
          if (src && isValidImageSrc(src, options.allowBase64)) {
            editor.commands.setImage({ src });
          }
        }
        closePopover();
      };

      const openFileBrowser = (): void => {
        hidePopover();
        if (!canInsertAtSelection()) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.allowedMimeTypes.join(',');
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) insertFromFile(file);
          editor.view.focus();
        });
        input.click();
      };

      // Event: toolbar button or Ctrl+Shift+I
      const onInsertImage = (data: { anchorElement?: HTMLElement }): void => {
        if (isOpen) {
          closePopover();
        } else {
          editingPos = null;
          showPopover(data.anchorElement);
        }
      };

      // Event: 'Edit alt text' bubble action. Open an alt-only menu pre-filled
      // with the selected image's current alt text. Anchor to the image element
      // (stable), not the bubble button, which is detached when the popover
      // opens - floating-ui would then hide the popover via referenceHidden.
      const onEditImage = (): void => {
        if (isOpen) { closePopover(); return; }
        const { selection } = editor.view.state;
        if (!(selection instanceof NodeSelection) || selection.node.type !== nodeType) return;
        editingPos = selection.from;
        const dom = editor.view.nodeDOM(editingPos);
        const anchor = dom instanceof HTMLElement ? dom : undefined;
        const attrs = selection.node.attrs as { alt?: string | null };
        showPopover(anchor, { alt: attrs.alt ?? '' });
      };

      // Popover event listeners. The focusable order depends on the mode:
      // insert shows [url, apply, browse], the edit menu shows [alt, apply].
      const focusables = (): HTMLElement[] =>
        editingPos !== null ? [altInput, applyBtn] : [urlInput, applyBtn, browseBtn].filter(element => !element.hidden);
      const moveFocus = (current: HTMLElement, dir: 1 | -1): void => {
        const list = focusables();
        const i = list.indexOf(current);
        if (i === -1) { list[0]?.focus(); return; }
        list[(i + dir + list.length) % list.length]?.focus();
      };

      const onInputKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') { e.preventDefault(); applyUrl(); }
        else if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
        else if (e.key === 'Tab') { e.preventDefault(); moveFocus(e.target as HTMLElement, e.shiftKey ? -1 : 1); }
      };

      const onButtonKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
        else if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).click(); }
        else if (e.key === 'Tab') { e.preventDefault(); moveFocus(e.target as HTMLElement, e.shiftKey ? -1 : 1); }
      };

      const onClickOutside = (e: MouseEvent): void => {
        if (!isOpen || el.contains(e.target as globalThis.Node)) return;
        if (toggleAnchor && (toggleAnchor === e.target || toggleAnchor.contains(e.target as globalThis.Node))) return;
        hidePopover();
      };

      const onPreventBlur = (e: MouseEvent): void => { e.preventDefault(); };

      // --- Drag overlay helpers ---
      let dragCounter = 0;

      const hasImageItems = (dt: DataTransfer | null): boolean => {
        if (!dt?.items) return false;
        for (const item of Array.from(dt.items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) return true;
        }
        return false;
      };

      plugins.push(new Plugin({
        key: new PluginKey('imageFileBrowser'),
        props: {
          handleDOMEvents: {
            dragenter(view, event) {
              if (!hasImageItems(event.dataTransfer)) return false;
              dragCounter++;
              view.dom.closest('.dm-editor')?.classList.add('dm-dragover');
              return false;
            },
            dragleave(view) {
              dragCounter--;
              if (dragCounter <= 0) {
                dragCounter = 0;
                view.dom.closest('.dm-editor')?.classList.remove('dm-dragover');
              }
              return false;
            },
            drop(view) {
              dragCounter = 0;
              view.dom.closest('.dm-editor')?.classList.remove('dm-dragover');
              return false;
            },
          },
          handlePaste(view, event, slice) {
            if (getClipboardPasteBehavior(view, event)?.assetsAlreadyHandled === true) return false;
            // Core decides whether the files are the paste: the pasted content has no text of its
            // own. It hands them to this node's insertFiles, with the one copied image's alt text.
            if (pasteClipboardImageFiles(view, event, slice)) return true;
            // Files alone that Image cannot store insert nothing, not a rendering of them.
            if (!files.canStore() && clipboardImageFiles(event.clipboardData).length > 0 && holdsOnlyFiles(event.clipboardData)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
          handleDrop(view, event, slice, moved) {
            // A drag inside the editor moves its own content.
            if (moved) return false;
            // A drop's files win; Core hands them to this node's insertFiles at the drop position,
            // with the alt text of the one image the drop held for one file.
            if (dropClipboardImageFiles(view, event, slice)) {
              event.preventDefault();
              return true;
            }
            if (clipboardImageFiles(event.dataTransfer).length === 0) return false;
            // Image files alone that nothing inserts: the browser must not open them instead.
            if (holdsOnlyFiles(event.dataTransfer)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        view() {
          refreshLabels();
          const unsubscribeI18n = editor.i18n.subscribe(refreshLabels);
          // Append popover to body (escape overflow:hidden on .dm-editor)
          document.body.appendChild(el);

          // Register popover event listeners
          urlInput.addEventListener('keydown', onInputKeydown);
          altInput.addEventListener('keydown', onInputKeydown);
          applyBtn.addEventListener('mousedown', onPreventBlur);
          applyBtn.addEventListener('click', applyUrl);
          applyBtn.addEventListener('keydown', onButtonKeydown);
          browseBtn.addEventListener('mousedown', onPreventBlur);
          browseBtn.addEventListener('click', openFileBrowser);
          browseBtn.addEventListener('keydown', onButtonKeydown);
          document.addEventListener('mousedown', onClickOutside);

          // 'insertImage'/'editImage' are dynamic events not in EditorEvents - cast once
          interface DynEvents { on(e: string, fn: typeof onInsertImage): void; off(e: string, fn: typeof onInsertImage): void }
          const dynEditor = editor as unknown as DynEvents;
          dynEditor.on('insertImage', onInsertImage);
          dynEditor.on('editImage', onEditImage);

          return {
            destroy() {
              unsubscribeI18n();
              hidePopover();
              urlInput.removeEventListener('keydown', onInputKeydown);
              altInput.removeEventListener('keydown', onInputKeydown);
              applyBtn.removeEventListener('mousedown', onPreventBlur);
              applyBtn.removeEventListener('click', applyUrl);
              applyBtn.removeEventListener('keydown', onButtonKeydown);
              browseBtn.removeEventListener('mousedown', onPreventBlur);
              browseBtn.removeEventListener('click', openFileBrowser);
              browseBtn.removeEventListener('keydown', onButtonKeydown);
              document.removeEventListener('mousedown', onClickOutside);
              dynEditor.off('insertImage', onInsertImage);
              dynEditor.off('editImage', onEditImage);
              el.remove();
            },
          };
        },
      }));
    }

    // Placeholders of pasted, dropped and chosen files.
    if (files) plugins.push(files.plugin);

    return plugins;
  },
});
