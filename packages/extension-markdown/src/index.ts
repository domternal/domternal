// @domternal/extension-markdown: public API.

export { Markdown, getMarkdown } from './Markdown.js';
export type { MarkdownOptions, MarkdownStorage } from './Markdown.js';
export { Markdown as default } from './Markdown.js';

export { downloadMarkdown } from './download.js';
export { looksLikeMarkdown, markdownPastePlugin, markdownPastePluginKey } from './pastePlugin.js';

export { createMarkdownParser, parseMarkdown } from './parser/parser.js';
export type { MarkdownParser } from './parser/parser.js';
export type { MarkdownParseState } from './parser/state.js';

export {
  createMarkdownSerializer,
  serializeMarkdown,
} from './serializer/serializer.js';
export type {
  MarkdownSerializer,
  MarkdownSerializerSpecOverrides,
  SerializeMarkdownOptions,
} from './serializer/serializer.js';

export { defaultMarkSpecs, defaultNodeSerializers } from './serializer/specs.js';
export { backticksFor } from './serializer/state.js';
export type { MarkdownSerializerState } from './serializer/state.js';
export type {
  MarkdownMarkSpec,
  MarkdownNodeSerializer,
  MarkdownSerializerOptions,
  MarkdownSerializerSpecs,
} from './serializer/state.js';

export type {
  MarkdownWarning,
  MarkdownWarningCode,
  SerializeMarkdownResult,
} from './types.js';
