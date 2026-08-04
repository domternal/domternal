/**
 * Block (default) or inline image element.
 *
 * XSS protection (blocklist): javascript:, vbscript:, file: are blocked;
 * data: URLs require `allowBase64` AND data:image/. Validated in parseHTML,
 * renderHTML, the `setImage` command, and the input rule (defense in depth).
 */

import { Node, PluginKey, positionFloating, defaultIcons, splitListForInsert, copyThemeClass } from '@domternal/core';
import type { Editor, CommandSpec, ToolbarItem, FloatingMenuItem } from '@domternal/core';
import { Plugin, NodeSelection } from '@domternal/pm/state';
import { InputRule } from '@domternal/pm/inputrules';
import type { Node as PmNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import { imageUploadPlugin } from './imageUploadPlugin.js';

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
 * Validates image src URL for XSS protection.
 * Blocks: javascript:, vbscript:, file:, and data: (unless allowBase64 AND data:image/).
 * Allows everything else: http(s), relative paths, protocol-relative URLs, etc.
 */
function isValidImageSrc(value: unknown, allowBase64: boolean): boolean {
  if (value === null || value === undefined) return true; // null is valid (no src)
  if (typeof value !== 'string') return false;
  if (value === '') return true; // empty string is valid

  // Block dangerous protocols
  if (/^(javascript|vbscript|file):/i.test(value)) return false;

  // Block data: URLs unless allowBase64 AND specifically data:image/
  if (/^data:/i.test(value)) {
    return allowBase64 && /^data:image\//i.test(value);
  }

  // Allow everything else: http(s), relative paths, protocol-relative, etc.
  return true;
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
   * Async function that uploads a file and returns the URL.
   * When provided, enables paste/drop image upload.
   * When null (default), paste/drop is not handled.
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
   * Called when upload starts for a file.
   */
  onUploadStart: ((file: File) => void) | null;
  /**
   * Called when upload fails. Receives the error and the file.
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
const IMAGE_FLOAT_ITEMS: ToolbarItem[] = [
  { type: 'button', name: 'imageFloatNone', command: 'setImageFloat', commandArgs: ['none'], icon: 'textIndent', label: 'Inline', group: 'image-float', priority: 100, isActive: { name: 'image', attributes: { float: 'none' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatLeft', command: 'setImageFloat', commandArgs: ['left'], icon: 'textAlignLeft', label: 'Float left', group: 'image-float', priority: 90, isActive: { name: 'image', attributes: { float: 'left' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatCenter', command: 'setImageFloat', commandArgs: ['center'], icon: 'textAlignCenter', label: 'Center', group: 'image-float', priority: 80, isActive: { name: 'image', attributes: { float: 'center' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageFloatRight', command: 'setImageFloat', commandArgs: ['right'], icon: 'textAlignRight', label: 'Float right', group: 'image-float', priority: 70, isActive: { name: 'image', attributes: { float: 'right' } }, toolbar: false, bubbleMenu: 'image' },
];

const IMAGE_ALIGN_ITEMS: ToolbarItem[] = [
  { type: 'button', name: 'imageAlignLeft', command: 'setImageAlign', commandArgs: ['left'], icon: 'textAlignLeft', label: 'Align left', group: 'image-align', priority: 90, isActive: { name: 'image', attributes: { align: 'left' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageAlignCenter', command: 'setImageAlign', commandArgs: ['center'], icon: 'textAlignCenter', label: 'Align center', group: 'image-align', priority: 80, isActive: { name: 'image', attributes: { align: 'center' } }, toolbar: false, bubbleMenu: 'image' },
  { type: 'button', name: 'imageAlignRight', command: 'setImageAlign', commandArgs: ['right'], icon: 'textAlignRight', label: 'Align right', group: 'image-align', priority: 70, isActive: { name: 'image', attributes: { align: 'right' } }, toolbar: false, bubbleMenu: 'image' },
];

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
      onUploadStart: null,
      onUploadError: null,
      placement: null,
    };
  },

  addAttributes() {
    const { options } = this;
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute('src');
          // Validate on parse - reject invalid URLs
          if (src && !isValidImageSrc(src, options.allowBase64)) {
            return null;
          }
          return src;
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
    const src = node.attrs['src'] as string | null;

    // XSS protection: defense in depth - validate again on render
    if (src && !isValidImageSrc(src, this.options.allowBase64)) {
      // Return image with empty src if URL is invalid (should not happen due to parse validation)
      return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src: '' }];
    }

    return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes }];
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

          // XSS validation: reject dangerous URLs in markdown syntax too
          if (!isValidImageSrc(src, options.allowBase64)) return null;

          const { tr } = state;
          const attrs: Record<string, unknown> = {
            src,
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
    return [
      // Main toolbar insert button
      {
        type: 'button',
        name: 'image',
        command: 'setImage',
        commandArgs: [{ src: '' }],
        icon: 'image',
        label: 'Insert Image',
        group: 'insert',
        priority: 150,
        emitEvent: 'insertImage',
      },
      // Bubble menu only: ONE placement control. The explicit `placement`
      // option wins; otherwise the editor preset decides (Notion places a
      // picture, classic wraps text around it). Offering both would ask the
      // author to choose between two things that look the same until the
      // text beside the picture is long enough to tell them apart.
      ...((this.options.placement ?? (this.editor?.preset === 'notion' ? 'align' : 'float')) === 'align'
        ? IMAGE_ALIGN_ITEMS
        : IMAGE_FLOAT_ITEMS),
      // Bubble menu only: edit alt text. Highlights as active when the selected
      // image already has a non-empty alt (resolveActive passes the real editor).
      {
        type: 'button', name: 'editImage', command: 'setImage', commandArgs: [{ src: '' }],
        icon: 'textAa', label: 'Edit alt text', group: 'image-actions', priority: 60,
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
      { type: 'button', name: 'deleteImage', command: 'deleteImage', icon: 'trash', label: 'Delete', group: 'image-actions', priority: 50, toolbar: false, bubbleMenu: 'image' },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'image',
        label: 'Image',
        description: 'Upload or embed with a link',
        icon: 'image',
        group: 'Media',
        priority: 200,
        keywords: ['image', 'picture', 'photo', 'img'],
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
      img.src = node.attrs['src'] as string;
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
          img.src = updatedNode.attrs['src'] as string;
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
          // XSS protection: validate src URL before inserting
          if (!isValidImageSrc(attributes.src, this.options.allowBase64)) {
            return false;
          }

          if (!this.nodeType) return false;

          // Refuse insertion inside code blocks
          if (tr.selection.$from.parent.type.spec.code) return false;

          const node = this.nodeType.create(attributes);

          // List-item-aware path: cursor in the LABEL paragraph of a
          // list/task item. Block-level images belong at TOP LEVEL,
          // not nested inside the list item. The util splits the
          // parent list around the current item (empty label consumed).
          // Only applies when image is block-level (default); inline
          // images keep the original insert-at-cursor behavior.
          if (!this.options.inline) {
            const paragraphType = state.schema.nodes['paragraph'];
            const trailingParagraph = paragraphType?.create();
            const nodes = trailingParagraph ? [node, trailingParagraph] : [node];
            const listRange = splitListForInsert(state, tr);
            if (listRange) {
              if (!dispatch) return true;
              tr.replaceWith(listRange.from, listRange.to, nodes);
              dispatch(tr.scrollIntoView());
              return true;
            }
          }

          if (dispatch) {
            tr.replaceSelectionWith(node);
            dispatch(tr);
          }

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

    // Image popover + drag overlay + paste/drop plugin
    if (nodeType) {
      // --- Build popover DOM ---
      const el = document.createElement('div');
      el.className = 'dm-image-popover';
      el.setAttribute('data-dm-editor-ui', '');

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.placeholder = 'Image URL...';
      urlInput.className = 'dm-image-popover-input';
      urlInput.setAttribute('aria-label', 'Image URL');

      const altInput = document.createElement('input');
      altInput.type = 'text';
      altInput.placeholder = 'Alt text (optional)...';
      // Own class (shares styling with the URL input via the theme) so selectors
      // targeting `.dm-image-popover-input` stay unambiguous to the URL field.
      altInput.className = 'dm-image-popover-alt-input';
      altInput.setAttribute('aria-label', 'Image alt text');
      // Shown only in the edit menu (clicking an existing image), not on insert.
      altInput.hidden = true;

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'dm-image-popover-btn dm-image-popover-apply';
      applyBtn.title = 'Insert image';
      applyBtn.setAttribute('aria-label', 'Insert image');
      applyBtn.innerHTML = defaultIcons['check'] ?? '';

      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'dm-image-popover-btn dm-image-popover-browse';
      browseBtn.title = 'Browse files';
      browseBtn.setAttribute('aria-label', 'Browse files');
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

      const showPopover = (anchorElement?: HTMLElement, prefill?: { alt: string }): void => {
        toggleAnchor = anchorElement ?? null;
        const editing = prefill !== undefined;
        // Insert mode shows only the URL field (+ browse); the edit menu shows
        // only the alt field.
        urlInput.value = '';
        altInput.value = prefill?.alt ?? '';
        urlInput.hidden = editing;
        browseBtn.hidden = editing;
        altInput.hidden = !editing;
        applyBtn.title = editing ? 'Save alt text' : 'Insert image';
        applyBtn.setAttribute('aria-label', editing ? 'Save alt text' : 'Insert image');
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

      const insertFromFile = (file: File): void => {
        if (options.uploadHandler) {
          options.uploadHandler(file)
            .then((url) => {
              editor.commands.setImage({ src: url });
            })
            .catch((error: unknown) => {
              if (options.onUploadError) {
                options.onUploadError(
                  error instanceof Error ? error : new Error(String(error)),
                  file,
                );
              }
            });
        } else {
          void readFileAsDataURL(file).then(src => {
            const { tr } = editor.view.state;
            tr.replaceSelectionWith(nodeType.create({ src }));
            editor.view.dispatch(tr);
          });
        }
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
        editingPos !== null ? [altInput, applyBtn] : [urlInput, applyBtn, browseBtn];
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
          handlePaste(view, event) {
            // When uploadHandler is set, let imageUploadPlugin handle paste
            if (options.uploadHandler) return false;
            const items = event.clipboardData?.items;
            if (!items) return false;

            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (!file) continue;
                if (!options.allowedMimeTypes.includes(file.type)) continue;
                if (options.maxFileSize > 0 && file.size > options.maxFileSize) continue;

                event.preventDefault();
                void readFileAsDataURL(file).then(src => {
                  const { tr } = view.state;
                  tr.replaceSelectionWith(nodeType.create({ src }));
                  view.dispatch(tr);
                });
                return true;
              }
            }
            return false;
          },
          handleDrop(view, event) {
            // When uploadHandler is set, let imageUploadPlugin handle it
            if (options.uploadHandler) return false;
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;

            const file = files[0];
            if (!file || !options.allowedMimeTypes.includes(file.type)) return false;
            if (options.maxFileSize > 0 && file.size > options.maxFileSize) return false;

            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!pos) return false;

            void readFileAsDataURL(file).then(src => {
              const tr = view.state.tr;
              tr.insert(pos.pos, nodeType.create({ src }));
              view.dispatch(tr);
            });
            return true;
          },
        },
        view() {
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

    // Paste/drop upload plugin
    if (options.uploadHandler && nodeType) {
      plugins.push(
        imageUploadPlugin({
          nodeType,
          uploadHandler: options.uploadHandler,
          allowedMimeTypes: options.allowedMimeTypes,
          maxFileSize: options.maxFileSize,
          onUploadStart: options.onUploadStart,
          onUploadError: options.onUploadError,
        }),
      );
    }

    return plugins;
  },
});
