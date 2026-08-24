import type { Editor } from '../Editor.js';

/**
 * The Notion preset selection menu follows four intent groups: act on this
 * selection (Ask AI about it, comment on it), change what it is (Turn into),
 * attach something (Link), then style it. Comment is frequent enough in
 * collaborative editing to earn the leading group beside Ask AI. This is a
 * deliberate deviation from Notion's own menu, which keeps Link and Comment
 * together after Turn into.
 *
 * Four names here are not in this package and are meant to be absent most of
 * the time. `ai` and `comment` come from the Pro extensions, `mathInline` from
 * `@domternal/extension-math`, and `heading` from StarterKit's Heading node,
 * which is where Notion's "Turn into" lands: the same dropdown, Normal text
 * plus the heading levels, with the icon following the current block. A name
 * that resolves to nothing is skipped, and `collapseSeparators` then removes
 * the bar that was standing beside it, so one list serves every build.
 *
 * `textAlign` used to end this list and has been dropped. It named an
 * extension StarterKit does not ship, so a default install resolved it to
 * nothing and kept its separator, and Notion has no alignment control in the
 * selection menu either: alignment is a property of the block, and it lives in
 * the block menu behind the trailing "...".
 *
 * The trailing color "A" and that "..." are not listed here. They are not
 * items; each menu appends them itself, gated on the extension that owns them.
 */
const NOTION_TEXT_CONTEXT: readonly string[] = Object.freeze([
  'ai', 'comment',
  '|', 'heading',
  '|', 'link',
  '|', 'bold', 'italic', 'underline', 'strike', 'code', 'mathInline',
]);

const STANDARD_TEXT_CONTEXT: readonly string[] = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'code', 'mathInline',
  '|', 'link',
]);

/**
 * Default `contexts` map for a bubble menu when the consumer has not
 * supplied one. Returns a richer item set when the editor resolves to the
 * Notion preset (the `preset` option, or the `.dm-notion-mode` class the
 * getter also honors), so the bubble menu mirrors the Notion UX by leading
 * with the `ai` and `comment` selection actions, then offering the block-type
 * dropdown and `link` ahead of the formatting marks.
 *
 * Consumers can always override by passing their own `contexts` prop.
 */
export function defaultBubbleContexts(
  editor: Editor,
): Record<string, string[]> {
  const text = editor.preset === 'notion' ? NOTION_TEXT_CONTEXT : STANDARD_TEXT_CONTEXT;
  return { text: [...text] };
}
