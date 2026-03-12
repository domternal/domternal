/**
 * Content commands — setContent, clearContent, insertText, insertContent
 */
import { TextSelection } from '@domternal/pm/state';
import { Fragment, Slice, DOMParser as ProseMirrorDOMParser } from '@domternal/pm/model';
import type { CommandSpec } from '../types/Commands.js';
import type { Content } from '../types/index.js';
import { createDocument } from '../helpers/index.js';

/**
 * Options for setContent command
 */
export interface SetContentOptions {
  /**
   * Emit update event after setting content
   * @default true
   */
  emitUpdate?: boolean;

  /**
   * Parse options for HTML content
   */
  parseOptions?: Record<string, unknown>;
}

/**
 * Options for clearContent command
 */
export interface ClearContentOptions {
  /**
   * Emit update event after clearing content
   * @default true
   */
  emitUpdate?: boolean;
}

/**
 * SetContent command - sets the editor content
 *
 * @param content - JSON or HTML content
 * @param options - Options for setting content
 */
export const setContent: CommandSpec<[content: Content, options?: SetContentOptions]> =
  (content: Content, options: SetContentOptions = {}) =>
  ({ state, tr, dispatch }) => {
    const { emitUpdate = true, parseOptions } = options;
    const { schema } = state;

    // Parse content into document (with graceful error handling)
    let doc;
    try {
      doc = createDocument(content, schema, { parseOptions });
    } catch {
      // Invalid content - return false to indicate command failed
      return false;
    }

    // In dry-run mode, just check if content can be created
    if (!dispatch) {
      return true;
    }

    // Replace entire document
    // Use tr.doc for chain compatibility - prior commands may have modified the document
    tr.replaceWith(0, tr.doc.content.size, doc.content);

    // Mark transaction to potentially skip update event
    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    dispatch(tr);
    return true;
  };

/**
 * ClearContent command - clears the editor content to empty state
 *
 * @param options - Options for clearing content
 */
export const clearContent: CommandSpec<[options?: ClearContentOptions]> =
  (options: ClearContentOptions = {}) =>
  ({ state, tr, dispatch }) => {
    const { emitUpdate = true } = options;
    const { schema } = state;

    // Create empty document
    const doc = createDocument(null, schema);

    // In dry-run mode, just return true
    if (!dispatch) {
      return true;
    }

    // Replace entire document
    // Use tr.doc for chain compatibility - prior commands may have modified the document
    tr.replaceWith(0, tr.doc.content.size, doc.content);

    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    dispatch(tr);
    return true;
  };

/**
 * InsertText command - inserts text at the current selection
 *
 * @param text - Text to insert
 */
export const insertText: CommandSpec<[text: string]> =
  (text: string) =>
  ({ tr, dispatch }) => {
    // Use tr.selection for chain compatibility - reflects current position
    const { from, to } = tr.selection;

    // For TextSelection, check if parent allows inline content
    // For other selections (AllSelection, NodeSelection), let ProseMirror handle validation
    if (tr.selection instanceof TextSelection) {
      const { $from } = tr.selection;
      if (!$from.parent.inlineContent) {
        return false;
      }
    }

    if (!dispatch) {
      return true;
    }

    tr.insertText(text, from, to);
    dispatch(tr);
    return true;
  };

/**
 * InsertContent command - inserts content at the current selection
 *
 * @param content - The content to insert (JSON object, array, or HTML string)
 */
export const insertContent: CommandSpec<[content: Content]> =
  (content: Content) =>
  ({ state, tr, dispatch }) => {
    const { schema } = state;
    const { from, to } = tr.selection;

    // Parse content based on type
    let fragment: Fragment;

    if (typeof content === 'string') {
      // HTML string - parse using DOMParser
      if (typeof window === 'undefined') {
        return false; // Can't parse HTML in SSR without DOM
      }

      const parser = ProseMirrorDOMParser.fromSchema(schema);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = content;
      const parsed = parser.parse(wrapper);
      fragment = parsed.content;
    } else if (content && typeof content === 'object') {
      // JSON content
      if (Array.isArray(content)) {
        // Array of nodes
        const nodes = content.map(item => schema.nodeFromJSON(item));
        fragment = Fragment.from(nodes);
      } else if ('type' in content) {
        // Single node or document
        const node = schema.nodeFromJSON(content);
        // If it's a doc, use its content; otherwise wrap in fragment
        fragment = node.type.name === 'doc' ? node.content : Fragment.from(node);
      } else {
        return false;
      }
    } else {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    // Insert the content
    tr.replaceRange(from, to, new Slice(fragment, 0, 0));
    dispatch(tr);
    return true;
  };
