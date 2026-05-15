import type { Editor } from '../Editor.js';

const NOTION_MODE_CLASS = 'dm-notion-mode';

const NOTION_TEXT_CONTEXT: readonly string[] = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'code',
  '|', 'link',
  '|', 'textAlign',
]);

const STANDARD_TEXT_CONTEXT: readonly string[] = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'code',
  '|', 'link',
]);

/**
 * Default `contexts` map for a bubble menu when the consumer has not
 * supplied one. Returns a richer item set when the editor (or any
 * ancestor) carries the `.dm-notion-mode` class - that class is the
 * project-wide signal that the host is rendering Notion-style UX, so
 * the bubble menu mirrors it by including `link` and `textAlign`.
 *
 * Consumers can always override by passing their own `contexts` prop.
 */
export function defaultBubbleContexts(
  editor: Editor,
): Record<string, string[]> {
  const inNotionMode = editor.view.dom.closest('.' + NOTION_MODE_CLASS) !== null;
  const text = inNotionMode ? NOTION_TEXT_CONTEXT : STANDARD_TEXT_CONTEXT;
  return { text: [...text] };
}
