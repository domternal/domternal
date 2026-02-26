/**
 * Image Node
 *
 * Block-level (default) or inline image element.
 * Supports src, alt, title, width, height, loading, crossorigin, float attributes.
 *
 * Options:
 * - inline: false (default) — block-level image | true — inline image within paragraphs
 * - allowBase64: true (default) — allow data:image/ URLs | false — only http/https URLs
 *
 * XSS Protection (blocklist approach):
 * - Blocks javascript:, vbscript:, file: protocols
 * - Blocks data: URLs unless allowBase64 AND specifically data:image/
 * - Allows http(s), relative paths, protocol-relative URLs
 * - Defense in depth: validated in parseHTML, renderHTML, setImage command, and input rule
 */

import { Node, PluginKey, positionFloating, defaultIcons } from '@domternal/core';
import type { Editor, CommandSpec, ToolbarItem } from '@domternal/core';
import { Plugin } from 'prosemirror-state';
import { InputRule } from 'prosemirror-inputrules';
import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { imageUploadPlugin } from './imageUploadPlugin.js';

/** Float values for image text wrapping. */
export type ImageFloat = 'none' | 'left' | 'right' | 'center';

/**
 * Typed options for the setImage command.
 * src is required — it makes no sense to insert an image without a source URL.
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
}

declare module '@domternal/core' {
  interface RawCommands {
    setImage: CommandSpec<[attributes: SetImageOptions]>;
    setImageFloat: CommandSpec<[float: ImageFloat]>;
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
}

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
      // Bubble menu only: float controls
      { type: 'button', name: 'imageFloatNone', command: 'setImageFloat', commandArgs: ['none'], icon: 'imageInline', label: 'Inline', group: 'image-float', priority: 100, isActive: { name: 'image', attributes: { float: 'none' } }, toolbar: false },
      { type: 'button', name: 'imageFloatLeft', command: 'setImageFloat', commandArgs: ['left'], icon: 'textAlignLeft', label: 'Float left', group: 'image-float', priority: 90, isActive: { name: 'image', attributes: { float: 'left' } }, toolbar: false },
      { type: 'button', name: 'imageFloatCenter', command: 'setImageFloat', commandArgs: ['center'], icon: 'textAlignCenter', label: 'Center', group: 'image-float', priority: 80, isActive: { name: 'image', attributes: { float: 'center' } }, toolbar: false },
      { type: 'button', name: 'imageFloatRight', command: 'setImageFloat', commandArgs: ['right'], icon: 'textAlignRight', label: 'Float right', group: 'image-float', priority: 70, isActive: { name: 'image', attributes: { float: 'right' } }, toolbar: false },
      // Bubble menu only: delete
      { type: 'button', name: 'deleteImage', command: 'deleteImage', icon: 'trash', label: 'Delete', group: 'image-actions', priority: 50, toolbar: false },
    ];
  },

  addNodeView() {
    return (node: PmNode, view: EditorView, getPos: () => number | undefined) => {
      const dom = document.createElement('div');
      dom.className = 'dm-image-resizable';
      dom.draggable = true;

      const applyFloat = (float: string): void => {
        if (float && float !== 'none') {
          dom.setAttribute('data-float', float);
        } else {
          dom.removeAttribute('data-float');
        }
      };
      applyFloat(node.attrs['float'] as string);

      const img = document.createElement('img');
      img.src = node.attrs['src'] as string;
      if (node.attrs['alt']) img.alt = node.attrs['alt'] as string;
      if (node.attrs['title']) img.title = node.attrs['title'] as string;
      if (node.attrs['width']) {
        img.style.width = `${String(node.attrs['width'] as number)}px`;
      }
      dom.appendChild(img);

      // Resize handles (4 corners)
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = `dm-image-handle dm-image-handle-${corner}`;
        handle.addEventListener('mousedown', (e) => {
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
            const tr = view.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
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
          img.alt = updatedNode.attrs['alt'] as string;
          img.title = updatedNode.attrs['title'] as string;
          if (updatedNode.attrs['width']) {
            img.style.width = `${String(updatedNode.attrs['width'] as number)}px`;
          } else {
            img.style.width = '';
          }
          applyFloat(updatedNode.attrs['float'] as string);
          node = updatedNode;
          return true;
        },
        selectNode() {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode() {
          dom.classList.remove('ProseMirror-selectednode');
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        destroy() {},
      };
    };
  },

  addCommands() {
    return {
      setImage:
        (attributes: SetImageOptions) =>
        ({ tr, dispatch }) => {
          // XSS protection: validate src URL before inserting
          if (!isValidImageSrc(attributes.src, this.options.allowBase64)) {
            return false;
          }

          if (!this.nodeType) return false;

          if (dispatch) {
            const node = this.nodeType.create(attributes);
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

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'dm-image-popover-btn dm-image-popover-apply';
      applyBtn.title = 'Insert image';
      applyBtn.innerHTML = defaultIcons['check'] ?? '';

      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'dm-image-popover-btn dm-image-popover-browse';
      browseBtn.title = 'Browse files';
      browseBtn.innerHTML = defaultIcons['image'] ?? '';

      el.appendChild(urlInput);
      el.appendChild(applyBtn);
      el.appendChild(browseBtn);

      let isOpen = false;
      let cleanupFloating: (() => void) | null = null;
      let toggleAnchor: HTMLElement | null = null;

      const showPopover = (anchorElement?: HTMLElement): void => {
        toggleAnchor = anchorElement ?? null;
        urlInput.value = '';
        el.setAttribute('data-show', '');
        isOpen = true;
        storage['isOpen'] = true;
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

        urlInput.focus();
      };

      const hidePopover = (): void => {
        if (!isOpen) return;
        toggleAnchor = null;
        cleanupFloating?.();
        cleanupFloating = null;
        el.removeAttribute('data-show');
        isOpen = false;
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
        const src = urlInput.value.trim();
        if (src && isValidImageSrc(src, options.allowBase64)) {
          editor.commands.setImage({ src });
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
          showPopover(data.anchorElement);
        }
      };

      // Popover event listeners
      const onInputKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') { e.preventDefault(); applyUrl(); }
        else if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
        else if (e.key === 'Tab') { e.preventDefault(); applyBtn.focus(); }
      };

      const onButtonKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
        else if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).click(); }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const target = e.target as HTMLElement;
          if (e.shiftKey) {
            if (target === applyBtn) urlInput.focus();
            else applyBtn.focus();
          } else {
            if (target === applyBtn) browseBtn.focus();
            else urlInput.focus();
          }
        }
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
          applyBtn.addEventListener('mousedown', onPreventBlur);
          applyBtn.addEventListener('click', applyUrl);
          applyBtn.addEventListener('keydown', onButtonKeydown);
          browseBtn.addEventListener('mousedown', onPreventBlur);
          browseBtn.addEventListener('click', openFileBrowser);
          browseBtn.addEventListener('keydown', onButtonKeydown);
          document.addEventListener('mousedown', onClickOutside);

          // 'insertImage' is a dynamic event not in EditorEvents — cast once
          interface DynEvents { on(e: string, fn: typeof onInsertImage): void; off(e: string, fn: typeof onInsertImage): void }
          const dynEditor = editor as unknown as DynEvents;
          dynEditor.on('insertImage', onInsertImage);

          return {
            destroy() {
              hidePopover();
              urlInput.removeEventListener('keydown', onInputKeydown);
              applyBtn.removeEventListener('mousedown', onPreventBlur);
              applyBtn.removeEventListener('click', applyUrl);
              applyBtn.removeEventListener('keydown', onButtonKeydown);
              browseBtn.removeEventListener('mousedown', onPreventBlur);
              browseBtn.removeEventListener('click', openFileBrowser);
              browseBtn.removeEventListener('keydown', onButtonKeydown);
              document.removeEventListener('mousedown', onClickOutside);
              dynEditor.off('insertImage', onInsertImage);
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
