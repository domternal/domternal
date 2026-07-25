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

    /**
     * ProseMirror hands this the DRAGGED slice on an internal drag as well as
     * pasted content, and it does so BEFORE the source is deleted, so a plain
     * block move looks exactly like a duplicate: the original is still in the
     * document, its id collides, and the moved block would land with a fresh
     * one. That silently breaks every reference to the block (a `#hash` anchor,
     * a table-of-contents deep link, a copied block link) for a gesture that
     * changed no content at all.
     *
     * `view.dragging.move` is set at dragstart and distinguishes a move from a
     * copy: a move deletes the source, so the collision is transient and the id
     * must be kept. A copy drag (alt-drag) leaves `move` false and still
     * regenerates, which is what we want. If a move somehow does not complete,
     * `assignMissingIDs` is still the safety net and renames the duplicate.
     */
    const transformPastedSlice = (slice: Slice, view?: { dragging?: { move?: boolean } | null }): Slice => {
      if (view?.dragging?.move === true) return slice;

      const existingIDs = new Set<string>();

      // Collect existing IDs in document
      editor?.state.doc.descendants((node: PMNode) => {
        const id = node.attrs[attributeName] as string | undefined;
        if (id) existingIDs.add(id);
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
     * Which node currently holds each id by right of having held it BEFORE this
     * change, keyed by its position in the new document. Built by walking the
     * old document and mapping each id-bearing node's position forward through
     * the transactions that produced the new one.
     *
     * Without this, a collision is resolved by document order, so a copy that
     * lands ABOVE its original keeps the id and the ORIGINAL is renamed. Every
     * reference then silently points at the copy: a table-of-contents link
     * jumps to the duplicate, and a block-anchored comment appears on prose it
     * was never about. Position in the document is not evidence of ownership;
     * having held the id already is.
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
       * Which position keeps each CONTESTED id. Only ids carried by more than
       * one node are contested, so an id that simply moved (a full setContent
       * remaps every position) is never disturbed. The incumbent wins when its
       * mapped position really is one of the occurrences; otherwise the mapping
       * did not survive the change and document order decides, which is the
       * old behaviour and still better than renaming every copy.
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

          // Assigning an id is bookkeeping the editor does for itself, never an
          // edit the user made, so it must not join the undo stack. Without
          // this, an id stamped as a side effect of typing rides along in that
          // undo event: undo reverts the block to no id, the next sweep mints a
          // DIFFERENT one, and every reference to the old id (a `#hash` anchor,
          // a table-of-contents deep link, a copied block link) breaks with no
          // visible cause. prosemirror-history captures appended transactions
          // unless the appending plugin opts out, which is what this does.
          tr.setMeta('addToHistory', false);
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
