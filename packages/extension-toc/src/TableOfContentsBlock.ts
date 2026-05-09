/**
 * TableOfContentsBlock - inline `/toc` block (Phase 7).
 *
 * An atom block-level PM node the user inserts via the slash menu.
 * The node itself is empty in the document (just `<div data-type=
 * "table-of-contents">`); a NodeView dynamically renders a list of
 * the document's headings on top of it.
 *
 * Architecture:
 *   - Node spec (`atom: true`, no editable content). PM treats it as
 *     a single unit for selection / drag / delete.
 *   - NodeView fully owns the inner DOM. We subscribe to
 *     `editor.storage.toc.subscribers` (Phase 2 contract) so the
 *     block re-renders whenever the heading list changes - typing a
 *     new heading anywhere in the doc flows through to every block
 *     instance. Active state mirrors `storage.activeId` so the
 *     currently-read heading is bolded inside the block too.
 *   - Click delegation routes any tap on a row to
 *     `editor.commands.scrollToHeading` (Phase 3) - same code path
 *     as the floating outline (Phase 4-6) and same UX (smooth scroll
 *     + URL hash + open-collapsed-details).
 *   - The slash menu item lives on `addFloatingMenuItems()` - the
 *     single hook fed by every insert affordance (slash, floating
 *     menu, BlockHandle plus button) so the block is discoverable
 *     from all of them at once.
 */
import { Node } from '@domternal/core';
import type { Editor, FloatingMenuItem } from '@domternal/core';
import type { NodeViewConstructor } from '@domternal/pm/view';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import type { TocStorage, HeadingEntry } from './types.js';

export interface TableOfContentsBlockOptions {
  /**
   * Empty-state placeholder text shown when the document has no
   * headings yet.
   * @default 'Add headings to create a table of contents.'
   */
  emptyStateText: string;
  /**
   * HTML attributes to apply to the block wrapper. Standard escape
   * hatch for consumer-side classes / data attributes.
   */
  HTMLAttributes: Record<string, unknown>;
}

const BLOCK_CLASS = 'dm-toc-block';
const LIST_CLASS = 'dm-toc-block-list';
const ITEM_CLASS = 'dm-toc-block-item';
const LINK_CLASS = 'dm-toc-block-link';
const EMPTY_CLASS = 'dm-toc-block-empty';
const ACTIVE_LINK_CLASS = 'dm-toc-block-link--active';

/**
 * Render the block's inner DOM (children of the wrapper) for the
 * current heading list. Naive full rebuild matches outline pattern -
 * heading counts are typically <50, the cost is microseconds, and
 * the alternative (incremental diff) tangles with PM's NodeView
 * mutation contract.
 */
