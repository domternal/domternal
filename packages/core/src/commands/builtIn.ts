/**
 * Built-in commands converted to CommandSpec format
 *
 * These commands are merged with extension commands
 * to provide a unified command API.
 */
import { TextSelection, AllSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { toggleMark as pmToggleMark, setBlockType as pmSetBlockType, wrapIn as pmWrapIn, lift as pmLift, selectNodeBackward as pmSelectNodeBackward } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { Fragment, Slice, DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import type { Attrs } from 'prosemirror-model';
import type { CommandSpec, RawCommands } from '../types/Commands.js';
import type { FocusPosition, Content } from '../types/index.js';
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
 * Resolves focus position to a numeric position in the document
 */
function resolveFocusPosition(
  view: EditorView,
  position: FocusPosition
): number | null {
  const { doc } = view.state;

  if (position === null || position === false) {
    return null;
  }

  if (position === true || position === 'end') {
    return doc.content.size - 1;
  }

  if (position === 'start') {
    return 1;
  }

  if (position === 'all') {
    return null;
  }

  if (typeof position === 'number') {
    return Math.max(0, Math.min(position, doc.content.size));
  }

  return null;
}

/**
 * Focus command - focuses the editor at the specified position
 *
 * @param position - Where to place the cursor
 *   - true/'end': End of document
 *   - 'start': Start of document
 *   - 'all': Select all content
 *   - number: Specific position
 *   - null/false: Just focus without changing selection
 */
export const focus: CommandSpec<[position?: FocusPosition]> =
  (position: FocusPosition = null) =>
  ({ editor, state, tr, dispatch }) => {
    const view = editor.view as EditorView;

    // Check if view is attached to DOM (dry-run always returns true)
    if (!dispatch) {
      return true;
    }

    if (!view.dom.isConnected) {
      return false;
    }

    // Focus the editor
    view.focus();

    // Handle 'all' position - select all content
    if (position === 'all') {
      const selection = new AllSelection(state.doc);
      dispatch(tr.setSelection(selection));
      return true;
    }

    // Resolve position to cursor location
    const resolvedPos = resolveFocusPosition(view, position);

    if (resolvedPos !== null) {
      const $pos = state.doc.resolve(resolvedPos);
      const selection = TextSelection.near($pos);
      dispatch(tr.setSelection(selection));
    }

    return true;
  };

/**
 * Blur command - removes focus from the editor
 */
export const blur: CommandSpec =
  () =>
  ({ editor, dispatch }) => {
    const view = editor.view as EditorView;

    // Dry-run always returns true
    if (!dispatch) {
      return true;
    }

    view.dom.blur();
    return true;
  };

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
    tr.replaceWith(0, state.doc.content.size, doc.content);

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
    tr.replaceWith(0, state.doc.content.size, doc.content);

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
 * DeleteSelection command - deletes the current selection
 */
export const deleteSelection: CommandSpec =
  () =>
  ({ tr, dispatch }) => {
    // Use tr.selection for chain compatibility
    const { selection } = tr;

    // Can only delete if there's a selection range
    if (selection.empty) {
      return false;
    }

    // In dry-run mode, just check if delete is possible
    if (!dispatch) {
      return true;
    }

    tr.deleteSelection();
    dispatch(tr);
    return true;
  };

/**
 * SelectAll command - selects all content in the editor
 */
export const selectAll: CommandSpec =
  () =>
  ({ state, tr, dispatch }) => {
    // In dry-run mode, always possible
    if (!dispatch) {
      return true;
    }

    const selection = new AllSelection(state.doc);
    tr.setSelection(selection);
    dispatch(tr);
    return true;
  };

// ============================================================================
// Mark Commands
// ============================================================================

/**
 * ToggleMark command - toggles a mark on the current selection
 *
 * @param markName - The name of the mark to toggle
 * @param attributes - Optional attributes for the mark
 */
export const toggleMark: CommandSpec<[markName: string, attributes?: Attrs]> =
  (markName: string, attributes?: Attrs) =>
  ({ state, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    // Note: pmToggleMark internally handles dispatch=undefined for dry-run mode.
    // This is different from other commands that explicitly check !dispatch,
    // but the behavior is identical - it returns true/false without side effects.
    return pmToggleMark(markType, attributes)(state, dispatch);
  };

/**
 * SetMark command - adds a mark to the current selection
 *
 * @param markName - The name of the mark to set
 * @param attributes - Optional attributes for the mark
 */
export const setMark: CommandSpec<[markName: string, attributes?: Attrs]> =
  (markName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    const { from, to, empty } = tr.selection;

    // Can't add mark to empty selection (unless storedMarks)
    if (empty) {
      // For empty selection, add to stored marks
      if (!dispatch) {
        return true;
      }

      const mark = markType.create(attributes);
      tr.addStoredMark(mark);
      dispatch(tr);
      return true;
    }

    if (!dispatch) {
      return true;
    }

    tr.addMark(from, to, markType.create(attributes));
    dispatch(tr);
    return true;
  };

/**
 * UnsetMark command - removes a mark from the current selection
 *
 * @param markName - The name of the mark to remove
 */
export const unsetMark: CommandSpec<[markName: string]> =
  (markName: string) =>
  ({ state, tr, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    const { from, to, empty } = tr.selection;

    // For empty selection, remove from stored marks
    if (empty) {
      if (!dispatch) {
        return true;
      }

      tr.removeStoredMark(markType);
      dispatch(tr);
      return true;
    }

    if (!dispatch) {
      return true;
    }

    tr.removeMark(from, to, markType);
    dispatch(tr);
    return true;
  };

// ============================================================================
// Block Commands
// ============================================================================

/**
 * SetBlockType command - changes the block type of the selection
 *
 * @param nodeName - The name of the node type to set
 * @param attributes - Optional attributes for the node
 */
export const setBlockType: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  ({ state, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    return pmSetBlockType(nodeType, attributes)(state, dispatch);
  };

/**
 * ToggleBlockType command - toggles between a block type and a default type
 *
 * If the current block is of the target type, changes it to the default type.
 * If the current block is not of the target type, changes it to the target type.
 *
 * @param nodeName - The name of the node type to toggle to
 * @param defaultNodeName - The name of the default node type (usually 'paragraph')
 * @param attributes - Optional attributes for the node
 */
export const toggleBlockType: CommandSpec<[nodeName: string, defaultNodeName: string, attributes?: Attrs]> =
  (nodeName: string, defaultNodeName: string, attributes?: Attrs) =>
  ({ state, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];
    const defaultNodeType = state.schema.nodes[defaultNodeName];

    if (!nodeType || !defaultNodeType) {
      return false;
    }

    // Check if the current block is of the target type
    const { $from } = state.selection;
    const currentNode = $from.parent;

    // If current block matches target type, toggle to default
    if (currentNode.type === nodeType) {
      return pmSetBlockType(defaultNodeType)(state, dispatch);
    }

    // Otherwise, set to target type
    return pmSetBlockType(nodeType, attributes)(state, dispatch);
  };

/**
 * WrapIn command - wraps the selection in a node type
 *
 * @param nodeName - The name of the wrapping node type
 * @param attributes - Optional attributes for the node
 */
export const wrapIn: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  ({ state, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    return pmWrapIn(nodeType, attributes)(state, dispatch);
  };

/**
 * ToggleWrap command - toggles wrapping of the selection in a node type
 *
 * If the selection is already wrapped in the node type, lifts it out.
 * Otherwise, wraps the selection in the node type.
 *
 * @param nodeName - The name of the wrapping node type
 * @param attributes - Optional attributes for the node
 */
export const toggleWrap: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  ({ state, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    // Check if we're already inside a node of this type
    const { $from } = state.selection;
    let isWrapped = false;

    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === nodeType) {
        isWrapped = true;
        break;
      }
    }

    // If wrapped, lift out; otherwise wrap
    if (isWrapped) {
      return pmLift(state, dispatch);
    }

    return pmWrapIn(nodeType, attributes)(state, dispatch);
  };

// ============================================================================
// Lift Command
// ============================================================================

/**
 * Lift command - lifts the current block out of its parent wrapper
 *
 * For example, lifts a paragraph out of a blockquote.
 */
export const lift: CommandSpec =
  () =>
  ({ state, dispatch }) => {
    return pmLift(state, dispatch);
  };

// ============================================================================
// List Commands
// ============================================================================

/**
 * ToggleList command - toggles a list type on the current selection
 *
 * If the selection is not in a list, wraps it in the specified list type.
 * If it's in the same list type, lifts the list items out.
 * If it's in a different list type, converts to the new list type in-place.
 *
 * @param listNodeName - The name of the list node type (e.g., 'bulletList', 'orderedList')
 * @param listItemNodeName - The name of the list item node type (usually 'listItem')
 * @param attributes - Optional attributes for the list node
 */
export const toggleList: CommandSpec<[listNodeName: string, listItemNodeName: string, attributes?: Attrs]> =
  (listNodeName: string, listItemNodeName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const listType = state.schema.nodes[listNodeName];
    const listItemType = state.schema.nodes[listItemNodeName];

    if (!listType || !listItemType) {
      return false;
    }

    const { $from } = state.selection;

    // Find if we're already in a list and get details
    let listDepth: number | null = null;
    let currentListType: typeof listType | null = null;

    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      // Check if this node is the target list type or any kind of list
      // Split by whitespace for exact group match (avoids 'playlist' matching 'list')
      const groups = (node.type.spec.group ?? '').split(/\s+/);
      if (node.type === listType || groups.includes('list')) {
        listDepth = depth;
        currentListType = node.type;
        break;
      }
    }

    // Case 1: We're in the same list type → lift items out
    if (currentListType === listType) {
      return liftListItem(listItemType)(state, dispatch);
    }

    // Case 2: We're in a different list type → convert by changing node type in-place
    if (listDepth !== null && currentListType !== null && currentListType !== listType) {
      const pos = $from.before(listDepth);

      if (!dispatch) {
        return true; // Can convert
      }

      // Change the list node type in place, preserving content and structure
      tr.setNodeMarkup(pos, listType, attributes);
      dispatch(tr);
      return true;
    }

    // Case 3: Not in a list → wrap in the target list type
    return wrapInList(listType, attributes)(state, dispatch);
  };

// ============================================================================
// Insert Content Command
// ============================================================================

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

// ============================================================================
// Selection Commands
// ============================================================================

/**
 * SelectNodeBackward command - selects the node before the cursor
 *
 * When the cursor is at the start of a textblock, this selects the node before it.
 */
export const selectNodeBackward: CommandSpec =
  () =>
  ({ state, dispatch }) => {
    return pmSelectNodeBackward(state, dispatch);
  };

// ============================================================================
// Attribute Commands
// ============================================================================

/**
 * UpdateAttributes command - updates attributes on nodes matching a type
 *
 * Updates attributes on all nodes of the specified type within the selection.
 *
 * @param typeOrName - The node type name or NodeType to update
 * @param attributes - The attributes to merge into existing attributes
 */
export const updateAttributes: CommandSpec<[typeOrName: string, attributes: Record<string, unknown>]> =
  (typeOrName: string, attributes: Record<string, unknown>) =>
  ({ state, tr, dispatch }) => {
    const type = state.schema.nodes[typeOrName] ?? state.schema.marks[typeOrName];

    if (!type) {
      return false;
    }

    const { from, to } = tr.selection;
    const nodeChanges: { pos: number; attrs: Record<string, unknown> }[] = [];
    const markChanges: { pos: number; nodeSize: number; attrs: Record<string, unknown> }[] = [];

    // For nodes - collect changes
    if (state.schema.nodes[typeOrName]) {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === typeOrName) {
          nodeChanges.push({ pos, attrs: { ...node.attrs, ...attributes } });
        }
      });
    }

    // For marks - collect changes
    if (state.schema.marks[typeOrName]) {
      const markType = state.schema.marks[typeOrName];
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;

        const mark = markType.isInSet(node.marks);
        if (mark) {
          markChanges.push({
            pos,
            nodeSize: node.nodeSize,
            attrs: { ...mark.attrs, ...attributes },
          });
        }
      });
    }

    const hasChanges = nodeChanges.length > 0 || markChanges.length > 0;

    if (hasChanges && dispatch) {
      // Apply node changes
      for (const change of nodeChanges) {
        tr.setNodeMarkup(change.pos, undefined, change.attrs);
      }

      // Apply mark changes
      if (state.schema.marks[typeOrName]) {
        const markType = state.schema.marks[typeOrName];
        for (const change of markChanges) {
          const newMark = markType.create(change.attrs);
          tr.removeMark(change.pos, change.pos + change.nodeSize, markType);
          tr.addMark(change.pos, change.pos + change.nodeSize, newMark);
        }
      }

      dispatch(tr);
    }

    return hasChanges;
  };

