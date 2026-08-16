/**
 * Canonical block-id system. Assigns ids to configured node types and is
 * read by TableOfContents and BlockContextMenu.
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey, type Transaction } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { Editor } from '../Editor.js';

function generateUUID(): string {
  // Prefer the browser/Node crypto API: cryptographically random and
  // standardised. Fall back to Math.random() for hostile or test
  // environments (jsdom prior to v22, very old shims) where
  // `crypto.randomUUID` is missing.
  if (typeof globalThis !== 'undefined') {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const uniqueIDPluginKey = new PluginKey('uniqueID');

/** What a paste transform reads off the view; structural so a stub works. */
interface PasteView {
  dragging?: { move?: boolean } | null;
  state?: {
    selection?: {
      ranges?: readonly { $from: { pos: number }; $to: { pos: number } }[];
    };
  };
}

/** Whether `[from, to)` lies entirely inside one of the given ranges. */
function isWithin(
  from: number,
  to: number,
  ranges: readonly { from: number; to: number }[]
): boolean {
  return ranges.some((range) => from >= range.from && to <= range.to);
}

export interface UniqueIDOptions {
  /**
   * Node types that should receive unique IDs.
   * @default ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'image', 'horizontalRule', 'table']
   */
  types: string[];

  /**
   * Attribute name to store the unique ID.
   * @default 'id'
   */
  attributeName: string;

  /**
   * Function to generate unique IDs.
   * @default generateUUID
   */
  generateID: () => string;

  /**
   * Whether to filter duplicates when pasting content.
   * @default true
   */
  filterDuplicates: boolean;
}