function renderBlockContent(
  wrapper: HTMLElement,
  content: HeadingEntry[],
  emptyStateText: string,
): void {
  wrapper.replaceChildren();

  if (content.length === 0) {
    const empty = document.createElement('p');
    empty.className = EMPTY_CLASS;
    empty.textContent = emptyStateText;
    wrapper.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = LIST_CLASS;
  for (const entry of content) {
    const item = document.createElement('li');
    item.className = ITEM_CLASS;
    item.dataset['level'] = String(entry.level);

    const link = document.createElement('button');
    link.type = 'button';
    link.className = LINK_CLASS;
    link.dataset['level'] = String(entry.level);
    link.dataset['tocId'] = entry.id;
    link.textContent = entry.textContent.trim() || `Heading level ${String(entry.level)}`;

    item.appendChild(link);
    list.appendChild(item);
  }
  wrapper.appendChild(list);
}

/**
 * Toggle the active marker on every link with a `data-toc-id`. At
 * most one link gets `aria-current="location"` + the active class.
 * Mirrors `applyActiveMarker` in FloatingTocOutline so the inline
 * block and the floating outline reflect the same active heading.
 */
function applyActiveLink(wrapper: HTMLElement, activeId: string | null): void {
  const links = wrapper.querySelectorAll<HTMLElement>(`.${LINK_CLASS}`);
  for (const link of Array.from(links)) {
    const isActive = activeId !== null && link.dataset['tocId'] === activeId;
    link.classList.toggle(ACTIVE_LINK_CLASS, isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

/**
 * Build the NodeView constructor: factory closure over the editor
 * + options that runs once per `<TableOfContentsBlock>` PM node and
 * returns a NodeView controller. Subscription to storage updates
 * lives here so each block instance manages its own listener
 * lifecycle (mount on construct, unmount on destroy).
 */
function makeNodeViewConstructor(
  editor: Editor,
  options: TableOfContentsBlockOptions,
): NodeViewConstructor {
  return () => {
    const dom = document.createElement('div');
    dom.className = BLOCK_CLASS;
    dom.setAttribute('data-type', 'table-of-contents');
    dom.setAttribute('contenteditable', 'false');
    // Mark as a drag handle for the BlockHandle extension - the
    // entire block is the grab surface, no separate dot.
    dom.setAttribute('data-drag-handle', '');
    for (const [key, value] of Object.entries(options.HTMLAttributes)) {
      if (value !== null && value !== undefined) {
        dom.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    const storage = editor.storage['toc'] as TocStorage | undefined;

    const refresh = (): void => {
      if (!storage) return;
      renderBlockContent(dom, storage.content, options.emptyStateText);
      applyActiveLink(dom, storage.activeId);
    };

    let unsubscribe: (() => void) | null = null;
    if (storage) {
      storage.subscribers.add(refresh);
      unsubscribe = () => { storage.subscribers.delete(refresh); };
      // Initial paint - storage may already be populated if
      // TableOfContents' deferred init ran before this NodeView
      // was constructed (e.g. block inserted into an existing doc).
      refresh();
    } else {
      // No TableOfContents loaded - render the empty state once and
      // never update. The block stays inert and shows the placeholder.
      renderBlockContent(dom, [], options.emptyStateText);
    }

    // Click delegation: clicks anywhere inside the block bubble up
    // to this listener. closest('[data-toc-id]') resolves to a link
    // (or null if the click landed on the block chrome / empty
    // placeholder); on a hit, we delegate to the shared
    // scrollToHeading helper used by the floating outline as well.
    const onClick = (event: MouseEvent): void => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-toc-id]',
      );
      const id = target?.dataset['tocId'];
      if (!id) return;
      // Prevent the click from bubbling to the editor and changing
      // selection - the NodeView is `contenteditable="false"` but
      // PM still tracks clicks on atoms for selection.
      event.preventDefault();
      scrollToHeading(editor.view, id);
    };
    dom.addEventListener('click', onClick);

    return {
      dom,
      // Atom node has no editable content, so contentDOM is omitted.
      // PM mutations inside the NodeView (our re-renders) must NOT
      // be treated as document edits - ignoreMutation lets us
      // reshape the DOM without triggering PM rollback.
      ignoreMutation: () => true,
      // No update path: the NodeView's content is derived entirely
      // from `editor.storage.toc`. Returning false here would force
      // PM to rebuild the NodeView; returning true tells PM "I
      // handled it, leave my DOM alone". Attribute changes also
      // route through the subscriber path because they only matter
      // when storage changes too.
      update: () => true,
      destroy: () => {
        dom.removeEventListener('click', onClick);
        unsubscribe?.();
      },
    };
  };
}

export const TableOfContentsBlock = Node.create<TableOfContentsBlockOptions>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      emptyStateText: 'Add headings to create a table of contents.',
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', {
      ...this.options.HTMLAttributes,
      ...HTMLAttributes,
      'data-type': 'table-of-contents',
    }];
  },

  addNodeView() {
    // `this.editor` is typed as `NodeEditorContext` here; we cast to
    // the full `Editor` because the helpers we delegate to need
    // `view`, `commands`, and `storage` access. The framework
    // provides a real Editor at runtime - the narrower context type
    // is just a public-API surface restriction.
    const editor = this.editor as unknown as Editor | null;
    if (!editor) {
      throw new Error('TableOfContentsBlock.addNodeView called before editor was attached');
    }
    return makeNodeViewConstructor(editor, this.options);
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'table-of-contents',
        label: 'Table of contents',
        description: 'List of headings on this page',
        icon: 'listBullets',
        group: 'Basic',
        priority: 600,
        keywords: ['toc', 'outline', 'contents'],
        // Function command: SlashCommand removes the typed `/toc`
        // range BEFORE invoking us (FloatingMenuController.executeItem
        // does the deleteRange). Here we just need to insert the
        // node at the current cursor position.
        command: (editor: Editor): void => {
          editor.chain().focus().insertContent({ type: 'tableOfContents' }).run();
        },
      },
    ];
  },
});