/**
 * ResetAttributes command - resets an attribute to its default value
 *
 * Resets the specified attribute on all nodes of the given type within the selection
 * to the default value defined in the schema.
 *
 * @param typeOrName - The node type name to update
 * @param attributeName - The name of the attribute to reset
 */
export const resetAttributes: CommandSpec<[typeOrName: string, attributeName: string]> =
  (typeOrName: string, attributeName: string) =>
  ({ state, tr, dispatch }) => {
    const nodeType = state.schema.nodes[typeOrName];
    const markType = state.schema.marks[typeOrName];

    if (!nodeType && !markType) {
      return false;
    }

    const { from, to } = tr.selection;
    const nodeChanges: { pos: number; attrs: Record<string, unknown> }[] = [];
    const markChanges: { pos: number; nodeSize: number; attrs: Record<string, unknown> }[] = [];

    // For nodes - collect changes
    if (nodeType) {
      const defaultValue: unknown = nodeType.spec.attrs?.[attributeName]?.default;

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === nodeType) {
          nodeChanges.push({
            pos,
            attrs: { ...node.attrs, [attributeName]: defaultValue },
          });
        }
      });
    }

    // For marks - collect changes
    if (markType) {
      const defaultValue: unknown = markType.spec.attrs?.[attributeName]?.default;

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;

        const mark = markType.isInSet(node.marks);
        if (mark) {
          markChanges.push({
            pos,
            nodeSize: node.nodeSize,
            attrs: { ...mark.attrs, [attributeName]: defaultValue },
          });
        }
      });
    }

    const hasChanges = nodeChanges.length > 0 || markChanges.length > 0;

    if (hasChanges && dispatch) {
      // Apply node changes
      for (const change of nodeChanges) {
        tr.setNodeMarkup(change.pos, undefined, change.attrs);
      }

      // Apply mark changes
      if (markType) {
        for (const change of markChanges) {
          const newMark = markType.create(change.attrs);
          tr.removeMark(change.pos, change.pos + change.nodeSize, markType);
          tr.addMark(change.pos, change.pos + change.nodeSize, newMark);
        }
      }

      dispatch(tr);
    }

    return hasChanges;
  };

/**
 * All built-in commands as RawCommands
 * These are merged with extension commands in CommandManager
 */
export const builtInCommands: RawCommands = {
  focus,
  blur,
  setContent,
  clearContent,
  insertText,
  deleteSelection,
  selectAll,
  // Mark commands
  toggleMark,
  setMark,
  unsetMark,
  // Block commands
  setBlockType,
  toggleBlockType,
  // Wrap commands
  wrapIn,
  toggleWrap,
  // Lift command
  lift,
  // List commands
  toggleList,
  // Insert commands
  insertContent,
  // Selection commands
  selectNodeBackward,
  // Attribute commands
  updateAttributes,
  resetAttributes,
} as RawCommands;
