/**
 * StarterKit Extension
 *
 * A convenient bundle of commonly-used extensions for quick setup.
 * All included extensions can be configured or disabled individually.
 */
import { Extension } from '../Extension.js';
import type { AnyExtensionConfig } from '../types/index.js';

// Nodes
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph, type ParagraphOptions } from '../nodes/Paragraph.js';
import { Heading, type HeadingOptions } from '../nodes/Heading.js';
import { Blockquote, type BlockquoteOptions } from '../nodes/Blockquote.js';
import { CodeBlock, type CodeBlockOptions } from '../nodes/CodeBlock.js';
import { BulletList, type BulletListOptions } from '../nodes/BulletList.js';
import { OrderedList, type OrderedListOptions } from '../nodes/OrderedList.js';
import { ListItem, type ListItemOptions } from '../nodes/ListItem.js';
import {
  HorizontalRule,
  type HorizontalRuleOptions,
} from '../nodes/HorizontalRule.js';
import { HardBreak, type HardBreakOptions } from '../nodes/HardBreak.js';
import { TaskList, type TaskListOptions } from '../nodes/TaskList.js';
import { TaskItem, type TaskItemOptions } from '../nodes/TaskItem.js';

// Marks
import { Bold, type BoldOptions } from '../marks/Bold.js';
import { Italic, type ItalicOptions } from '../marks/Italic.js';
import { Underline, type UnderlineOptions } from '../marks/Underline.js';
import { Strike, type StrikeOptions } from '../marks/Strike.js';
import { Code, type CodeOptions } from '../marks/Code.js';
import { Link, type LinkOptions } from '../marks/Link.js';

// Functionality
import { BaseKeymap, type BaseKeymapOptions } from './BaseKeymap.js';
import { History, type HistoryOptions } from './History.js';
import { Dropcursor, type DropcursorOptions } from './Dropcursor.js';
import { Gapcursor } from './Gapcursor.js';
import { TrailingNode, type TrailingNodeOptions } from './TrailingNode.js';
import { ListKeymap, type ListKeymapOptions } from './ListKeymap.js';
import { ListIndent } from './ListIndent.js';
import { LinkPopover, type LinkPopoverOptions } from './LinkPopover.js';
import { SelectionDecoration } from './SelectionDecoration.js';

export interface StarterKitOptions {
  // Nodes
  /**
   * Set to false to disable the Document node.
   */
  document?: false;
  /**
   * Set to false to disable the Text node.
   */
  text?: false;
  /**
   * Set to false to disable the Paragraph node, or pass options to configure it.
   */
  paragraph?: false | Partial<ParagraphOptions>;
  /**
   * Set to false to disable the Heading node, or pass options to configure it.
   */
  heading?: false | Partial<HeadingOptions>;
  /**
   * Set to false to disable the Blockquote node, or pass options to configure it.
   */
  blockquote?: false | Partial<BlockquoteOptions>;
  /**
   * Set to false to disable the CodeBlock node, or pass options to configure it.
   */
  codeBlock?: false | Partial<CodeBlockOptions>;
  /**
   * Set to false to disable the BulletList node, or pass options to configure it.
   */
  bulletList?: false | Partial<BulletListOptions>;
  /**
   * Set to false to disable the OrderedList node, or pass options to configure it.
   */
  orderedList?: false | Partial<OrderedListOptions>;
  /**
   * Set to false to disable the ListItem node, or pass options to configure it.
   */
  listItem?: false | Partial<ListItemOptions>;
  /**
   * Set to false to disable the HorizontalRule node, or pass options to configure it.
   */
  horizontalRule?: false | Partial<HorizontalRuleOptions>;
  /**
   * Set to false to disable the HardBreak node, or pass options to configure it.
   */
  hardBreak?: false | Partial<HardBreakOptions>;
  /**
   * Set to false to disable the TaskList node, or pass options to configure it.
   */
  taskList?: false | Partial<TaskListOptions>;
  /**
   * Set to false to disable the TaskItem node, or pass options to configure it.
   */
  taskItem?: false | Partial<TaskItemOptions>;

  // Marks
  /**
   * Set to false to disable the Bold mark, or pass options to configure it.
   */
  bold?: false | Partial<BoldOptions>;
  /**
   * Set to false to disable the Italic mark, or pass options to configure it.
   */
  italic?: false | Partial<ItalicOptions>;
  /**
   * Set to false to disable the Underline mark, or pass options to configure it.
   */
  underline?: false | Partial<UnderlineOptions>;
  /**
   * Set to false to disable the Strike mark, or pass options to configure it.
   */
  strike?: false | Partial<StrikeOptions>;
  /**
   * Set to false to disable the Code mark, or pass options to configure it.
   */
  code?: false | Partial<CodeOptions>;
  /**
   * Set to false to disable the Link mark, or pass options to configure it.
   */
  link?: false | Partial<LinkOptions>;

