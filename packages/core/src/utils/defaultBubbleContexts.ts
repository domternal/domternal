import type { Editor } from '../Editor.js';

// `mathInline` is the inline-equation button from @domternal/extension-math.
// It is listed here so a text selection can be turned into inline math (Notion's
// selection-context equation), and is silently skipped when the extension is not
// loaded (the bubble menu resolves names against the editor's actual items).
const NOTION_TEXT_CONTEXT: readonly string[] = Object.freeze([
  // `ai` leads (Notion's "Ask AI"); skipped with its leading separator when
  // the pro extension is absent, exactly like `mathInline`.
  'ai',
  '|', 'bold', 'italic', 'underline', 'strike', 'code', 'mathInline',
  '|', 'link',
  '|', 'textAlign',
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
 * with `ai` and including `link` and `textAlign`.
 *
 * Consumers can always override by passing their own `contexts` prop.
 */
export function defaultBubbleContexts(
  editor: Editor,
): Record<string, string[]> {
  const text = editor.preset === 'notion' ? NOTION_TEXT_CONTEXT : STANDARD_TEXT_CONTEXT;
  return { text: [...text] };
}