export const UniqueID = Extension.create<UniqueIDOptions>({
  name: 'uniqueID',

  addOptions() {
    return {
      types: [
        'paragraph',
        'heading',
        'blockquote',
        'codeBlock',
        'bulletList',
        'orderedList',
        'taskList',
        'listItem',
        'taskItem',
        'image',
        'horizontalRule',
        // Listed even though it lives in a separate package, exactly as
        // `image` already is: a global attribute only installs on types the
        // schema actually has, so naming it is inert when the table extension
        // is not loaded. Without it a table is the one block the block menu
        // cannot Copy link, and the one an id-anchored feature cannot address.
        'table',
      ],
      attributeName: 'id',
      generateID: generateUUID,
      filterDuplicates: true,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [this.options.attributeName]: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(this.options.attributeName),
            renderHTML: (attributes: Record<string, unknown>) => {
              const id = attributes[this.options.attributeName] as string | null;
              if (!id) return null;
              return { [this.options.attributeName]: id };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { types, attributeName, generateID, filterDuplicates } = this.options;
    const editor = this.editor as Editor | null;

    /** The ranges a paste is about to delete. */
    const replacedRanges = (view?: PasteView): { from: number; to: number }[] => {
      // A drop inserts at the drop point and leaves the selection alone, so
      // there the selection names content that SURVIVES.
      if (view?.dragging) return [];
      const ranges = view?.state?.selection?.ranges;
      if (ranges === undefined) return [];
      const replaced: { from: number; to: number }[] = [];
      for (const range of ranges) {
        if (range.$to.pos > range.$from.pos) {
          replaced.push({ from: range.$from.pos, to: range.$to.pos });
        }
      }
      return replaced;
    };

    /**
     * ProseMirror runs this on the DRAGGED slice too, before the source is
     * deleted, so a plain block move looks like a duplicate and the moved block
     * would land with a fresh id, breaking every reference to it.
     *
     * `move` is false for a copy drag, which should still regenerate. If a move
     * never completes, `assignMissingIDs` catches the duplicate.
     */
    const transformPastedSlice = (slice: Slice, view?: PasteView): Slice => {
      if (view?.dragging?.move === true) return slice;

      const existingIDs = new Set<string>();
      const replaced = replacedRanges(view);

      // Existing ids, minus the ones the paste is about to delete: a block
      // being replaced is not an incumbent, and counting it renamed the very
      // content replacing it (Ctrl+A then paste), orphaning every reference.
      // A `handlePaste` that inserts elsewhere can defeat this; the cost is a
      // duplicate `assignMissingIDs` renames on the next transaction.
      editor?.state.doc.descendants((node: PMNode, pos: number) => {
        // Whole subtree: everything inside a replaced node is replaced too.
        if (isWithin(pos, pos + node.nodeSize, replaced)) return false;
        const id = node.attrs[attributeName] as string | undefined;
        if (id) existingIDs.add(id);
        return true;
      });

      // Transform pasted content
      const transformNode = (node: PMNode): PMNode => {
        if (!types.includes(node.type.name)) {
          return node.copy(transformFragment(node.content));
        }

        const existingID = node.attrs[attributeName] as string | undefined;
        if (existingID && existingIDs.has(existingID)) {
          // Regenerate ID for duplicate
          return node.type.create(
            { ...node.attrs, [attributeName]: generateID() },
            transformFragment(node.content),
            node.marks
          );
        }

        // Track new ID
        if (existingID) existingIDs.add(existingID);
        return node.copy(transformFragment(node.content));
      };

      const transformFragment = (fragment: Fragment): Fragment => {
        const nodes: PMNode[] = [];
        fragment.forEach((node) => {
          nodes.push(transformNode(node));
        });
        return Fragment.from(nodes);
      };

      return new Slice(
        transformFragment(slice.content),
        slice.openStart,
        slice.openEnd
      );
    };

    // Helper to assign IDs to nodes that lack them, AND rename
    // duplicates so the doc stays a unique-id space (which is required
    // for native browser `#hash` anchors and `getElementById`).
    //
    // The duplicate-rename guarantee covers two real scenarios:
    //   1. setContent with markup that already has colliding ids (e.g.
    //      a saved snapshot with corrupted ids, or hand-written HTML).
    //   2. PM transactions that copy a node with its id (some commands
    //      like duplicateBlock spread attrs and would propagate the id;
    //      callers can override via transformAttrs, but if they don't,
    //      this catch-all keeps the doc consistent).
    //
    // Paste from outside the editor goes through `transformPasted`
    // (further down) and is handled there before this runs. This pass
    // is the safety net.
    /**
     * Where each id sat BEFORE this change, mapped forward into the new
     * document. Resolving a collision by document order instead lets a copy
     * pasted ABOVE its original keep the id and renames the original, so every
     * reference silently follows the copy. Having held the id is ownership;
     * position is not.
     */
    const incumbentPositions = (
      oldDoc: PMNode,
      mapPos: (pos: number) => number
    ): Map<string, number> => {
      const incumbents = new Map<string, number>();
      oldDoc.descendants((node, pos) => {
        if (!types.includes(node.type.name)) return;
        const id = node.attrs[attributeName] as string | undefined;
        // First holder wins if the OLD document was itself inconsistent, which
        // is the only case where document order is the right tie-break.
        if (id && !incumbents.has(id)) incumbents.set(id, mapPos(pos));
      });
      return incumbents;
    };

    const assignMissingIDs = (
      doc: PMNode,
      tr: Transaction,
      incumbents?: Map<string, number>
    ): void => {
      /**
       * Which position keeps each CONTESTED id. Only ids held by more than one
       * node are contested, so an id that merely moved (setContent remaps every
       * position) is untouched. When the mapped position is not one of the
       * occurrences the mapping did not survive, and document order decides.
       */
      const winners = new Map<string, number>();
      if (incumbents && incumbents.size > 0) {
        const occurrences = new Map<string, number[]>();
        doc.descendants((node, pos) => {
          if (!types.includes(node.type.name)) return;
          const id = node.attrs[attributeName] as string | undefined;
          if (!id) return;
          const list = occurrences.get(id);
          if (list) list.push(pos);
          else occurrences.set(id, [pos]);
        });
        for (const [id, positions] of occurrences) {
          if (positions.length < 2) continue;
          const incumbentPos = incumbents.get(id);
          winners.set(
            id,
            incumbentPos !== undefined && positions.includes(incumbentPos)
              ? incumbentPos
              : positions[0]!
          );
        }
      }

      const seen = new Set<string>();
      doc.descendants((node, pos) => {
        if (!types.includes(node.type.name)) return;

        const existingID = node.attrs[attributeName] as string | undefined;
        if (!existingID) {
          // Missing: assign a fresh one. Track it so subsequent nodes
          // with the same generated id (astronomically unlikely with
          // UUIDs) don't pass through.
          let id = generateID();
          while (seen.has(id)) id = generateID();
          seen.add(id);
          // Map the position through steps already applied to `tr` so
          // each setNodeMarkup lands at the right place even when the
          // earlier iteration changed offsets. (`setNodeMarkup` is not
          // length-changing, but the discipline matches the safer
          // pattern that other plugins use.)
          tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
            ...node.attrs,
            [attributeName]: id,
          });
          return;
        }
        // A node yields a CONTESTED id to whichever node held it before this
        // change, so a copy pasted ABOVE its original no longer steals the
        // original's identity. `seen` is left untouched so the winner still
        // passes through cleanly below.
        const winner = winners.get(existingID);
        const yieldsToWinner = winner !== undefined && winner !== pos;

        if (seen.has(existingID) || yieldsToWinner) {
          // Collision: rename this occurrence. Without an incumbent to defer
          // to, the first occurrence in document order keeps the id, which is
          // the rule most editors use when reconciling duplicate anchors.
          let id = generateID();
          while (seen.has(id)) id = generateID();
          seen.add(id);
          tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
            ...node.attrs,
            [attributeName]: id,
          });
          return;
        }
        seen.add(existingID);
      });
    };

    return [
      new Plugin({
        key: uniqueIDPluginKey,

        // Apply initial IDs after the view is ready
        view(editorView) {
          // Use setTimeout to avoid dispatching during plugin init, but
          // re-create the transaction from the *current* state inside the
          // callback to avoid stale-transaction bugs.
          const timeoutId = setTimeout(() => {
            const tr = editorView.state.tr;
            assignMissingIDs(editorView.state.doc, tr);
            if (tr.docChanged) {
              // Bookkeeping, not an edit the user made: see the appendTransaction below.
              tr.setMeta('addToHistory', false);
              editorView.dispatch(tr);
            }
          }, 0);
          return {
            destroy() {
              clearTimeout(timeoutId);
            },
          };
        },

        // Ensure new nodes get IDs
        appendTransaction(transactions, oldState, newState) {
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          // Positions of the nodes that already held each id, carried forward
          // through this batch, so a duplicate defers to the incumbent rather
          // than to whichever copy happens to sit higher in the document.
          const mapForward = (pos: number): number =>
            transactions.reduce((p, transaction) => transaction.mapping.map(p), pos);

          const tr = newState.tr;
          assignMissingIDs(newState.doc, tr, incumbentPositions(oldState.doc, mapForward));
          if (!tr.docChanged) return null;

          // A sweep with nothing to ride along on stays out of the undo stack,
          // or undo strips the ids, the next sweep mints different ones, and
          // every reference to the old id breaks with no visible cause.
          //
          // ONLY then, though. A blanket opt-out reads correctly under
          // prosemirror-history, which takes the flag per transaction, and is
          // destructive under y-prosemirror, which takes it from the LAST
          // transaction and stamps the batch's single Yjs transaction with it.
          // This sweep is always last, so that drops the user's own edit out of
          // collaborative undo: the block stays and Ctrl+Z does nothing.
          const ridesAlongWithAnEdit = transactions.some(
            (transaction) =>
              transaction.docChanged && transaction.getMeta('addToHistory') !== false
          );
          if (!ridesAlongWithAnEdit) tr.setMeta('addToHistory', false);
          return tr;
        },

        // Handle paste - filter duplicates
        props: filterDuplicates
          ? {
              transformPasted: transformPastedSlice,
            }
          : {},
      }),
    ];
  },
});