  // Functionality
  /**
   * Set to false to disable the BaseKeymap extension, or pass options to configure it.
   */
  baseKeymap?: false | Partial<BaseKeymapOptions>;
  /**
   * Set to false to disable the History extension, or pass options to configure it.
   */
  history?: false | Partial<HistoryOptions>;
  /**
   * Set to false to disable the Dropcursor extension, or pass options to configure it.
   */
  dropcursor?: false | Partial<DropcursorOptions>;
  /**
   * Set to false to disable the Gapcursor extension.
   */
  gapcursor?: false;
  /**
   * Set to false to disable the TrailingNode extension, or pass options to configure it.
   */
  trailingNode?: false | Partial<TrailingNodeOptions>;
  /**
   * Set to false to disable the ListKeymap extension, or pass options to configure it.
   */
  listKeymap?: false | Partial<ListKeymapOptions>;
  /**
   * Off by default. Set to `true` to enable the ListIndent extension, which
   * adds a Tab / Shift-Tab keymap that indents a top-level block under the
   * previous list (and outdents back). Kept off by default because it captures
   * Tab on a paragraph that merely follows a list, so Tab no longer moves focus
   * to the next field in embedded / form usage, and the same nesting is
   * reachable via the block-menu drag. Registered AFTER ListKeymap so the
   * in-list-item Tab/Shift-Tab keep priority.
   */
  listIndent?: boolean;
  /**
   * Set to false to disable the LinkPopover extension, or pass options to configure it.
   */
  linkPopover?: false | Partial<LinkPopoverOptions>;
  /**
   * Set to false to disable the SelectionDecoration extension.
   * When enabled, the editor collapses range selections on blur to prevent
   * ghost selections from lingering after clicking outside the editor.
   */
  selectionDecoration?: false;
}

export const StarterKit = Extension.create<StarterKitOptions>({
  name: 'starterKit',

  addOptions() {
    return {};
  },

  addExtensions() {
    const extensions: AnyExtensionConfig[] = [];

    // Helper to conditionally add extension
    const maybeAdd = <T extends object>(
      ext: { configure: (opts: Partial<T>) => AnyExtensionConfig } & AnyExtensionConfig,
      opts: false | Partial<T> | undefined
    ): void => {
      if (opts === false) return;
      if (opts && Object.keys(opts).length > 0) {
        extensions.push(ext.configure(opts));
      } else {
        extensions.push(ext);
      }
    };

    // Nodes
    maybeAdd(Document as never, this.options.document as never);
    maybeAdd(Text as never, this.options.text as never);
    maybeAdd(Paragraph, this.options.paragraph);
    maybeAdd(Heading, this.options.heading);
    maybeAdd(Blockquote, this.options.blockquote);
    maybeAdd(CodeBlock, this.options.codeBlock);
    maybeAdd(BulletList, this.options.bulletList);
    maybeAdd(OrderedList, this.options.orderedList);
    maybeAdd(ListItem, this.options.listItem);
    maybeAdd(HorizontalRule, this.options.horizontalRule);
    maybeAdd(HardBreak, this.options.hardBreak);
    maybeAdd(TaskList, this.options.taskList);
    maybeAdd(TaskItem, this.options.taskItem);

    // Marks
    maybeAdd(Bold, this.options.bold);
    maybeAdd(Italic, this.options.italic);
    maybeAdd(Underline, this.options.underline);
    maybeAdd(Strike, this.options.strike);
    maybeAdd(Code, this.options.code);
    maybeAdd(Link, this.options.link);

    // Functionality
    maybeAdd(BaseKeymap, this.options.baseKeymap);
    maybeAdd(History, this.options.history);
    maybeAdd(Dropcursor, this.options.dropcursor);
    maybeAdd(Gapcursor as never, this.options.gapcursor as never);
    maybeAdd(TrailingNode, this.options.trailingNode);
    maybeAdd(ListKeymap, this.options.listKeymap);
    // ListIndent is opt-in (off by default): only added on `listIndent: true`.
    // MUST be registered AFTER ListKeymap: collected keymaps run in
    // `LATER || EARLIER` order, so a later `addKeyboardShortcuts` runs FIRST.
    // ListIndent fires first, bails when the cursor is inside a list item, and
    // ListKeymap then handles the in-list Tab/Shift-Tab (sinkListItem /
    // liftListItem). Reordering breaks that delegation.
    if (this.options.listIndent === true) extensions.push(ListIndent);
    maybeAdd(LinkPopover, this.options.linkPopover);
    maybeAdd(SelectionDecoration as never, this.options.selectionDecoration as never);

    return extensions;
  },
});
