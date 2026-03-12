/**
 * Image Upload Plugin
 *
 * Handles paste/drop of image files with decoration-based placeholders.
 * The document never contains temporary data — a widget decoration shows
 * a loading indicator while the upload is in progress.
 *
 * On success: placeholder removed, real image node inserted.
 * On error: placeholder removed, onUploadError called.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import type { EditorView } from '@domternal/pm/view';
import type { NodeType } from '@domternal/pm/model';

export const imageUploadPluginKey = new PluginKey('imageUpload');

export interface ImageUploadPluginOptions {
  /** The image node type from schema */
  nodeType: NodeType;
  /** Upload handler — must return URL string */
  uploadHandler: (file: File) => Promise<string>;
  /** Allowed MIME types */
  allowedMimeTypes: string[];
  /** Max file size in bytes (0 = unlimited) */
  maxFileSize: number;
  /** Called when upload starts for a file */
  onUploadStart: ((file: File) => void) | null;
  /** Error callback */
  onUploadError: ((error: Error, file: File) => void) | null;
}

/** Validate file before upload */
function isValidImageFile(
  file: File,
  allowedMimeTypes: string[],
  maxFileSize: number,
): boolean {
  if (!allowedMimeTypes.includes(file.type)) return false;
  if (maxFileSize > 0 && file.size > maxFileSize) return false;
  return true;
}

/** Generate unique placeholder ID */
let placeholderCounter = 0;
function createPlaceholderId(): string {
  return `image-upload-${String(++placeholderCounter)}`;
}

/** Reset placeholder counter (for testing) */
export function _resetPlaceholderCounter(): void {
  placeholderCounter = 0;
}

/** Create placeholder DOM element */
function createPlaceholderElement(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'domternal-image-uploading';
  return div;
}

export function imageUploadPlugin(options: ImageUploadPluginOptions): Plugin {
  const {
    nodeType,
    uploadHandler,
    allowedMimeTypes,
    maxFileSize,
    onUploadStart,
    onUploadError,
  } = options;

  function handleFiles(view: EditorView, files: File[], pos: number): void {
    for (const file of files) {
      const id = createPlaceholderId();

      // Add placeholder decoration
      const tr = view.state.tr;
      tr.setMeta(imageUploadPluginKey, { type: 'add', id, pos });
      view.dispatch(tr);

      if (onUploadStart) onUploadStart(file);

      // Start upload
      uploadHandler(file)
        .then((url) => {
          // Find placeholder position (may have shifted due to edits)
          const decos = imageUploadPluginKey.getState(
            view.state,
          ) as DecorationSet | null;
          const found = decos?.find(
            undefined,
            undefined,
            (spec: Record<string, unknown>) => spec['id'] === id,
          );
          const placeholderPos = found?.[0]?.from;

          if (placeholderPos === undefined) return; // placeholder was removed (editor destroyed?)

          // Remove placeholder + insert image node
          const insertTr = view.state.tr;
          insertTr.setMeta(imageUploadPluginKey, { type: 'remove', id });
          insertTr.insert(placeholderPos, nodeType.create({ src: url }));
          view.dispatch(insertTr);
        })
        .catch((error: unknown) => {
          // Remove placeholder on error
          const removeTr = view.state.tr;
          removeTr.setMeta(imageUploadPluginKey, { type: 'remove', id });
          view.dispatch(removeTr);

          if (onUploadError) {
            onUploadError(
              error instanceof Error ? error : new Error(String(error)),
              file,
            );
          }
        });
    }
  }

  return new Plugin({
    key: imageUploadPluginKey,

    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, decorations) {
        // Map decorations through document changes
        decorations = decorations.map(tr.mapping, tr.doc);

        const action = tr.getMeta(imageUploadPluginKey) as
          | { type: 'add'; id: string; pos: number }
          | { type: 'remove'; id: string }
          | undefined;

        if (action?.type === 'add') {
          const widget = Decoration.widget(
            action.pos,
            createPlaceholderElement(),
            { id: action.id },
          );
          return decorations.add(tr.doc, [widget]);
        }

        if (action?.type === 'remove') {
          const found = decorations.find(
            undefined,
            undefined,
            (spec: Record<string, unknown>) => spec['id'] === action.id,
          );
          return decorations.remove(found);
        }

        return decorations;
      },
    },

    props: {
      decorations(state) {
        return imageUploadPluginKey.getState(state) as DecorationSet;
      },

      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;

        const files: File[] = [];
        for (const item of Array.from(items)) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (
              file &&
              isValidImageFile(file, allowedMimeTypes, maxFileSize)
            ) {
              files.push(file);
            }
          }
        }

        if (files.length === 0) return false;

        event.preventDefault();
        handleFiles(view, files, view.state.selection.from);
        return true;
      },

      handleDrop(view, event) {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer?.files || dataTransfer.files.length === 0)
          return false;

        const imageFiles: File[] = [];
        for (const file of Array.from(dataTransfer.files)) {
          if (isValidImageFile(file, allowedMimeTypes, maxFileSize)) {
            imageFiles.push(file);
          }
        }

        if (imageFiles.length === 0) return false;

        event.preventDefault();

        // Get drop position
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!pos) return false;

        handleFiles(view, imageFiles, pos.pos);
        return true;
      },
    },
  });
}
